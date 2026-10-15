import { randomUUID } from "node:crypto";
import { redis } from "./redis";

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
  remainingTokens?: number;
}

/**
 * Atomic Lua script implementing a distributed Sliding Window Log rate limiter in Redis.
 *
 * Guarantees that within ANY rolling window of `windowMs` (default 1000ms), the total
 * number of admitted requests across ALL campaigns, workers, and processes belonging
 * to the organization NEVER exceeds `limit`.
 *
 * KEYS[1]: org rate limit key, e.g. "ratelimit:org:{orgId}"
 * ARGV[1]: now (current Unix millisecond timestamp)
 * ARGV[2]: limit (maximum allowed requests per window)
 * ARGV[3]: windowMs (window duration in milliseconds, typically 1000)
 * ARGV[4]: memberId (unique identifier for this request)
 *
 * Returns an array: [allowed (1 or 0), retryAfterMs (integer), remainingSlots (integer)]
 */
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local windowMs = tonumber(ARGV[3])
local memberId = ARGV[4]

-- 1. Remove entries outside the current rolling window [now - windowMs, now]
local clearBefore = now - windowMs
redis.call("ZREMRANGEBYSCORE", key, "-inf", clearBefore)

-- 2. Count requests currently inside the rolling window
local currentCount = redis.call("ZCARD", key)

if currentCount < limit then
  -- Admitted: record timestamp in sorted set
  redis.call("ZADD", key, now, memberId)
  redis.call("PEXPIRE", key, math.ceil(windowMs * 2))
  return { 1, 0, limit - currentCount - 1 }
else
  -- Rejected: inspect the oldest timestamp in current window to calculate exact delay
  local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
  local waitMs = 100
  if oldest and oldest[2] then
    local oldestScore = tonumber(oldest[2])
    waitMs = math.max(1, math.ceil((oldestScore + windowMs) - now))
  end
  redis.call("PEXPIRE", key, math.ceil(windowMs * 2))
  return { 0, waitMs, 0 }
end
`;

export class OrgRateLimiter {
  /**
   * Attempts to consume one request slot for an organization under a strict rolling 1-second window.
   *
   * @param organizationId - Target organization ID.
   * @param requestsPerSecond - Configured limit for the organization (default 5.0).
   * @param burstCapacity - Optional burst capacity override (defaults to requestsPerSecond, min 1).
   * @param windowMs - Rolling window duration in milliseconds (default 1000ms).
   */
  public static async acquire(
    organizationId: string,
    requestsPerSecond: number = 5.0,
    burstCapacity?: number,
    windowMs: number = 1000
  ): Promise<RateLimitResult> {
    const rps = Math.max(1, Math.floor(requestsPerSecond));
    const limit = Math.max(1, burstCapacity ? Math.floor(burstCapacity) : rps);
    const key = `ratelimit:org:${organizationId}`;
    const now = Date.now();
    const memberId = `${now}_${randomUUID().substring(0, 8)}`;

    try {
      const res = (await redis.eval(
        SLIDING_WINDOW_LUA,
        1,
        key,
        now.toString(),
        limit.toString(),
        windowMs.toString(),
        memberId
      )) as [number, number, number];

      const allowed = res[0] === 1;
      const retryAfterMs = res[1];
      const remainingTokens = res[2];

      return {
        allowed,
        retryAfterMs,
        remainingTokens,
      };
    } catch (error) {
      console.error(
        `[OrgRateLimiter] Redis error evaluating rate limit for org ${organizationId}:`,
        error
      );
      // Security & Safety: Fail-closed so workers cannot flood downstream telephony provider when Redis fails
      return {
        allowed: false,
        retryAfterMs: 1000,
        remainingTokens: 0,
      };
    }
  }

  /**
   * Blocks and waits until a rate limit slot is acquired, or until timeoutMs expires.
   */
  public static async waitForToken(
    organizationId: string,
    requestsPerSecond: number = 5.0,
    timeoutMs: number = 10000
  ): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const result = await this.acquire(organizationId, requestsPerSecond);
      if (result.allowed) {
        return true;
      }

      const waitTime = Math.min(result.retryAfterMs, 1000, timeoutMs - (Date.now() - startTime));
      if (waitTime <= 0) break;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    return false;
  }
}
