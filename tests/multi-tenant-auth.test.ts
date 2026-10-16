import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../src/lib/prisma";
import { redis } from "../src/lib/redis";
import { hashPassword, createSession, SESSION_COOKIE_NAME } from "../src/lib/auth";
import { Role, OrganizationStatus } from "@prisma/client";
import { OrgRateLimiter } from "../src/lib/rate-limiter";
import { processOutboundCallJob } from "../src/lib/execution-engine";

import { POST as createCampaign, GET as listCampaigns } from "../src/app/api/campaigns/route";
import { GET as getCampaign, PATCH as updateCampaign } from "../src/app/api/campaigns/[id]/route";
import { POST as executeLifecycle } from "../src/app/api/campaigns/[id]/[action]/route";
import { POST as uploadContacts } from "../src/app/api/campaigns/[id]/contacts/upload/route";
import { GET as getWorkspaces } from "../src/app/api/workspaces/route";
import { GET as getAdminMetrics } from "../src/app/api/admin/metrics/route";
import { GET as getAdminCompanies, POST as onboardCompany } from "../src/app/api/admin/companies/route";
import { PATCH as updateCompany } from "../src/app/api/admin/companies/[id]/route";

describe("Multi-Tenant Authentication and Security Isolation Tests", () => {
  // Identities
  let superadminUser: { id: string; email: string };
  let superadminCookie: string;

  let orgA: { id: string; name: string };
  let orgAWorkspace: { id: string; name: string };
  let orgAUser: { id: string; email: string };
  let orgACookie: string;
  let orgACampaignId: string;

  let orgB: { id: string; name: string };
  let orgBWorkspace: { id: string; name: string };
  let orgBUser: { id: string; email: string };
  let orgBCookie: string;
  let orgBCampaignId: string;

  const uniqueSuffix = Date.now().toString().slice(-6);

  before(async () => {
    // 1. Setup Superadmin
    const saEmail = `voiceagent+test${uniqueSuffix}@yopmail.com`;
    const sa = await prisma.user.create({
      data: {
        email: saEmail,
        name: "Test Superadmin",
        role: Role.SUPERADMIN,
        passwordHash: hashPassword("SuperPass123!"),
      },
    });
    superadminUser = sa;
    const saSession = await createSession(sa.id);
    superadminCookie = `${SESSION_COOKIE_NAME}=${saSession.sessionToken}`;

    // 2. Setup Organisation A (Active)
    const oa = await prisma.organization.create({
      data: {
        name: `Org Alpha ${uniqueSuffix}`,
        slug: `org-alpha-${uniqueSuffix}`,
        status: OrganizationStatus.ACTIVE,
        maxRequestsPerSecond: 5.0,
        rateLimitPerMinute: 300,
      },
    });
    orgA = oa;

    const oaw = await prisma.workspace.create({
      data: {
        name: "Alpha Workspace",
        slug: "default",
        organizationId: oa.id,
      },
    });
    orgAWorkspace = oaw;

    const oau = await prisma.user.create({
      data: {
        email: `owner-alpha-${uniqueSuffix}@alpha.com`,
        name: "Alpha Owner",
        role: Role.OWNER,
        organizationId: oa.id,
        passwordHash: hashPassword("AlphaPass123!"),
      },
    });
    orgAUser = oau;
    const oaSession = await createSession(oau.id);
    orgACookie = `${SESSION_COOKIE_NAME}=${oaSession.sessionToken}`;

    // Create a campaign for Org A
    const campA = await prisma.campaign.create({
      data: {
        name: "Alpha Secret Campaign",
        workspaceId: oaw.id,
        organizationId: oa.id,
        maxRequestsPerSecond: 5,
        requiredVariables: ["account_no"],
      },
    });
    orgACampaignId = campA.id;

    // 3. Setup Organisation B (Active)
    const ob = await prisma.organization.create({
      data: {
        name: `Org Beta ${uniqueSuffix}`,
        slug: `org-beta-${uniqueSuffix}`,
        status: OrganizationStatus.ACTIVE,
        maxRequestsPerSecond: 5.0,
        rateLimitPerMinute: 300,
      },
    });
    orgB = ob;

    const obw = await prisma.workspace.create({
      data: {
        name: "Beta Workspace",
        slug: "default",
        organizationId: ob.id,
      },
    });
    orgBWorkspace = obw;

    const obu = await prisma.user.create({
      data: {
        email: `owner-beta-${uniqueSuffix}@beta.com`,
        name: "Beta Owner",
        role: Role.OWNER,
        organizationId: ob.id,
        passwordHash: hashPassword("BetaPass123!"),
      },
    });
    orgBUser = obu;
    const obSession = await createSession(obu.id);
    orgBCookie = `${SESSION_COOKIE_NAME}=${obSession.sessionToken}`;

    // Create a campaign for Org B
    const campB = await prisma.campaign.create({
      data: {
        name: "Beta Confidential Campaign",
        workspaceId: obw.id,
        organizationId: ob.id,
        maxRequestsPerSecond: 5,
      },
    });
    orgBCampaignId = campB.id;
  });

  after(async () => {
    // Cleanup created data
    await prisma.session.deleteMany({
      where: {
        userId: { in: [superadminUser?.id, orgAUser?.id, orgBUser?.id].filter(Boolean) as string[] },
      },
    });
    if (orgACampaignId) {
      await prisma.contact.deleteMany({ where: { campaignId: orgACampaignId } });
      await prisma.callAttempt.deleteMany({ where: { campaignId: orgACampaignId } });
      await prisma.campaign.deleteMany({ where: { id: orgACampaignId } });
    }
    if (orgBCampaignId) {
      await prisma.contact.deleteMany({ where: { campaignId: orgBCampaignId } });
      await prisma.callAttempt.deleteMany({ where: { campaignId: orgBCampaignId } });
      await prisma.campaign.deleteMany({ where: { id: orgBCampaignId } });
    }
    if (orgA?.id) {
      await prisma.organization.deleteMany({ where: { id: orgA.id } });
    }
    if (orgB?.id) {
      await prisma.organization.deleteMany({ where: { id: orgB.id } });
    }
    if (superadminUser?.id) {
      await prisma.user.deleteMany({ where: { id: superadminUser.id } });
    }
    await redis.quit();
    await prisma.$disconnect();
  });

  // Test 1: Unauthenticated requests cannot access protected management APIs
  test("1. Unauthenticated requests are rejected with 401 across management APIs", async () => {
    // GET /api/campaigns
    const resCampaigns = await listCampaigns(new NextRequest("http://localhost:3000/api/campaigns"));
    assert.equal(resCampaigns.status, 401);

    // POST /api/campaigns
    const resCreate = await createCampaign(
      new NextRequest("http://localhost:3000/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Unauth Campaign", workspaceId: orgAWorkspace.id }),
      })
    );
    assert.equal(resCreate.status, 401);

    // GET /api/workspaces
    const resWorkspaces = await getWorkspaces(new NextRequest("http://localhost:3000/api/workspaces"));
    assert.equal(resWorkspaces.status, 401);

    // GET /api/admin/companies
    const resAdmin = await getAdminCompanies(new NextRequest("http://localhost:3000/api/admin/companies"));
    assert.equal(resAdmin.status, 401);

    // GET /api/admin/metrics
    const resMetrics = await getAdminMetrics(new NextRequest("http://localhost:3000/api/admin/metrics"));
    assert.equal(resMetrics.status, 401);
  });

  // Test 2: Superadmin can onboard a company
  test("2. Superadmin can onboard a company transactionally", async () => {
    const payload = {
      name: `Gamma Health ${uniqueSuffix}`,
      ownerName: "Dr. Gamma",
      ownerEmail: `gamma-owner-${uniqueSuffix}@gamma.com`,
      maxRequestsPerSecond: 8.5,
    };

    const req = new NextRequest("http://localhost:3000/api/admin/companies", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: superadminCookie,
      },
      body: JSON.stringify(payload),
    });

    const res = await onboardCompany(req);
    const body = await res.json();

    assert.equal(res.status, 201);
    assert.equal(body.success, true);
    assert.equal(body.data.organization.name, payload.name);
    assert.equal(body.data.organization.maxRequestsPerSecond, 8.5);
    assert.equal(body.data.owner.email, payload.ownerEmail);
    assert.ok(body.data.temporaryPassword, "Must generate a temporary password for owner");

    // Clean up onboarded company
    await prisma.organization.deleteMany({ where: { id: body.data.organization.id } });
  });

  // Test 3: Organisation owner can view and manage their own permitted campaigns
  test("3. Organisation owner can view and manage their own campaigns", async () => {
    // List campaigns
    const listReq = new NextRequest("http://localhost:3000/api/campaigns", {
      headers: { Cookie: orgACookie },
    });
    const listRes = await listCampaigns(listReq);
    const listBody = await listRes.json();

    assert.equal(listRes.status, 200);
    assert.equal(listBody.success, true);
    const found = listBody.data.items.find((c: { id: string }) => c.id === orgACampaignId);
    assert.ok(found, "Org A owner must see their own campaign");

    // Read campaign detail
    const getReq = new NextRequest(`http://localhost:3000/api/campaigns/${orgACampaignId}`, {
      headers: { Cookie: orgACookie },
    });
    const getRes = await getCampaign(getReq, { params: Promise.resolve({ id: orgACampaignId }) });
    const getBody = await getRes.json();

    assert.equal(getRes.status, 200);
    assert.equal(getBody.data.campaign.id, orgACampaignId);

    // Update campaign description
    const patchReq = new NextRequest(`http://localhost:3000/api/campaigns/${orgACampaignId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: orgACookie,
      },
      body: JSON.stringify({ description: "Updated by Alpha Owner" }),
    });
    const patchRes = await updateCampaign(patchReq, { params: Promise.resolve({ id: orgACampaignId }) });
    const patchBody = await patchRes.json();

    assert.equal(patchRes.status, 200);
    assert.equal(patchBody.data.description, "Updated by Alpha Owner");
  });

  // Test 4: Cross-tenant isolation (Org A cannot read, update, stop, or upload contacts to Org B's campaign)
  test("4. Tenant isolation: Org A cannot list, read, update, stop, or upload contacts to Org B", async () => {
    // 4a. Org A listing campaigns does NOT include Org B's campaign
    const listReq = new NextRequest("http://localhost:3000/api/campaigns", {
      headers: { Cookie: orgACookie },
    });
    const listRes = await listCampaigns(listReq);
    const listBody = await listRes.json();
    const leaked = listBody.data.items.some((c: { id: string }) => c.id === orgBCampaignId);
    assert.equal(leaked, false, "Org A must NOT see Org B's campaign in listing");

    // 4b. Org A reading Org B's campaign directly returns 404
    const getReq = new NextRequest(`http://localhost:3000/api/campaigns/${orgBCampaignId}`, {
      headers: { Cookie: orgACookie },
    });
    const getRes = await getCampaign(getReq, { params: Promise.resolve({ id: orgBCampaignId }) });
    assert.equal(getRes.status, 404, "Cross-tenant GET must return 404 Not Found");

    // 4c. Org A updating Org B's campaign returns 404
    const patchReq = new NextRequest(`http://localhost:3000/api/campaigns/${orgBCampaignId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: orgACookie,
      },
      body: JSON.stringify({ name: "Malicious Tampering" }),
    });
    const patchRes = await updateCampaign(patchReq, { params: Promise.resolve({ id: orgBCampaignId }) });
    assert.equal(patchRes.status, 404, "Cross-tenant PATCH must return 404 Not Found");

    // 4d. Org A executing lifecycle action (stop) on Org B returns 404
    const stopReq = new NextRequest(`http://localhost:3000/api/campaigns/${orgBCampaignId}/stop`, {
      method: "POST",
      headers: { Cookie: orgACookie },
    });
    const stopRes = await executeLifecycle(stopReq, {
      params: Promise.resolve({ id: orgBCampaignId, action: "stop" }),
    });
    assert.equal(stopRes.status, 404, "Cross-tenant lifecycle action must return 404");

    // 4e. Org A uploading contacts to Org B's campaign returns 404
    const boundary = "----TestBoundary123";
    const bodyStr =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="test.csv"\r\n` +
      `Content-Type: text/csv\r\n\r\n` +
      `phone_number\r\n+919876543201\r\n` +
      `--${boundary}--\r\n`;

    const uploadReq = new NextRequest(`http://localhost:3000/api/campaigns/${orgBCampaignId}/contacts/upload`, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        Cookie: orgACookie,
      },
      body: Buffer.from(bodyStr),
    });
    const uploadRes = await uploadContacts(uploadReq, {
      params: Promise.resolve({ id: orgBCampaignId }),
    });
    assert.equal(uploadRes.status, 404, "Cross-tenant contact upload must return 404");

    // 4f. Org B reading Org B's campaign directly succeeds with 200
    const getBReq = new NextRequest(`http://localhost:3000/api/campaigns/${orgBCampaignId}`, {
      headers: { Cookie: orgBCookie },
    });
    const getBRes = await getCampaign(getBReq, { params: Promise.resolve({ id: orgBCampaignId }) });
    assert.equal(getBRes.status, 200, "Org B owner can access their own campaign");
  });

  // Test 5: A user cannot create a campaign in another organisation's workspace
  test("5. A user cannot create a campaign in another organisation's workspace", async () => {
    // Org A user tries to create campaign in Org B's workspace
    const req = new NextRequest("http://localhost:3000/api/campaigns", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: orgACookie,
      },
      body: JSON.stringify({
        name: "Unauthorized Campaign in Org B Workspace",
        workspaceId: orgBWorkspace.id, // Target Org B's workspace
      }),
    });

    const res = await createCampaign(req);
    const body = await res.json();

    assert.equal(res.status, 403, "Must return 403 Forbidden");
    assert.equal(body.success, false);
    assert.equal(body.error.code, "FORBIDDEN");
  });

  // Test 6: An organisation user cannot access Superadmin endpoints
  test("6. An organisation user cannot access Superadmin endpoints", async () => {
    // Org A user attempting to GET /api/admin/metrics
    const metricsReq = new NextRequest("http://localhost:3000/api/admin/metrics", {
      headers: { Cookie: orgACookie },
    });
    const metricsRes = await getAdminMetrics(metricsReq);
    assert.equal(metricsRes.status, 403, "Org user accessing /api/admin/metrics must get 403 Forbidden");

    // Org A user attempting to GET /api/admin/companies
    const compReq = new NextRequest("http://localhost:3000/api/admin/companies", {
      headers: { Cookie: orgACookie },
    });
    const compRes = await getAdminCompanies(compReq);
    assert.equal(compRes.status, 403, "Org user accessing /api/admin/companies must get 403 Forbidden");

    // Org A user attempting to onboard a company
    const onboardReq = new NextRequest("http://localhost:3000/api/admin/companies", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: orgACookie,
      },
      body: JSON.stringify({
        name: "Hacked Org",
        ownerName: "Hacker",
        ownerEmail: "hacker@hack.com",
      }),
    });
    const onboardRes = await onboardCompany(onboardReq);
    assert.equal(onboardRes.status, 403, "Org user onboard attempt must get 403 Forbidden");
  });

  // Test 7: An inactive organisation cannot start or dispatch campaigns
  test("7. An inactive organisation cannot start or dispatch campaigns", async () => {
    // Deactivate Org A via Superadmin API
    const patchOrgReq = new NextRequest(`http://localhost:3000/api/admin/companies/${orgA.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: superadminCookie,
      },
      body: JSON.stringify({ status: OrganizationStatus.INACTIVE }),
    });
    const patchOrgRes = await updateCompany(patchOrgReq, { params: Promise.resolve({ id: orgA.id }) });
    assert.equal(patchOrgRes.status, 200);

    // Add a contact to Org A campaign so it satisfies min 1 contact requirement
    const contact = await prisma.contact.create({
      data: {
        campaignId: orgACampaignId,
        workspaceId: orgAWorkspace.id,
        phoneNumber: "+919876543211",
        status: "PENDING",
      },
    });

    // 7a. Attempt to start campaign for inactive organization
    const startReq = new NextRequest(`http://localhost:3000/api/campaigns/${orgACampaignId}/start`, {
      method: "POST",
      headers: { Cookie: orgACookie },
    });
    const startRes = await executeLifecycle(startReq, {
      params: Promise.resolve({ id: orgACampaignId, action: "start" }),
    });
    const startBody = await startRes.json();

    assert.equal(startRes.status, 400);
    assert.equal(startBody.error.code, "ORGANIZATION_INACTIVE");

    // 7b. Worker execution engine skips dispatch if organization is INACTIVE
    const execResult = await processOutboundCallJob({
      campaignId: orgACampaignId,
      contactId: contact.id,
      attemptNumber: 1,
    });
    assert.equal(execResult.status, "SKIPPED");
    assert.match(execResult.reason || "", /INACTIVE/i);

    // Restore Org A status to ACTIVE
    await prisma.organization.update({
      where: { id: orgA.id },
      data: { status: OrganizationStatus.ACTIVE },
    });
  });

  // Test 8: Different organisations have independent rate-limit counters
  test("8. Different organisations have independent rate-limit counters", async () => {
    const testOrgX = `rate_test_x_${uniqueSuffix}`;
    const testOrgY = `rate_test_y_${uniqueSuffix}`;

    // Clean test keys
    await redis.del(`ratelimit:org:${testOrgX}`, `ratelimit:org:${testOrgY}`);

    // Exhaust Org X limit (capacity 3)
    for (let i = 0; i < 3; i++) {
      const resX = await OrgRateLimiter.acquire(testOrgX, 3, 3);
      assert.equal(resX.allowed, true);
    }
    const deniedX = await OrgRateLimiter.acquire(testOrgX, 3, 3);
    assert.equal(deniedX.allowed, false, "Org X must be rate-limited after 3 tokens");

    // Org Y with limit 3 must be completely unaffected and have full capacity
    const allowedY1 = await OrgRateLimiter.acquire(testOrgY, 3, 3);
    assert.equal(allowedY1.allowed, true, "Org Y must not be affected by Org X's exhausted rate limit");

    await redis.del(`ratelimit:org:${testOrgX}`, `ratelimit:org:${testOrgY}`);
  });

  // Test 9: Repeated onboarding does not create duplicate accounts or partial records
  test("9. Repeated onboarding with duplicate email is rejected without creating partial records", async () => {
    const duplicateEmail = `dup-owner-${uniqueSuffix}@duplicate.com`;

    const payload = {
      name: `Original Company ${uniqueSuffix}`,
      ownerName: "Original Owner",
      ownerEmail: duplicateEmail,
      maxRequestsPerSecond: 5.0,
    };

    // First onboarding succeeds
    const req1 = new NextRequest("http://localhost:3000/api/admin/companies", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: superadminCookie,
      },
      body: JSON.stringify(payload),
    });
    const res1 = await onboardCompany(req1);
    assert.equal(res1.status, 201);
    const body1 = await res1.json();
    const createdOrgId = body1.data.organization.id;

    // Second onboarding with SAME owner email fails with 409
    const req2 = new NextRequest("http://localhost:3000/api/admin/companies", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: superadminCookie,
      },
      body: JSON.stringify({
        name: `Duplicate Attempt Company ${uniqueSuffix}`,
        ownerName: "Duplicate Owner",
        ownerEmail: duplicateEmail,
      }),
    });
    const res2 = await onboardCompany(req2);
    const body2 = await res2.json();

    assert.equal(res2.status, 409);
    assert.equal(body2.error.code, "DUPLICATE_USER");

    // Verify duplicate company record was not created
    const dupOrg = await prisma.organization.findFirst({
      where: { name: `Duplicate Attempt Company ${uniqueSuffix}` },
    });
    assert.equal(dupOrg, null, "No partial or orphaned organization should exist from failed onboarding");

    // Clean up created org
    await prisma.organization.deleteMany({ where: { id: createdOrgId } });
  });
});
