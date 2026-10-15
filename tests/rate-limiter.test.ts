import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { OrgRateLimiter } from "../src/lib/rate-limiter";
import { redis } from "../src/lib/redis";

describe("Organisation-Wide Distributed Rate Limiter", () => {
  const orgA = "test_org_alpha_" + Date.now();
  const orgB = "test_org_beta_" + Date.now();

  before(async () => {
    // Clean up test keys
    await redis.del(`ratelimit:org:${orgA}`, `ratelimit:org:${orgB}`);
  });

  after(async () => {
    await redis.del(`ratelimit:org:${orgA}`, `ratelimit:org:${orgB}`);
    await redis.quit();
  });

  test("Rate limiter enforces capacity and rejects when tokens exhausted", async () => {
    const rps = 5; // 5 req/sec
    const results = [];

    // Attempt 8 rapid acquisitions with a capacity of 5
    for (let i = 0; i < 8; i++) {
      const res = await OrgRateLimiter.acquire(orgA, rps, 5);
      results.push(res);
    }

    const allowedCount = results.filter((r) => r.allowed).length;
    const deniedCount = results.filter((r) => !r.allowed).length;

    assert.equal(allowedCount, 5, "Exactly 5 tokens should be granted from bucket capacity");
    assert.equal(deniedCount, 3, "3 tokens should be denied once bucket is exhausted");

    const firstDenied = results.find((r) => !r.allowed);
    assert.ok(firstDenied);
    assert.ok(firstDenied.retryAfterMs > 0, "Denied request must return a positive retryAfterMs");
  });

  test("Organisation A's limit remains strictly independent of Organisation B's limit", async () => {
    // Org A is exhausted from previous test, let's confirm it's still rejected
    const orgAResult = await OrgRateLimiter.acquire(orgA, 5, 5);
    assert.equal(orgAResult.allowed, false, "Org A should still be rate limited");

    // Org B should have its full separate bucket capacity of 5 available
    const orgBResults = [];
    for (let i = 0; i < 5; i++) {
      const res = await OrgRateLimiter.acquire(orgB, 5, 5);
      orgBResults.push(res);
    }

    const orgBAllowed = orgBResults.filter((r) => r.allowed).length;
    assert.equal(orgBAllowed, 5, "Org B should receive its full bucket independently of Org A");
  });

  test("Tokens refill over time based on elapsed milliseconds", async () => {
    // Wait 250ms for Org A to replenish at least 1 token (5 tokens/sec = 1 token per 200ms)
    await new Promise((resolve) => setTimeout(resolve, 250));

    const res = await OrgRateLimiter.acquire(orgA, 5, 5);
    assert.equal(res.allowed, true, "Token should be replenished after elapsed time window");
  });

  test("Handles concurrent acquisition across simulated parallel workers without exceeding limit", async () => {
    const concurrentOrg = "test_org_concurrent_" + Date.now();
    const rps = 10;
    const capacity = 10;

    // Simulate 30 concurrent workers trying to acquire simultaneously
    const promises = Array.from({ length: 30 }, () =>
      OrgRateLimiter.acquire(concurrentOrg, rps, capacity)
    );

    const concurrentResults = await Promise.all(promises);
    const allowed = concurrentResults.filter((r) => r.allowed).length;
    const denied = concurrentResults.filter((r) => !r.allowed).length;

    assert.equal(allowed, 10, "Concurrent calls must not exceed bucket capacity of 10");
    assert.equal(denied, 20, "Excess concurrent requests must be denied");

    await redis.del(`ratelimit:org:${concurrentOrg}`);
  });
});
