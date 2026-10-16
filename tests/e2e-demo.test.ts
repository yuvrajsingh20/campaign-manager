import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { redis } from "../src/lib/redis";
import { outboundCallQueue } from "../src/lib/queue";
import { OrgRateLimiter } from "../src/lib/rate-limiter";
import { processOutboundCallJob } from "../src/lib/execution-engine";

import { POST as createCampaign } from "../src/app/api/campaigns/route";
import { GET as getSampleCsv } from "../src/app/api/campaigns/[id]/contacts/sample/route";
import { POST as uploadContacts } from "../src/app/api/campaigns/[id]/contacts/upload/route";
import { POST as executeLifecycle } from "../src/app/api/campaigns/[id]/[action]/route";
import { POST as handleWebhook } from "../src/app/api/webhooks/sarvam/route";

describe("End-to-End Acceptance Flow (Steps 1 - 12)", () => {
  let workspaceId: string;
  let organizationId: string;
  let campaignId: string;
  let validContactAId: string;
  let validContactBId: string;
  let callAttemptAId: string;
  let externalCallAId: string;
  let externalCallBId: string;
  let sessionCookie: string;
  let testSessionToken: string;

  before(async () => {
    // 1. Setup Organization & Workspace
    const org = await prisma.organization.upsert({
      where: { slug: "e2e-demo-org" },
      update: { rateLimitPerMinute: 300 }, // 5 RPS
      create: { name: "E2E Demo Organization", slug: "e2e-demo-org", rateLimitPerMinute: 300 },
    });
    organizationId = org.id;

    const ws = await prisma.workspace.upsert({
      where: { organizationId_slug: { organizationId: org.id, slug: "e2e-workspace" } },
      update: {},
      create: { name: "E2E Demo Workspace", slug: "e2e-workspace", organizationId: org.id },
    });
    workspaceId = ws.id;

    const user = await prisma.user.upsert({
      where: { email: "e2e-owner@e2edemo.com" },
      update: { organizationId: org.id },
      create: {
        email: "e2e-owner@e2edemo.com",
        name: "E2E Owner",
        role: "OWNER",
        organizationId: org.id,
      },
    });

    testSessionToken = `test_token_e2e_${randomUUID()}`;
    const session = await prisma.session.create({
      data: {
        userId: user.id,
        sessionToken: testSessionToken,
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    sessionCookie = `session_token=${session.sessionToken}`;
  });

  after(async () => {
    try {
      if (testSessionToken) {
        await prisma.session.deleteMany({ where: { sessionToken: testSessionToken } });
      }
      if (campaignId) {
        await prisma.callAttempt.deleteMany({ where: { campaignId } });
        await prisma.contact.deleteMany({ where: { campaignId } });
        await prisma.campaign.deleteMany({ where: { id: campaignId } });
      }
      await redis.del(`ratelimit:org:${organizationId}`);
    } finally {
      await Promise.race([outboundCallQueue.close(), new Promise((r) => setTimeout(r, 1000))]);
      if (redis.status === "ready" || redis.status === "connecting") {
        await Promise.race([redis.quit(), new Promise((r) => setTimeout(r, 1000))]);
      }
      redis.disconnect();
      await Promise.race([prisma.$disconnect(), new Promise((r) => setTimeout(r, 1000))]);
    }
  });

  test("Step 1: Create a campaign via REST API", async () => {
    const payload = {
      name: "Q4 Customer Retention Voice Outreach",
      description: "Automated renewal outreach for high-value subscribers",
      workspaceId,
      agentAppId: "agent_retention_v2",
      agentVersion: "v1.0",
      agentType: "outbound_voice",
      connectionId: "conn_telephony_telnyx_main",
      callerPhoneNumber: "+14155552671",
      maxRequestsPerSecond: 5,
      dailyStartTime: "00:00",
      dailyEndTime: "23:59",
      timezone: "UTC",
      allowedDays: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"],
      maxRetries: 3,
      retryIntervalMinutes: 10,
      retryOnBusy: true,
      retryOnNoAnswer: true,
      retryOnShortDuration: true,
      shortDurationThresholdSeconds: 12,
      requiredVariables: ["account_tier", "renewal_discount"],
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
    assert.equal(body.data.name, payload.name);
    assert.equal(body.data.status, "DRAFT");

    campaignId = body.data.id;
    assert.ok(campaignId);
  });

  test("Step 2: Download sample cohort CSV tailored to campaign required variables", async () => {
    const req = new NextRequest(`http://localhost:3000/api/campaigns/${campaignId}/contacts/sample`, {
      headers: { Cookie: sessionCookie },
    });
    const res = await getSampleCsv(req, { params: Promise.resolve({ id: campaignId }) });
    const csvContent = await res.text();

    assert.equal(res.status, 200);
    assert.match(csvContent, /phone_number/);
    assert.match(csvContent, /account_tier/);
    assert.match(csvContent, /renewal_discount/);
  });

  test("Step 3 & 4: Upload CSV cohort and verify valid rows accepted while invalid rows rejected", async () => {
    // CSV with:
    // Row 1: Valid lead A
    // Row 2: Valid lead B
    // Row 3: Invalid row (bad phone number format)
    // Row 4: Invalid row (missing required variable 'account_tier')
    const csvData = [
      "lead_id,phone_number,first_name,last_name,account_tier,renewal_discount",
      "lead_101,+919876543201,Priya,Nair,Enterprise,20%",
      "lead_102,+919876543202,Karan,Mehta,Pro,15%",
      "lead_103,NOT_A_PHONE,Invalid,Contact,Basic,5%",
      "lead_104,+919876543204,Missing,Tier,,10%",
    ].join("\n");

    const formData = new FormData();
    const file = new Blob([csvData], { type: "text/csv" });
    formData.append("file", file, "cohort.csv");

    const req = new NextRequest(
      `http://localhost:3000/api/campaigns/${campaignId}/contacts/upload`,
      {
        method: "POST",
        headers: { Cookie: sessionCookie },
        body: formData,
      }
    );

    const res = await uploadContacts(req, { params: Promise.resolve({ id: campaignId }) });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.totalRowsProcessed, 4);
    assert.equal(body.data.acceptedRows, 2, "Exactly 2 valid rows must be accepted");
    assert.equal(body.data.rejectedRows, 2, "Exactly 2 invalid rows must be rejected");

    // Fetch the 2 saved contacts
    const contacts = await prisma.contact.findMany({
      where: { campaignId },
      orderBy: { phoneNumber: "asc" },
    });
    assert.equal(contacts.length, 2);
    assert.equal(contacts[0].status, "PENDING");
    assert.equal(contacts[1].status, "PENDING");

    validContactAId = contacts[0].id;
    validContactBId = contacts[1].id;
  });

  test("Step 5 & 6: Start campaign and observe contacts entering execution pipeline", async () => {
    const req = new NextRequest(`http://localhost:3000/api/campaigns/${campaignId}/start`, {
      method: "POST",
      headers: { Cookie: sessionCookie },
    });

    const res = await executeLifecycle(req, {
      params: Promise.resolve({ id: campaignId, action: "start" }),
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.status, "RUNNING");
    assert.equal(body.data.enqueuedContacts, 2);

    // Verify contacts transitioned to QUEUED in PostgreSQL
    const contacts = await prisma.contact.findMany({ where: { campaignId } });
    for (const c of contacts) {
      assert.equal(c.status, "QUEUED");
    }
  });

  test("Step 7: Dispatch call job and verify attempt and contact status changes", async () => {
    const execResult = await processOutboundCallJob({
      campaignId,
      contactId: validContactAId,
      attemptNumber: 1,
    });

    assert.equal(execResult.status, "DISPATCHED");
    assert.ok(execResult.attemptId);
    externalCallAId = execResult.attemptId!;

    // Verify contact is now IN_PROGRESS
    const contact = await prisma.contact.findUnique({ where: { id: validContactAId } });
    assert.equal(contact?.status, "IN_PROGRESS");
    assert.equal(contact?.retryCount, 1);

    // Verify persistent CallAttempt record
    const attempt = await prisma.callAttempt.findFirst({
      where: { contactId: validContactAId, externalCallId: externalCallAId },
    });
    assert.ok(attempt);
    assert.equal(attempt.status, "RINGING");
    callAttemptAId = attempt.id;
  });

  test("Step 8: Simulate answered call via webhook and verify contact COMPLETED", async () => {
    const webhookPayload = {
      attempt_id: externalCallAId,
      status: "completed",
      duration_seconds: 45,
      metadata: { attempt_id: callAttemptAId },
    };

    const req = new NextRequest("http://localhost:3000/api/webhooks/sarvam", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(webhookPayload),
    });

    const res = await handleWebhook(req);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.attemptStatus, "ANSWERED");
    assert.equal(body.data.retrying, false);
    assert.equal(body.data.contactStatus, "COMPLETED");

    const contact = await prisma.contact.findUnique({ where: { id: validContactAId } });
    assert.equal(contact?.status, "COMPLETED");
  });

  test("Step 9: Dispatch contact B, simulate BUSY outcome, and verify retry behaviour", async () => {
    const execResult = await processOutboundCallJob({
      campaignId,
      contactId: validContactBId,
      attemptNumber: 1,
    });

    assert.equal(execResult.status, "DISPATCHED");
    externalCallBId = execResult.attemptId!;

    const webhookPayload = {
      attempt_id: externalCallBId,
      status: "busy",
      duration_seconds: 0,
      disconnection_reason: "User busy",
    };

    const req = new NextRequest("http://localhost:3000/api/webhooks/sarvam", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(webhookPayload),
    });

    const res = await handleWebhook(req);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.attemptStatus, "BUSY");
    assert.equal(body.data.retrying, true, "Busy call must trigger retry");
    assert.equal(body.data.contactStatus, "QUEUED");

    const contact = await prisma.contact.findUnique({ where: { id: validContactBId } });
    assert.equal(contact?.status, "QUEUED");
    assert.ok(contact?.nextAttemptAt);
  });

  test("Step 10: Pause and Resume the campaign", async () => {
    // Pause
    const pauseReq = new NextRequest(`http://localhost:3000/api/campaigns/${campaignId}/pause`, {
      method: "POST",
      headers: { Cookie: sessionCookie },
    });
    const pauseRes = await executeLifecycle(pauseReq, {
      params: Promise.resolve({ id: campaignId, action: "pause" }),
    });
    const pauseBody = await pauseRes.json();

    assert.equal(pauseRes.status, 200);
    assert.equal(pauseBody.data.status, "PAUSED");

    // Recheck DB
    const campaignPaused = await prisma.campaign.findUnique({ where: { id: campaignId } });
    assert.equal(campaignPaused?.status, "PAUSED");

    // Resume
    const resumeReq = new NextRequest(`http://localhost:3000/api/campaigns/${campaignId}/resume`, {
      method: "POST",
      headers: { Cookie: sessionCookie },
    });
    const resumeRes = await executeLifecycle(resumeReq, {
      params: Promise.resolve({ id: campaignId, action: "resume" }),
    });
    const resumeBody = await resumeRes.json();

    assert.equal(resumeRes.status, 200);
    assert.equal(resumeBody.data.status, "RUNNING");

    const campaignResumed = await prisma.campaign.findUnique({ where: { id: campaignId } });
    assert.equal(campaignResumed?.status, "RUNNING");
  });

  test("Step 11: Stop the campaign and verify all future dispatches and retries cease", async () => {
    const stopReq = new NextRequest(`http://localhost:3000/api/campaigns/${campaignId}/stop`, {
      method: "POST",
      headers: { Cookie: sessionCookie },
    });
    const stopRes = await executeLifecycle(stopReq, {
      params: Promise.resolve({ id: campaignId, action: "stop" }),
    });
    const stopBody = await stopRes.json();

    assert.equal(stopRes.status, 200);
    assert.equal(stopBody.data.status, "CANCELLED");

    // Subsequent start attempt must be rejected
    const startReq = new NextRequest(`http://localhost:3000/api/campaigns/${campaignId}/start`, {
      method: "POST",
      headers: { Cookie: sessionCookie },
    });
    const startRes = await executeLifecycle(startReq, {
      params: Promise.resolve({ id: campaignId, action: "start" }),
    });
    assert.equal(startRes.status, 400);

    // Verify contact status is set to DO_NOT_CALL
    const contact = await prisma.contact.findUnique({ where: { id: validContactBId } });
    assert.equal(contact?.status, "DO_NOT_CALL");
  });

  test("Step 12: Concurrency test against organisation-wide rate limiter", async () => {
    // Reset test org key so full bucket of 5 is available for this step
    await redis.del(`ratelimit:org:${organizationId}`);

    // Acquire 25 concurrent requests against an organization limit of 5 requests per second
    const limit = 5;
    const promises = Array.from({ length: 25 }, () =>
      OrgRateLimiter.acquire(organizationId, limit, limit, 1000)
    );

    const results = await Promise.all(promises);
    const allowed = results.filter((r) => r.allowed).length;
    const denied = results.filter((r) => !r.allowed).length;

    assert.equal(allowed, limit, `Exactly ${limit} requests must be allowed within the rolling 1-second window`);
    assert.equal(denied, 20, "Excess concurrent requests must be rejected with positive retryAfterMs");

    const firstDenied = results.find((r) => !r.allowed);
    assert.ok(firstDenied);
    assert.ok(firstDenied.retryAfterMs > 0, "Denied request must return backoff delay");
  });
});
