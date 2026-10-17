import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { redis } from "../src/lib/redis";
import { OrgRateLimiter } from "../src/lib/rate-limiter";
import { processOutboundCallJob } from "../src/lib/execution-engine";
import { outboundCallQueue } from "../src/lib/queue";
import {
  REQUESTS_PER_SECOND_STEP,
  validateCampaignRequestsPerSecond,
} from "../src/lib/validations/rate-limit";

describe("Campaign rate limit policy", () => {
  test("step is 0.1 so decimal requests per second are supported", () => {
    assert.equal(REQUESTS_PER_SECOND_STEP, 0.1);
  });

  test("entered values 1, 2, 2.1, and 5 are valid within an organisation ceiling of 5", () => {
    for (const raw of ["1", "2", "2.1", "5", 1, 2, 2.1, 5]) {
      const result = validateCampaignRequestsPerSecond(raw, 5);
      assert.equal(result.ok, true, `expected ${String(raw)} to be accepted`);
      if (result.ok) {
        assert.equal(result.value, Number(raw));
      }
    }
  });

  test("invalid rate limit values are rejected", () => {
    const cases: Array<{ raw: unknown; pattern: RegExp }> = [
      { raw: "", pattern: /number/i },
      { raw: "abc", pattern: /number/i },
      { raw: 0, pattern: /at least 0\.1/i },
      { raw: -1, pattern: /at least 0\.1/i },
      { raw: 0.05, pattern: /0\.1/i },
      { raw: 2.15, pattern: /increments of 0\.1/i },
      { raw: 5.1, pattern: /organisation limit/i },
      { raw: 8, pattern: /organisation limit/i },
    ];

    for (const { raw, pattern } of cases) {
      const result = validateCampaignRequestsPerSecond(raw, 5);
      assert.equal(result.ok, false, `expected ${String(raw)} to be rejected`);
      if (!result.ok) {
        assert.match(result.message, pattern);
      }
    }
  });

  test("a campaign rate cannot raise the shared organisation limiter", async () => {
    const orgId = `org_ceiling_${Date.now()}`;
    const campaignA = `camp_a_${orgId}`;
    const campaignB = `camp_b_${orgId}`;

    try {
      await redis.del(
        `ratelimit:org:${orgId}`,
        `ratelimit:campaign:${campaignA}`,
        `ratelimit:campaign:${campaignB}`
      );

      const results = [];
      for (const campaignId of [campaignA, campaignA, campaignA, campaignB, campaignB]) {
        results.push(
          await OrgRateLimiter.reserveDispatch({
            organizationId: orgId,
            organizationRps: 2,
            campaignId,
            campaignRps: 10,
          })
        );
      }

      const allowed = results.filter((result) => result.allowed).length;
      assert.equal(allowed, 2, "Two campaigns requesting 10 RPS must still share the organisation ceiling of 2");

      const orgCount = await redis.zcard(`ratelimit:org:${orgId}`);
      assert.equal(orgCount, 2);
    } finally {
      await redis.del(
        `ratelimit:org:${orgId}`,
        `ratelimit:campaign:${campaignA}`,
        `ratelimit:campaign:${campaignB}`
      );
    }
  });

  test("a lower campaign rate does not reduce the shared organisation ceiling", async () => {
    const orgId = `org_shared_${Date.now()}`;
    const campaignA = `camp_low_a_${orgId}`;
    const campaignB = `camp_low_b_${orgId}`;

    try {
      await redis.del(
        `ratelimit:org:${orgId}`,
        `ratelimit:campaign:${campaignA}`,
        `ratelimit:campaign:${campaignB}`
      );

      let allowed = 0;
      for (let i = 0; i < 3; i++) {
        const result = await OrgRateLimiter.reserveDispatch({
          organizationId: orgId,
          organizationRps: 5,
          campaignId: campaignA,
          campaignRps: 2,
        });
        if (result.allowed) allowed += 1;
      }
      for (let i = 0; i < 2; i++) {
        const result = await OrgRateLimiter.reserveDispatch({
          organizationId: orgId,
          organizationRps: 5,
          campaignId: campaignB,
          campaignRps: 2,
        });
        if (result.allowed) allowed += 1;
      }

      assert.equal(allowed, 4, "Each campaign keeps its own 2 RPS cap while the organisation still allows 5");
      const orgCount = await redis.zcard(`ratelimit:org:${orgId}`);
      assert.equal(orgCount, 4);
      const campaignACount = await redis.zcard(`ratelimit:campaign:${campaignA}`);
      assert.equal(campaignACount, 2);
    } finally {
      await redis.del(
        `ratelimit:org:${orgId}`,
        `ratelimit:campaign:${campaignA}`,
        `ratelimit:campaign:${campaignB}`
      );
    }
  });

  test("workers dispatching a campaign cannot exceed the organisation ceiling", async () => {
    const suffix = Date.now().toString().slice(-8);
    const org = await prisma.organization.create({
      data: {
        name: `Rate Limit Org ${suffix}`,
        slug: `rate-limit-org-${suffix}`,
        maxRequestsPerSecond: 0.1,
        rateLimitPerMinute: 6,
      },
    });
    const workspace = await prisma.workspace.create({
      data: {
        name: "Rate Limit Workspace",
        slug: "rate-limit",
        organizationId: org.id,
      },
    });

    const campaignData = {
      organizationId: org.id,
      workspaceId: workspace.id,
      status: "RUNNING" as const,
      maxRequestsPerSecond: 10,
      dailyStartTime: "00:00",
      dailyEndTime: "23:59",
      timezone: "UTC",
      allowedDays: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"],
      callerPhoneNumber: "+919876543210",
      agentAppId: "app_rate_limit_test",
    };
    const campaignA = await prisma.campaign.create({
      data: { ...campaignData, name: `Rate Campaign A ${suffix}` },
    });
    const campaignB = await prisma.campaign.create({
      data: { ...campaignData, name: `Rate Campaign B ${suffix}` },
    });

    const contactsA = await Promise.all(
      [1, 2, 3].map((n) =>
        prisma.contact.create({
          data: {
            campaignId: campaignA.id,
            workspaceId: workspace.id,
            phoneNumber: `+9191000${suffix}${n}`,
            status: "PENDING",
          },
        })
      )
    );
    const contactB = await prisma.contact.create({
      data: {
        campaignId: campaignB.id,
        workspaceId: workspace.id,
        phoneNumber: `+9192000${suffix}1`,
        status: "PENDING",
      },
    });

    try {
      await redis.del(
        `ratelimit:org:${org.id}`,
        `ratelimit:campaign:${campaignA.id}`,
        `ratelimit:campaign:${campaignB.id}`
      );

      const resultsA = [];
      for (const contact of contactsA) {
        resultsA.push(
          await processOutboundCallJob({
            campaignId: campaignA.id,
            contactId: contact.id,
            attemptNumber: 1,
          })
        );
      }
      const resultB = await processOutboundCallJob({
        campaignId: campaignB.id,
        contactId: contactB.id,
        attemptNumber: 1,
      });

      const dispatched = resultsA.filter((result) => result.status === "DISPATCHED").length;
      assert.equal(dispatched, 1, "A campaign stored at 10 RPS must still follow the 0.1 organisation ceiling");
      assert.equal(
        resultsA.filter((result) => result.status === "RATE_LIMITED").length,
        2
      );
      assert.equal(resultB.status, "RATE_LIMITED", "A second campaign shares the same organisation Redis limiter");

      const orgCount = await redis.zcard(`ratelimit:org:${org.id}`);
      assert.equal(orgCount, 1);
    } finally {
      const campaignIds = [campaignA.id, campaignB.id];
      try {
        const jobs = await outboundCallQueue.getJobs(["waiting", "delayed", "failed"]);
        await Promise.all(
          jobs
            .filter((job) => campaignIds.includes(job.data?.campaignId))
            .map((job) => job.remove())
        );
      } catch {
        // Queue cleanup should not hide the assertion result.
      }
      await prisma.callAttempt.deleteMany({ where: { campaignId: { in: campaignIds } } });
      await prisma.contact.deleteMany({ where: { campaignId: { in: campaignIds } } });
      await prisma.campaign.deleteMany({ where: { id: { in: campaignIds } } });
      await prisma.workspace.deleteMany({ where: { id: workspace.id } });
      await prisma.organization.deleteMany({ where: { id: org.id } });
      await redis.del(
        `ratelimit:org:${org.id}`,
        `ratelimit:campaign:${campaignA.id}`,
        `ratelimit:campaign:${campaignB.id}`
      );
    }
  });

  after(async () => {
    try {
      await Promise.race([outboundCallQueue.close(), new Promise((resolve) => setTimeout(resolve, 1000))]);
    } finally {
      if (redis.status === "ready" || redis.status === "connecting") {
        await Promise.race([redis.quit(), new Promise((resolve) => setTimeout(resolve, 1000))]);
      }
      redis.disconnect();
      await Promise.race([prisma.$disconnect(), new Promise((resolve) => setTimeout(resolve, 1000))]);
    }
  });
});
