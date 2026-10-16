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
    try {
      await redis.del(`ratelimit:org:${orgA}`, `ratelimit:org:${orgB}`);
    } finally {
      if (redis.status === "ready" || redis.status === "connecting") {
        await Promise.race([redis.quit(), new Promise((r) => setTimeout(r, 1000))]);
      }
      redis.disconnect();
    }
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

  test("Tokens refill over time based on elapsed sliding window", async () => {
    const orgRefill = "test_org_refill_" + Date.now();
    // Test with a 200ms window
    const firstRes = await OrgRateLimiter.acquire(orgRefill, 1, 1, 200);
    assert.equal(firstRes.allowed, true, "First request in window must be allowed");

    const secondRes = await OrgRateLimiter.acquire(orgRefill, 1, 1, 200);
    assert.equal(secondRes.allowed, false, "Immediate second request must be denied");
    assert.ok(secondRes.retryAfterMs > 0, "Must specify remaining wait time");

    // Wait 220ms for window to slide past the first request
    await new Promise((resolve) => setTimeout(resolve, 220));

    const thirdRes = await OrgRateLimiter.acquire(orgRefill, 1, 1, 200);
    assert.equal(thirdRes.allowed, true, "Request must be allowed after window slides past");

    await redis.del(`ratelimit:org:${orgRefill}`);
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

  test("Strict rolling one-second enforcement never allows bursts above limit", async () => {
    const strictOrg = "test_org_strict_" + Date.now();
    const limit = 5;

    // Consume all 5 slots
    for (let i = 0; i < limit; i++) {
      const res = await OrgRateLimiter.acquire(strictOrg, limit, limit, 1000);
      assert.equal(res.allowed, true);
    }

    // Next 10 attempts inside the same second must ALL be denied
    for (let i = 0; i < 10; i++) {
      const res = await OrgRateLimiter.acquire(strictOrg, limit, limit, 1000);
      assert.equal(res.allowed, false, "Must not allow bursts above 5 requests per second");
    }

    await redis.del(`ratelimit:org:${strictOrg}`);
  });

  test("Boundary conditions: Zero or negative RPS fails safely without unhandled errors", async () => {
    const boundaryOrg = "test_org_zero_" + Date.now();
    const zeroRes = await OrgRateLimiter.acquire(boundaryOrg, 0);
    assert.equal(zeroRes.allowed, false);

    const negRes = await OrgRateLimiter.acquire(boundaryOrg, -5);
    assert.equal(negRes.allowed, false);
  });

  test("Boundary conditions: Fractional RPS (0.5 req/sec) enforces 2000ms window without rounding up", async () => {
    const fracOrg = "test_org_frac_" + Date.now();
    const firstRes = await OrgRateLimiter.acquire(fracOrg, 0.5);
    assert.equal(firstRes.allowed, true, "First request at 0.5 RPS must be allowed");

    const secondRes = await OrgRateLimiter.acquire(fracOrg, 0.5);
    assert.equal(secondRes.allowed, false, "Second immediate request must be rejected under 0.5 RPS");
    assert.ok(secondRes.retryAfterMs > 0, "Wait time must reflect remaining window");

    await redis.del(`ratelimit:org:${fracOrg}`);
  });

  test("waitForToken: Successfully acquires token or times out gracefully", async () => {
    const waitOrg = "test_org_wait_" + Date.now();
    // Immediate acquisition when tokens available
    const acquired = await OrgRateLimiter.waitForToken(waitOrg, 5, 2000);
    assert.equal(acquired, true, "waitForToken should succeed when slots are open");

    // Timeout when RPS is zero
    const timedOut = await OrgRateLimiter.waitForToken(waitOrg, 0, 300);
    assert.equal(timedOut, false, "waitForToken should return false when limit is zero and timeout elapses");

    await redis.del(`ratelimit:org:${waitOrg}`);
  });
});


