import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../src/lib/prisma";
import { redis } from "../src/lib/redis";
import { hashPassword, createSession, SESSION_COOKIE_NAME } from "../src/lib/auth";
import { Role, OrganizationStatus } from "@prisma/client";
import { enqueueContactRetry } from "../src/lib/queue";
import { processOutboundCallJob } from "../src/lib/execution-engine";

import { POST as handleWebhook } from "../src/app/api/webhooks/sarvam/route";
import { GET as getCampaign, PATCH as updateCampaign } from "../src/app/api/campaigns/[id]/route";

describe("Regression Fixes & Reliability Verification", () => {
  let org: { id: string; name: string };
  let workspace: { id: string; name: string };
  let ownerUser: { id: string; email: string };
  let sessionCookie: string;
  let campaignId: string;
  let testContactId: string;

  const uniqueSuffix = Date.now().toString().slice(-6);

  before(async () => {
    // 1. Create Organization & Workspace
    org = await prisma.organization.create({
      data: {
        name: `Regression Org ${uniqueSuffix}`,
        slug: `regression-org-${uniqueSuffix}`,
        status: OrganizationStatus.ACTIVE,
        maxRequestsPerSecond: 5.0,
      },
    });

    workspace = await prisma.workspace.create({
      data: {
        name: "Main Workspace",
        slug: "main",
        organizationId: org.id,
      },
    });

    // 2. Create Owner User & Session
    ownerUser = await prisma.user.create({
      data: {
        email: `reg-owner-${uniqueSuffix}@test.com`,
        name: "Regression Owner",
        role: Role.OWNER,
        organizationId: org.id,
        passwordHash: hashPassword("SecretPass123!"),
      },
    });

    const session = await createSession(ownerUser.id);
    sessionCookie = `${SESSION_COOKIE_NAME}=${session.sessionToken}`;

    // 3. Create Campaign
    const campaign = await prisma.campaign.create({
      data: {
        name: `Regression Campaign ${uniqueSuffix}`,
        organizationId: org.id,
        workspaceId: workspace.id,
        status: "DRAFT",
        maxRequestsPerSecond: 5.0,
        callerPhoneNumber: "+919876543210",
        dailyStartTime: "09:00",
        dailyEndTime: "18:00",
      },
    });
    campaignId = campaign.id;

    // 4. Create Contact
    const contact = await prisma.contact.create({
      data: {
        campaignId,
        workspaceId: workspace.id,
        phoneNumber: `+9198765${uniqueSuffix.slice(-5)}`,
        status: "PENDING",
        retryCount: 0,
      },
    });
    testContactId = contact.id;
  });

  after(async () => {
    try {
      if (testContactId) {
        await prisma.callAttempt.deleteMany({ where: { contactId: testContactId } });
        await prisma.contact.deleteMany({ where: { id: testContactId } });
      }
      if (campaignId) {
        await prisma.campaign.deleteMany({ where: { id: campaignId } });
      }
      if (ownerUser?.id) {
        await prisma.session.deleteMany({ where: { userId: ownerUser.id } });
        await prisma.user.deleteMany({ where: { id: ownerUser.id } });
      }
      if (org?.id) {
        await prisma.organization.deleteMany({ where: { id: org.id } });
      }
    } finally {
      if (redis.status === "ready" || redis.status === "connecting") {
        await Promise.race([redis.quit(), new Promise((r) => setTimeout(r, 1000))]);
      }
      redis.disconnect();
      await Promise.race([prisma.$disconnect(), new Promise((r) => setTimeout(r, 1000))]);
    }
  });

  // Test 1: Delayed retry status consistency
  test("1. Delayed retry updates contact to QUEUED with future nextAttemptAt timestamp", async () => {
    const delayMs = 15 * 60 * 1000; // 15 minutes
    await enqueueContactRetry(campaignId, testContactId, 1, delayMs);

    const updated = await prisma.contact.findUnique({
      where: { id: testContactId },
    });

    assert.equal(updated?.status, "QUEUED", "Scheduled retry sets status to QUEUED");
    assert.ok(updated?.nextAttemptAt, "Must set nextAttemptAt timestamp");
    assert.ok(
      updated!.nextAttemptAt!.getTime() > Date.now(),
      "nextAttemptAt must be in the future"
    );
  });

  // Test 2: Filter by RETRYING returns correct contacts
  test("2. GET /api/campaigns/[id]?status=RETRYING returns contacts queued/pending with retryCount > 0", async () => {
    // Update contact to simulate retrying state
    await prisma.contact.update({
      where: { id: testContactId },
      data: {
        status: "PENDING",
        retryCount: 1,
      },
    });

    const req = new NextRequest(
      `http://localhost:3000/api/campaigns/${campaignId}?status=RETRYING`,
      {
        headers: { Cookie: sessionCookie },
      }
    );

    const res = await getCampaign(req, { params: Promise.resolve({ id: campaignId }) });
    const data = await res.json();

    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.data.contacts.items.length, 1);
    assert.equal(data.data.contacts.items[0].id, testContactId);
    assert.equal(data.data.contacts.items[0].isRetrying, true);
  });

  // Test 3: Campaign editing via PATCH /api/campaigns/[id]
  test("3. PATCH /api/campaigns/[id] updates configuration fields safely", async () => {
    const updatePayload = {
      name: "Updated Campaign Title",
      maxRequestsPerSecond: 8.0,
      dailyStartTime: "10:00",
      dailyEndTime: "20:00",
      retryIntervalMinutes: 45,
      maxRetries: 4,
      callerPhoneNumber: "+919876543211",
    };

    const req = new NextRequest(`http://localhost:3000/api/campaigns/${campaignId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie,
      },
      body: JSON.stringify(updatePayload),
    });

    const res = await updateCampaign(req, { params: Promise.resolve({ id: campaignId }) });
    const data = await res.json();

    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.data.name, "Updated Campaign Title");
    assert.equal(data.data.maxRequestsPerSecond, 8.0);
    assert.equal(data.data.dailyStartTime, "10:00");
    assert.equal(data.data.dailyEndTime, "20:00");
    assert.equal(data.data.retryIntervalMinutes, 45);
    assert.equal(data.data.maxRetries, 4);
    assert.equal(data.data.callerPhoneNumber, "+919876543211");
  });

  // Test 4: Webhook security in production mode
  test("4. Webhook rejects default secret when NODE_ENV is production", async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalSecret = process.env.WEBHOOK_SECRET;

    try {
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      process.env.WEBHOOK_SECRET = "local-dev-webhook-secret"; // Default dev secret in prod

      const req = new NextRequest("http://localhost:3000/api/webhooks/sarvam", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-webhook-secret": "local-dev-webhook-secret",
        },
        body: JSON.stringify({ attempt_id: "att_123", status: "completed" }),
      });

      const res = await handleWebhook(req);
      assert.equal(res.status, 500, "Must return 500 when dev secret is used in production");
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
      process.env.WEBHOOK_SECRET = originalSecret;
    }
  });

  // Test 5: Webhook authenticates with custom secret in production
  test("5. Webhook enforces secret token matching in production", async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalSecret = process.env.WEBHOOK_SECRET;

    try {
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      process.env.WEBHOOK_SECRET = "super_secure_production_webhook_secret_999";

      // Case A: Missing or invalid secret -> 401
      const badReq = new NextRequest("http://localhost:3000/api/webhooks/sarvam", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-webhook-secret": "wrong_secret",
        },
        body: JSON.stringify({ attempt_id: "att_123", status: "completed" }),
      });
      const badRes = await handleWebhook(badReq);
      assert.equal(badRes.status, 401, "Invalid secret must return 401");

      // Case B: Secret passed via query parameter (?secret=...) MUST be rejected with 401
      const queryReq = new NextRequest(
        "http://localhost:3000/api/webhooks/sarvam?secret=super_secure_production_webhook_secret_999",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attempt_id: "att_nonexistent", status: "completed" }),
        }
      );
      const queryRes = await handleWebhook(queryReq);
      assert.equal(queryRes.status, 401, "Secrets in query strings must be rejected");

      // Case C: Secret passed via Authorization: Bearer <token> header is accepted
      const bearerReq = new NextRequest(
        "http://localhost:3000/api/webhooks/sarvam",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer super_secure_production_webhook_secret_999",
          },
          body: JSON.stringify({ attempt_id: "att_nonexistent", status: "completed" }),
        }
      );
      const bearerRes = await handleWebhook(bearerReq);
      // Valid Bearer header passes auth check to attempt lookup (returns 404 because attempt does not exist)
      assert.equal(bearerRes.status, 404, "Authorized Bearer header request should reach attempt lookup");
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
      process.env.WEBHOOK_SECRET = originalSecret;
    }
  });

  // Test 6: Live call validation prevents placeholder values
  test("6. Live dispatch throws explicit error when placeholders are used instead of real carrier credentials", async () => {
    const originalMock = process.env.SARVAM_MOCK_MODE;
    const originalNodeEnv = process.env.NODE_ENV;
    const originalKey = process.env.SARVAM_API_KEY;

    try {
      process.env.SARVAM_MOCK_MODE = "false";
      (process.env as Record<string, string | undefined>).NODE_ENV = "development";
      process.env.SARVAM_API_KEY = "live_test_api_key_12345";

      // Campaign has placeholder callerPhoneNumber: "+10000000000" and placeholder connectionId: "mock_conn_id"
      const placeholderCampaign = await prisma.campaign.create({
        data: {
          name: "Placeholder Test Campaign",
          organizationId: org.id,
          workspaceId: workspace.id,
          status: "RUNNING",
          agentAppId: "mock_app_id", // Placeholder
          connectionId: "mock_conn_id", // Placeholder
          callerPhoneNumber: "+10000000000", // Placeholder
          dailyStartTime: "00:00",
          dailyEndTime: "23:59",
          allowedDays: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"],
        },
      });

      const placeholderContact = await prisma.contact.create({
        data: {
          campaignId: placeholderCampaign.id,
          workspaceId: workspace.id,
          phoneNumber: "+919876543299",
          status: "QUEUED",
        },
      });

      await assert.rejects(
        async () => {
          await processOutboundCallJob({
            campaignId: placeholderCampaign.id,
            contactId: placeholderContact.id,
            attemptNumber: 1,
          });
        },
        /invalid campaign telephony configuration/,
        "Must throw explicit validation error rejecting placeholders in live mode"
      );

      // Cleanup
      await prisma.contact.deleteMany({ where: { id: placeholderContact.id } });
      await prisma.campaign.deleteMany({ where: { id: placeholderCampaign.id } });
    } finally {
      process.env.SARVAM_MOCK_MODE = originalMock;
      (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
      process.env.SARVAM_API_KEY = originalKey;
    }
  });

  // Test 7: Production cannot accidentally use mock telephony
  test("7. Production environment rejects accidental mock telephony without explicit ALLOW_MOCK_TELEPHONY=true", async () => {
    const originalMock = process.env.SARVAM_MOCK_MODE;
    const originalNodeEnv = process.env.NODE_ENV;
    const originalAllow = process.env.ALLOW_MOCK_TELEPHONY;

    try {
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      process.env.SARVAM_MOCK_MODE = "true";
      delete process.env.ALLOW_MOCK_TELEPHONY;

      const prodCampaign = await prisma.campaign.create({
        data: {
          name: "Prod Mock Test Campaign",
          organizationId: org.id,
          workspaceId: workspace.id,
          status: "RUNNING",
          agentAppId: "agent_production_101",
          connectionId: "conn_trunk_01",
          callerPhoneNumber: "+14155552671",
          dailyStartTime: "00:00",
          dailyEndTime: "23:59",
          allowedDays: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"],
        },
      });

      const prodContact = await prisma.contact.create({
        data: {
          campaignId: prodCampaign.id,
          workspaceId: workspace.id,
          phoneNumber: "+919876543299",
          status: "QUEUED",
        },
      });

      await assert.rejects(
        async () => {
          await processOutboundCallJob({
            campaignId: prodCampaign.id,
            contactId: prodContact.id,
            attemptNumber: 1,
          });
        },
        /Cannot use mock telephony in production environment/,
        "Must throw error preventing mock telephony in production"
      );

      // Cleanup
      await prisma.contact.deleteMany({ where: { id: prodContact.id } });
      await prisma.campaign.deleteMany({ where: { id: prodCampaign.id } });
    } finally {
      process.env.SARVAM_MOCK_MODE = originalMock;
      (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
      if (originalAllow !== undefined) {
        process.env.ALLOW_MOCK_TELEPHONY = originalAllow;
      } else {
        delete process.env.ALLOW_MOCK_TELEPHONY;
      }
    }
  });
});
