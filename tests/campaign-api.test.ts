import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../src/lib/prisma";
import { POST as createCampaign, GET as listCampaigns } from "../src/app/api/campaigns/route";
import { GET as getCampaign, PATCH as updateCampaign } from "../src/app/api/campaigns/[id]/route";

describe("Campaign REST APIs", () => {
  let workspaceId: string;
  let createdCampaignId: string;
  let sessionCookie: string;

  before(async () => {
    // Ensure default org and workspace exist
    const org = await prisma.organization.upsert({
      where: { slug: "acme-corp" },
      update: {},
      create: { name: "Acme Corporation", slug: "acme-corp" },
    });

    const ws = await prisma.workspace.upsert({
      where: {
        organizationId_slug: { organizationId: org.id, slug: "default" },
      },
      update: {},
      create: { name: "Default Workspace", slug: "default", organizationId: org.id },
    });

    workspaceId = ws.id;

    // Create session for authenticated tenant user
    const user = await prisma.user.upsert({
      where: { email: "admin@acme.com" },
      update: { organizationId: org.id },
      create: {
        email: "admin@acme.com",
        name: "Admin User",
        role: "OWNER",
        organizationId: org.id,
      },
    });

    const session = await prisma.session.create({
      data: {
        userId: user.id,
        sessionToken: "test_token_campaign_api",
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    sessionCookie = `session_token=${session.sessionToken}`;
  });

  after(async () => {
    // Clean up created test campaign and session
    if (createdCampaignId) {
      await prisma.campaign.deleteMany({ where: { id: createdCampaignId } });
    }
    await prisma.session.deleteMany({ where: { sessionToken: "test_token_campaign_api" } });
    await prisma.$disconnect();
  });

  test("POST /api/campaigns: Valid campaign creation succeeds with 201", async () => {
    const payload = {
      name: "Q4 Renewal Voice Outreach",
      description: "Automated renewal reminders for annual subscribers",
      workspaceId,
      agentAppId: "agent_voice_q4_renewals",
      agentVersion: "v1.2",
      agentType: "outbound_voice",
      sarvamAgentId: "sarvam_app_0987",
      connectionId: "conn_telephony_telnyx_01",
      callerPhoneNumber: "+14155552671",
      maxRequestsPerSecond: 10,
      dailyStartTime: "10:00",
      dailyEndTime: "17:00",
      timezone: "America/New_York",
      allowedDays: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY"],
      maxRetries: 4,
      retryIntervalMinutes: 45,
      requiredVariables: ["subscriber_plan", "renewal_amount"],
    };

    const req = new NextRequest("http://localhost:3000/api/campaigns", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie,
      },
      body: JSON.stringify(payload),
    });

    const res = await createCampaign(req);
    const body = await res.json();

    assert.equal(res.status, 201);
    assert.equal(body.success, true);
    assert.ok(body.data.id);
    assert.equal(body.data.name, payload.name);
    assert.equal(body.data.status, "DRAFT"); // Must default to non-running status
    assert.equal(body.data.maxRetries, 4);
    assert.equal(body.data.timezone, "America/New_York");
    assert.deepEqual(body.data.requiredVariables, ["subscriber_plan", "renewal_amount"]);

    createdCampaignId = body.data.id;
  });

  test("POST /api/campaigns: Invalid campaign input rejected with 400", async () => {
    const invalidPayload = {
      name: "X", // too short (min 2)
      workspaceId: "", // missing
      dailyStartTime: "25:00", // invalid hour
      callerPhoneNumber: "invalid-phone",
      maxRequestsPerSecond: -1, // invalid
    };

    const req = new NextRequest("http://localhost:3000/api/campaigns", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie,
      },
      body: JSON.stringify(invalidPayload),
    });

    const res = await createCampaign(req);
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.success, false);
    assert.equal(body.error.code, "VALIDATION_ERROR");
  });

  test("POST /api/campaigns: Non-existent workspace returns 404", async () => {
    const payload = {
      name: "Valid Campaign Name",
      workspaceId: "non_existent_workspace_id_12345",
    };

    const req = new NextRequest("http://localhost:3000/api/campaigns", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie,
      },
      body: JSON.stringify(payload),
    });

    const res = await createCampaign(req);
    const body = await res.json();

    assert.equal(res.status, 404);
    assert.equal(body.success, false);
    assert.equal(body.error.code, "NOT_FOUND");
  });

  test("GET /api/campaigns: Lists campaigns with pagination and contact counts", async () => {
    const req = new NextRequest("http://localhost:3000/api/campaigns?page=1&limit=10", {
      headers: { Cookie: sessionCookie },
    });
    const res = await listCampaigns(req);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data.items));
    assert.ok(body.data.items.length >= 1);
    assert.ok(body.data.pagination);
    assert.equal(body.data.pagination.page, 1);
    assert.ok(body.data.items[0]._count);
    assert.equal(typeof body.data.items[0]._count.contacts, "number");
  });

  test("GET /api/campaigns/[id]: Returns campaign details and contact list", async () => {
    const req = new NextRequest(`http://localhost:3000/api/campaigns/${createdCampaignId}`, {
      headers: { Cookie: sessionCookie },
    });
    const res = await getCampaign(req, { params: Promise.resolve({ id: createdCampaignId }) });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.campaign.id, createdCampaignId);
    assert.ok(body.data.contacts);
    assert.ok(Array.isArray(body.data.contacts.items));
  });

  test("PATCH /api/campaigns/[id]: Safely updates configuration", async () => {
    const updatePayload = {
      description: "Updated campaign description",
      concurrencyLimit: 8,
      status: "PAUSED",
    };

    const req = new NextRequest(`http://localhost:3000/api/campaigns/${createdCampaignId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie,
      },
      body: JSON.stringify(updatePayload),
    });

    const res = await updateCampaign(req, {
      params: Promise.resolve({ id: createdCampaignId }),
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.description, "Updated campaign description");
    assert.equal(body.data.concurrencyLimit, 8);
    assert.equal(body.data.status, "PAUSED");
  });

  test("PATCH /api/campaigns/[id]: Returns 404 for nonexistent campaign", async () => {
    const req = new NextRequest("http://localhost:3000/api/campaigns/missing_campaign_id", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie,
      },
      body: JSON.stringify({ name: "Updated Name" }),
    });

    const res = await updateCampaign(req, {
      params: Promise.resolve({ id: "missing_campaign_id" }),
    });
    const body = await res.json();

    assert.equal(res.status, 404);
    assert.equal(body.success, false);
    assert.equal(body.error.code, "NOT_FOUND");
  });
});
