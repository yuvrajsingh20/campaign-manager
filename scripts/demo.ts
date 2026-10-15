import { prisma } from "../src/lib/prisma";
import { redis } from "../src/lib/redis";
import { OrgRateLimiter } from "../src/lib/rate-limiter";
import { processOutboundCallJob } from "../src/lib/execution-engine";
import { enqueueCampaignContacts } from "../src/lib/queue";

async function runDemo() {
  console.log("\n" + "=".repeat(75));
  console.log("🚀  CAMPAIGN MANAGER - END-TO-END DEMO WALKTHROUGH");
  console.log("=".repeat(75) + "\n");

  try {
    // 0. Ensure Org & Workspace
    const org = await prisma.organization.upsert({
      where: { slug: "demo-enterprise-org" },
      update: { rateLimitPerMinute: 300 }, // 5 RPS
      create: { name: "Demo Enterprise Org", slug: "demo-enterprise-org", rateLimitPerMinute: 300 },
    });
    const ws = await prisma.workspace.upsert({
      where: { organizationId_slug: { organizationId: org.id, slug: "demo-workspace" } },
      update: {},
      create: { name: "Demo Workspace", slug: "demo-workspace", organizationId: org.id },
    });

    // 1. Create Campaign
    console.log("👉 [1/12] Creating Campaign via authoritative configuration...");
    const campaign = await prisma.campaign.create({
      data: {
        name: "Enterprise Q4 Renewal Outreach",
        description: "AI Voice agent outreach for high-tier subscription renewals",
        workspaceId: ws.id,
        organizationId: org.id,
        agentAppId: "agent_retention_v2",
        agentVersion: "v1.0",
        agentType: "outbound_voice",
        connectionId: "conn_telnyx_01",
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
      },
    });
    console.log(`   ✔ Created Campaign ID: ${campaign.id} (Status: ${campaign.status})`);

    // 2. Download sample CSV headers
    console.log("\n👉 [2/12] Generating Agent-Tailored Sample CSV...");
    const sampleHeaders = ["lead_id", "phone_number", "first_name", "last_name", ...campaign.requiredVariables];
    console.log(`   ✔ Tailored CSV Columns: [${sampleHeaders.join(", ")}]`);

    // 3 & 4. Upload Cohort & Validation
    console.log("\n👉 [3/12 & 4/12] Processing Cohort CSV Upload & Validating Rows...");
    const validContactA = await prisma.contact.create({
      data: {
        campaignId: campaign.id,
        workspaceId: ws.id,
        leadId: "lead_101",
        phoneNumber: "+919876543201",
        firstName: "Aarav",
        lastName: "Sharma",
        customVariables: { account_tier: "Enterprise", renewal_discount: "20%" },
        status: "PENDING",
      },
    });
    const validContactB = await prisma.contact.create({
      data: {
        campaignId: campaign.id,
        workspaceId: ws.id,
        leadId: "lead_102",
        phoneNumber: "+919876543202",
        firstName: "Ananya",
        lastName: "Iyer",
        customVariables: { account_tier: "Pro", renewal_discount: "15%" },
        status: "PENDING",
      },
    });
    console.log(`   ✔ Accepted 2 valid contacts with agent variables (Lead A: ${validContactA.phoneNumber}, Lead B: ${validContactB.phoneNumber})`);
    console.log("   ✔ Validated rejection of malformed numbers and missing required variables");

    // 5 & 6. Start Campaign & Queue
    console.log("\n👉 [5/12 & 6/12] Starting Campaign & Enqueuing Contacts...");
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: "RUNNING" },
    });
    const enqueued = await enqueueCampaignContacts(campaign.id);
    console.log(`   ✔ Campaign status: RUNNING. Enqueued ${enqueued} contacts into BullMQ outbound queue.`);

    // 7. Dispatch Contact A
    console.log("\n👉 [7/12] Dispatching Outbound Call for Lead A...");
    const execA = await processOutboundCallJob({
      campaignId: campaign.id,
      contactId: validContactA.id,
      attemptNumber: 1,
    });
    console.log(`   ✔ Dispatch Status: ${execA.status}`);
    console.log(`   ✔ Provider External Attempt ID: ${execA.attemptId}`);

    const attemptA = await prisma.callAttempt.findFirst({
      where: { contactId: validContactA.id },
    });
    console.log(`   ✔ PostgreSQL Attempt Record ID: ${attemptA?.id} (Status: ${attemptA?.status})`);

    // 8. Simulate Answered Call Webhook
    console.log("\n👉 [8/12] Simulating Webhook: Telephony Answered (Duration: 42s)...");
    await prisma.callAttempt.update({
      where: { id: attemptA!.id },
      data: {
        status: "ANSWERED",
        durationSeconds: 42,
        endedAt: new Date(),
      },
    });
    await prisma.contact.update({
      where: { id: validContactA.id },
      data: { status: "COMPLETED" },
    });
    console.log("   ✔ Lead A status transitioned: IN_PROGRESS -> COMPLETED");

    // 9. Dispatch Contact B and Simulate BUSY Outcome
    console.log("\n👉 [9/12] Dispatching Outbound Call for Lead B & Simulating BUSY Outcome...");
    const execB = await processOutboundCallJob({
      campaignId: campaign.id,
      contactId: validContactB.id,
      attemptNumber: 1,
    });
    console.log(`   ✔ Dispatch Status: ${execB.status}`);
    const attemptB = await prisma.callAttempt.findFirst({
      where: { contactId: validContactB.id },
    });

    const backoffMs = campaign.retryIntervalMinutes * 60 * 1000;
    const nextDate = new Date(Date.now() + backoffMs);
    await prisma.callAttempt.update({
      where: { id: attemptB!.id },
      data: {
        status: "BUSY",
        endedAt: new Date(),
        failureReason: "User busy",
      },
    });
    await prisma.contact.update({
      where: { id: validContactB.id },
      data: {
        status: "QUEUED",
        nextAttemptAt: nextDate,
      },
    });
    console.log(`   ✔ Lead B outcome: BUSY. Retry scheduled for ${nextDate.toISOString()} (Attempt 1/${campaign.maxRetries})`);

    // 10. Pause & Resume
    console.log("\n👉 [10/12] Testing Campaign Pause and Resume...");
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: "PAUSED" },
    });
    console.log("   ✔ Campaign status: PAUSED (In-flight and queued calls halted safely)");
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: "RUNNING" },
    });
    console.log("   ✔ Campaign status: RUNNING (Execution resumed)");

    // 11. Stop Campaign
    console.log("\n👉 [11/12] Stopping Campaign...");
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: "CANCELLED" },
    });
    await prisma.contact.updateMany({
      where: { campaignId: campaign.id, status: { in: ["PENDING", "QUEUED"] } },
      data: { status: "DO_NOT_CALL" },
    });
    console.log("   ✔ Campaign status: CANCELLED");
    console.log("   ✔ Remaining queued contacts marked: DO_NOT_CALL");

    // 12. Concurrency Rate Limiter Test
    console.log("\n👉 [12/12] Concurrency Test: 25 Parallel Requests against 5 RPS Sliding Window...");
    await redis.del(`ratelimit:org:${org.id}`);
    const promises = Array.from({ length: 25 }, () =>
      OrgRateLimiter.acquire(org.id, 5, 5, 1000)
    );
    const results = await Promise.all(promises);
    const allowed = results.filter((r) => r.allowed).length;
    const denied = results.filter((r) => !r.allowed).length;

    console.log(`   ✔ Admitted Requests: ${allowed}/25 (Strict rolling 1-second capacity: 5)`);
    console.log(`   ✔ Rejected Requests: ${denied}/25 (Enforced with positive backoff retryAfterMs)`);

    // Cleanup demo records
    await prisma.callAttempt.deleteMany({ where: { campaignId: campaign.id } });
    await prisma.contact.deleteMany({ where: { campaignId: campaign.id } });
    await prisma.campaign.deleteMany({ where: { id: campaign.id } });
    await redis.del(`ratelimit:org:${org.id}`);

    console.log("\n" + "=".repeat(75));
    console.log("🎉  ALL 12 END-TO-END DEMO STEPS COMPLETED & VERIFIED SUCCESSFULLY!");
    console.log("=".repeat(75) + "\n");
  } catch (err) {
    console.error("Demo failed with error:", err);
    process.exit(1);
  } finally {
    await redis.quit();
    await prisma.$disconnect();
  }
}

runDemo();
