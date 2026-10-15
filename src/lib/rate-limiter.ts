import { redis } from "./redis";

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
  remainingTokens?: number;
}

/**
 * Atomic Lua script implementing a distributed Token Bucket rate limiter in Redis.
 *
 * KEYS[1]: org rate limit key, e.g. "ratelimit:org:{orgId}"
 * ARGV[1]: now (current Unix millisecond timestamp)
 * ARGV[2]: ratePerSecond (number of requests permitted per second)
 * ARGV[3]: burstCapacity (maximum burst bucket capacity)
 *
 * Returns an array: [allowed (1 or 0), retryAfterMs (integer), remainingTokens (float)]
 */
const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local ratePerSec = tonumber(ARGV[2])
local capacity = tonumber(ARGV[3])

local ratePerMs = ratePerSec / 1000.0

local data = redis.call("HMGET", key, "tokens", "lastUpdated")
local tokens = tonumber(data[1])
local lastUpdated = tonumber(data[2])

if tokens == nil or lastUpdated == nil then
  tokens = capacity
  lastUpdated = now
else
  local elapsed = now - lastUpdated
  if elapsed > 0 then
    tokens = math.min(capacity, tokens + (elapsed * ratePerMs))
    lastUpdated = now
  end
end

if tokens >= 1.0 then
  tokens = tokens - 1.0
  redis.call("HMSET", key, "tokens", tokens, "lastUpdated", lastUpdated)
  redis.call("EXPIRE", key, 60)
  return { 1, 0, tokens }
else
  local needed = 1.0 - tokens
  local waitMs = math.ceil(needed / ratePerMs)
  redis.call("HMSET", key, "tokens", tokens, "lastUpdated", lastUpdated)
  redis.call("EXPIRE", key, 60)
  return { 0, waitMs, tokens }
end
`;

export class OrgRateLimiter {
  /**
   * Attempts to consume one request token for an organization.
   *
   * @param organizationId - Target organization ID.
   * @param requestsPerSecond - Configured limit for the organization (default 5.0).
   * @param burstCapacity - Max burst allowed (defaults to requestsPerSecond, min 1).
   */
  public static async acquire(
    organizationId: string,
    requestsPerSecond: number = 5.0,
    burstCapacity?: number
  ): Promise<RateLimitResult> {
    const rps = Math.max(0.1, requestsPerSecond);
    const capacity = Math.max(1, burstCapacity ?? rps);
    const key = `ratelimit:org:${organizationId}`;
    const now = Date.now();

    try {
      const res = (await redis.eval(
        TOKEN_BUCKET_LUA,
        1,
        key,
        now.toString(),
        rps.toString(),
        capacity.toString()
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
      // Security & Safety: Fail-closed so worker cannot flood downstream provider when Redis fails
      return {
        allowed: false,
        retryAfterMs: 1000,
      };
    }
  }

  /**
   * Blocks and waits until a rate limit token is acquired, or until timeoutMs expires.
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
