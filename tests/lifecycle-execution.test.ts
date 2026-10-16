import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "../src/lib/prisma";
import { POST as executeLifecycle } from "../src/app/api/campaigns/[id]/[action]/route";
import { POST as handleWebhook } from "../src/app/api/webhooks/sarvam/route";
import { isCallingWindowOpen } from "../src/lib/scheduler";
import { processOutboundCallJob } from "../src/lib/execution-engine";
import { outboundCallQueue } from "../src/lib/queue";
import { redis } from "../src/lib/redis";

describe("Campaign Lifecycle, Execution Engine, and Webhook Retries", () => {
  let campaignId: string;
  let emptyCampaignId: string;
  let testContactId: string;

  let sessionCookie: string;
  let testSessionToken: string;

  before(async () => {
    let org = await prisma.organization.findUnique({
      where: { slug: "acme-corp" },
      include: {
        workspaces: { where: { slug: "default" } },
        users: { where: { email: "admin@acme.com" } },
      },
    });

    if (!org) {
      org = await prisma.organization.create({
        data: {
          name: "Acme Corporation",
          slug: "acme-corp",
          rateLimitPerMinute: 600,
          workspaces: {
            create: { name: "Default Workspace", slug: "default" },
          },
          users: {
            create: {
              email: "admin@acme.com",
              name: "Admin User",
              role: "OWNER",
            },
          },
        },
        include: {
          workspaces: true,
          users: true,
        },
      });
    }

    let ws = org.workspaces[0];
    if (!ws) {
      ws = await prisma.workspace.create({
        data: { name: "Default Workspace", slug: "default", organizationId: org.id },
      });
    }

    let user = org.users[0];
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: "admin@acme.com",
          name: "Admin User",
          role: "OWNER",
          organizationId: org.id,
        },
      });
    }

    testSessionToken = `test-lifecycle-${randomUUID()}`;
    const session = await prisma.session.create({
      data: {
        userId: user.id,
        sessionToken: testSessionToken,
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    sessionCookie = `session_token=${session.sessionToken}`;

    // Campaign with contacts
    const campaign = await prisma.campaign.create({
      data: {
        name: "Lifecycle Test Campaign",
        workspaceId: ws.id,
        organizationId: org.id,
        agentAppId: "app_voice_test",
        agentVersion: "v1",
        dailyStartTime: "00:00",
        dailyEndTime: "23:59",
        timezone: "UTC",
        allowedDays: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"],
        maxRequestsPerSecond: 10,
        maxRetries: 2,
        retryIntervalMinutes: 5,
        retryOnBusy: true,
        retryOnNoAnswer: true,
      },
    });
    campaignId = campaign.id;

    // Contact
    const contact = await prisma.contact.create({
      data: {
        campaignId: campaign.id,
        workspaceId: ws.id,
        phoneNumber: "+919876543200",
        firstName: "Test",
        lastName: "Lead",
        status: "PENDING",
      },
    });
    testContactId = contact.id;

    // Empty campaign with 0 contacts
    const emptyCampaign = await prisma.campaign.create({
      data: {
        name: "Empty Test Campaign",
        workspaceId: ws.id,
        organizationId: org.id,
      },
    });
    emptyCampaignId = emptyCampaign.id;
  });

  after(async () => {
    try {
      if (testSessionToken) {
        await prisma.session.deleteMany({ where: { sessionToken: testSessionToken } });
      }
      await prisma.callAttempt.deleteMany({ where: { campaignId } });
      await prisma.contact.deleteMany({ where: { campaignId } });
      await prisma.campaign.deleteMany({ where: { id: { in: [campaignId, emptyCampaignId] } } });
    } finally {
      await Promise.race([outboundCallQueue.close(), new Promise((r) => setTimeout(r, 1000))]);
      if (redis.status === "ready" || redis.status === "connecting") {
        await Promise.race([redis.quit(), new Promise((r) => setTimeout(r, 1000))]);
      }
      redis.disconnect();
      await Promise.race([prisma.$disconnect(), new Promise((r) => setTimeout(r, 1000))]);
    }
  });

  test("Cannot start campaign with 0 contacts (400 NO_CONTACTS)", async () => {
    const req = new NextRequest(`http://localhost:3000/api/campaigns/${emptyCampaignId}/start`, {
      method: "POST",
      headers: { Cookie: sessionCookie },
    });

    const res = await executeLifecycle(req, {
      params: Promise.resolve({ id: emptyCampaignId, action: "start" }),
    });
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.success, false);
    assert.equal(body.error.code, "NO_CONTACTS");
  });

  test("Valid start transitions campaign from DRAFT to RUNNING", async () => {
    const req = new NextRequest(`http://localhost:3000/api/campaigns/${campaignId}/start`, {
      method: "POST",
      headers: { Cookie: sessionCookie },
    });

    const res = await executeLifecycle(req, {
      params: Promise.resolve({ id: campaignId, action: "start" }),
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.status, "RUNNING");
    assert.ok(body.data.enqueuedContacts >= 1);

    const updated = await prisma.campaign.findUnique({ where: { id: campaignId } });
    assert.equal(updated?.status, "RUNNING");
  });

  test("Start is idempotent if campaign is already RUNNING", async () => {
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
  });

  test("Pause transitions RUNNING campaign to PAUSED and stops dispatches", async () => {
    const req = new NextRequest(`http://localhost:3000/api/campaigns/${campaignId}/pause`, {
      method: "POST",
      headers: { Cookie: sessionCookie },
    });

    const res = await executeLifecycle(req, {
      params: Promise.resolve({ id: campaignId, action: "pause" }),
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.status, "PAUSED");

    const updated = await prisma.campaign.findUnique({ where: { id: campaignId } });
    assert.equal(updated?.status, "PAUSED");

    // Worker must skip dispatch when campaign is PAUSED
    const workerResult = await processOutboundCallJob({
      campaignId,
      contactId: testContactId,
      attemptNumber: 1,
    });
    assert.equal(workerResult.status, "SKIPPED");
    assert.ok(workerResult.reason?.includes("PAUSED"));
  });

  test("Resume transitions PAUSED campaign back to RUNNING", async () => {
    const req = new NextRequest(`http://localhost:3000/api/campaigns/${campaignId}/resume`, {
      method: "POST",
      headers: { Cookie: sessionCookie },
    });

    const res = await executeLifecycle(req, {
      params: Promise.resolve({ id: campaignId, action: "resume" }),
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.status, "RUNNING");

    const updated = await prisma.campaign.findUnique({ where: { id: campaignId } });
    assert.equal(updated?.status, "RUNNING");
  });

  test("Calling window restrictions properly detect disallowed hours and days", () => {
    // Calling window 09:00 - 17:00 UTC
    const scheduleConfig = {
      dailyStartTime: "09:00",
      dailyEndTime: "17:00",
      timezone: "UTC",
      allowedDays: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
    };

    // 08:30 UTC -> Before window
    const earlyTime = new Date("2026-10-15T08:30:00Z");
    const earlyCheck = isCallingWindowOpen(scheduleConfig, earlyTime);
    assert.equal(earlyCheck.isAllowed, false);
    assert.ok(earlyCheck.reason?.includes("Before daily start time"));

    // 12:00 UTC on Thursday (2026-10-15 is Thursday) -> Allowed
    const openTime = new Date("2026-10-15T12:00:00Z");
    const openCheck = isCallingWindowOpen(scheduleConfig, openTime);
    assert.equal(openCheck.isAllowed, true);

    // 19:00 UTC -> After window
    const lateTime = new Date("2026-10-15T19:00:00Z");
    const lateCheck = isCallingWindowOpen(scheduleConfig, lateTime);
    assert.equal(lateCheck.isAllowed, false);
    assert.ok(lateCheck.reason?.includes("After daily end time"));

    // Weekend (2026-10-18 is Sunday) -> Disallowed day
    const sundayTime = new Date("2026-10-18T12:00:00Z");
    const sundayCheck = isCallingWindowOpen(scheduleConfig, sundayTime);
    assert.equal(sundayCheck.isAllowed, false);
    assert.ok(sundayCheck.reason?.includes("SUNDAY"));
  });

  test("Execution engine dispatches mock call and updates durable database state", async () => {
    // Reset contact to QUEUED
    await prisma.contact.update({
      where: { id: testContactId },
      data: { status: "QUEUED", retryCount: 0 },
    });

    const result = await processOutboundCallJob({
      campaignId,
      contactId: testContactId,
      attemptNumber: 1,
    });

    assert.equal(result.status, "DISPATCHED");
    assert.ok(result.attemptId?.startsWith("mock_att_"));

    // Verify database updates
    const contactAfter = await prisma.contact.findUnique({ where: { id: testContactId } });
    assert.equal(contactAfter?.status, "IN_PROGRESS");
    assert.equal(contactAfter?.retryCount, 1);

    const attempt = await prisma.callAttempt.findFirst({
      where: { externalCallId: result.attemptId },
    });
    assert.ok(attempt);
    assert.equal(attempt.status, "RINGING");
  });

  test("Webhook outcome processing: ANSWERED completes contact", async () => {
    const attempt = await prisma.callAttempt.findFirst({
      where: { contactId: testContactId },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(attempt?.externalCallId);

    const webhookPayload = {
      attempt_id: attempt.externalCallId,
      status: "completed",
      duration_seconds: 45,
      start_time: new Date().toISOString(),
      close_time: new Date().toISOString(),
    };

    const req = new NextRequest("http://localhost:3000/api/webhooks/sarvam", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(webhookPayload),
    });

    const res = await handleWebhook(req);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.attemptStatus, "ANSWERED");
    assert.equal(body.data.contactStatus, "COMPLETED");
    assert.equal(body.data.retrying, false);

    const contactAfter = await prisma.contact.findUnique({ where: { id: testContactId } });
    assert.equal(contactAfter?.status, "COMPLETED");
  });

  test("Webhook retry rules: BUSY outcome triggers retry backoff", async () => {
    // Reset contact to attempt 1
    await prisma.contact.update({
      where: { id: testContactId },
      data: { status: "IN_PROGRESS", retryCount: 1 },
    });

    const attempt = await prisma.callAttempt.create({
      data: {
        campaignId,
        contactId: testContactId,
        attemptNumber: 1,
        externalCallId: "mock_att_busy_test_" + Date.now(),
        status: "RINGING",
      },
    });

    const webhookPayload = {
      attempt_id: attempt.externalCallId!,
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
    assert.equal(body.data.retrying, true);
    assert.equal(body.data.contactStatus, "QUEUED");

    const contactAfter = await prisma.contact.findUnique({ where: { id: testContactId } });
    assert.equal(contactAfter?.status, "QUEUED");
    assert.ok(contactAfter?.nextAttemptAt);
  });

  test("Max retries exceeded marks contact FAILED without rescheduling", async () => {
    // Set contact at maxRetries (2)
    await prisma.contact.update({
      where: { id: testContactId },
      data: { status: "IN_PROGRESS", retryCount: 2 },
    });

    const attempt = await prisma.callAttempt.create({
      data: {
        campaignId,
        contactId: testContactId,
        attemptNumber: 2,
        externalCallId: "mock_att_max_retries_" + Date.now(),
        status: "RINGING",
      },
    });

    const webhookPayload = {
      attempt_id: attempt.externalCallId!,
      status: "no_answer",
      duration_seconds: 0,
      disconnection_reason: "Ring timeout",
    };

    const req = new NextRequest("http://localhost:3000/api/webhooks/sarvam", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(webhookPayload),
    });

    const res = await handleWebhook(req);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.retrying, false);
    assert.equal(body.data.contactStatus, "FAILED");

    const contactAfter = await prisma.contact.findUnique({ where: { id: testContactId } });
    assert.equal(contactAfter?.status, "FAILED");

    // Duplicate webhook delivery test: Send same webhook again with fresh request instance
    const dupReq = new NextRequest("http://localhost:3000/api/webhooks/sarvam", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(webhookPayload),
    });
    const dupRes = await handleWebhook(dupReq);
    const dupBody = await dupRes.json();
    assert.equal(dupRes.status, 200);
    assert.equal(dupBody.success, true);
    assert.equal(dupBody.data.retrying, false);
    assert.match(dupBody.message, /already finalized/i);
  });

  test("Short duration call triggers retry when retryOnShortDuration is enabled", async () => {
    // Configure campaign for short duration retries
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { retryOnShortDuration: true, shortDurationThresholdSeconds: 15 },
    });

    const shortContact = await prisma.contact.create({
      data: {
        campaignId,
        workspaceId: (await prisma.campaign.findUnique({ where: { id: campaignId } }))!.workspaceId,
        phoneNumber: "+919876543299",
        status: "IN_PROGRESS",
        retryCount: 0,
      },
    });

    const shortAttempt = await prisma.callAttempt.create({
      data: {
        campaignId,
        contactId: shortContact.id,
        attemptNumber: 1,
        externalCallId: "mock_att_short_dur_" + Date.now(),
        status: "RINGING",
      },
    });

    const webhookPayload = {
      attempt_id: shortAttempt.externalCallId!,
      status: "answered",
      duration_seconds: 5, // < 15 seconds threshold
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
    assert.equal(body.data.retrying, true, "Short duration call should be retried");
    assert.equal(body.data.contactStatus, "QUEUED");
  });

  test("Atomic worker claim prevents duplicate dispatches between parallel workers", async () => {
    const ws = (await prisma.campaign.findUnique({ where: { id: campaignId } }))!.workspaceId;
    const raceContact = await prisma.contact.create({
      data: {
        campaignId,
        workspaceId: ws,
        phoneNumber: "+919876543255",
        status: "QUEUED",
        retryCount: 0,
      },
    });

    // Simulate 2 parallel workers picking up the same job simultaneously
    const jobData = {
      campaignId,
      contactId: raceContact.id,
      attemptNumber: 1,
    };

    const [workerA, workerB] = await Promise.all([
      processOutboundCallJob(jobData),
      processOutboundCallJob(jobData),
    ]);

    const statuses = [workerA.status, workerB.status];
    assert.ok(statuses.includes("DISPATCHED"), "One worker must successfully dispatch");
    assert.ok(statuses.includes("SKIPPED"), "Second concurrent worker must be skipped");

    // Verify only 1 CallAttempt was created
    const attempts = await prisma.callAttempt.findMany({
      where: { contactId: raceContact.id },
    });
    assert.equal(attempts.length, 1, "Only one CallAttempt must be created despite parallel workers");
  });

  test("Stop transitions campaign to CANCELLED and halts all retries", async () => {
    const req = new NextRequest(`http://localhost:3000/api/campaigns/${campaignId}/stop`, {
      method: "POST",
      headers: { Cookie: sessionCookie },
    });

    const res = await executeLifecycle(req, {
      params: Promise.resolve({ id: campaignId, action: "stop" }),
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.status, "CANCELLED");

    // Attempting to start stopped campaign must be rejected
    const startReq = new NextRequest(`http://localhost:3000/api/campaigns/${campaignId}/start`, {
      method: "POST",
      headers: { Cookie: sessionCookie },
    });
    const startRes = await executeLifecycle(startReq, {
      params: Promise.resolve({ id: campaignId, action: "start" }),
    });
    assert.equal(startRes.status, 400);
  });
});
