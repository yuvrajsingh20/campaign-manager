import { randomUUID } from "node:crypto";
import { redis } from "./redis";

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
  remainingSlots?: number;
  remainingTokens?: number; // Alias for backward compatibility
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
/**
 * Translates a requests-per-second setting into the integer window used by the sliding log.
 * Burst capacity, when provided, is the explicit window size used by existing callers.
 */
export function resolveEffectiveWindow(
  requestsPerSecond: number,
  burstCapacity?: number,
  windowMs: number = 1000
): { effectiveLimit: number; effectiveWindowMs: number } | null {
  if (!(requestsPerSecond > 0)) return null;

  if (burstCapacity !== undefined && burstCapacity > 0) {
    return {
      effectiveLimit: Math.max(1, Math.round(burstCapacity)),
      effectiveWindowMs: windowMs,
    };
  }

  if (requestsPerSecond < 1) {
    return {
      effectiveLimit: 1,
      effectiveWindowMs: Math.max(100, Math.round(1000 / requestsPerSecond)),
    };
  }

  if (requestsPerSecond % 1 !== 0 && windowMs === 1000) {
    return {
      effectiveLimit: Math.round(requestsPerSecond * 2),
      effectiveWindowMs: 2000,
    };
  }

  return {
    effectiveLimit: Math.max(1, Math.round(requestsPerSecond * (windowMs / 1000))),
    effectiveWindowMs: windowMs,
  };
}

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

/**
 * Admits one request only when BOTH the campaign window and the shared organisation
 * window have capacity. Neither key is written unless both checks pass, so a campaign
 * rate cannot raise or replace the organisation ceiling.
 *
 * KEYS[1]: ratelimit:org:{organizationId}
 * KEYS[2]: ratelimit:campaign:{campaignId}
 * ARGV[1]: now
 * ARGV[2]: organisation limit
 * ARGV[3]: organisation window ms
 * ARGV[4]: campaign limit (already capped at the organisation limit)
 * ARGV[5]: campaign window ms
 * ARGV[6]: member id
 */
const ORG_AND_CAMPAIGN_WINDOW_LUA = `
local orgKey = KEYS[1]
local campaignKey = KEYS[2]
local now = tonumber(ARGV[1])
local orgLimit = tonumber(ARGV[2])
local orgWindowMs = tonumber(ARGV[3])
local campaignLimit = tonumber(ARGV[4])
local campaignWindowMs = tonumber(ARGV[5])
local memberId = ARGV[6]

local function inspect(key, limit, windowMs)
  local clearBefore = now - windowMs
  redis.call("ZREMRANGEBYSCORE", key, "-inf", clearBefore)
  local currentCount = redis.call("ZCARD", key)
  if currentCount < limit then
    return { 1, 0, limit - currentCount - 1 }
  end
  local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
  local waitMs = 100
  if oldest and oldest[2] then
    local oldestScore = tonumber(oldest[2])
    waitMs = math.max(1, math.ceil((oldestScore + windowMs) - now))
  end
  redis.call("PEXPIRE", key, math.ceil(windowMs * 2))
  return { 0, waitMs, 0 }
end

local campaign = inspect(campaignKey, campaignLimit, campaignWindowMs)
if campaign[1] == 0 then
  return campaign
end

local org = inspect(orgKey, orgLimit, orgWindowMs)
if org[1] == 0 then
  return org
end

redis.call("ZADD", campaignKey, now, memberId)
redis.call("PEXPIRE", campaignKey, math.ceil(campaignWindowMs * 2))
redis.call("ZADD", orgKey, now, memberId)
redis.call("PEXPIRE", orgKey, math.ceil(orgWindowMs * 2))
return org
`;

function deniedRateLimit(retryAfterMs = 1000): RateLimitResult {
  return {
    allowed: false,
    retryAfterMs,
    remainingSlots: 0,
    remainingTokens: 0,
  };
}

export class OrgRateLimiter {
  /**
   * Attempts to consume one request slot for an organization under an atomic sliding window log.
   *
   * @param organizationId - Target organization ID.
   * @param requestsPerSecond - Configured limit for the organization (e.g. 5.0, 8.5, 0.5).
   * @param burstCapacity - Optional burst capacity override.
   * @param windowMs - Rolling window duration in milliseconds (default 1000ms).
   */
  public static async acquire(
    organizationId: string,
    requestsPerSecond: number = 5.0,
    burstCapacity?: number,
    windowMs: number = 1000
  ): Promise<RateLimitResult> {
    const resolved = resolveEffectiveWindow(requestsPerSecond, burstCapacity, windowMs);
    if (!resolved) {
      return deniedRateLimit();
    }

    const { effectiveLimit, effectiveWindowMs } = resolved;

    const key = `ratelimit:org:${organizationId}`;
    const now = Date.now();
    const memberId = `${now}_${randomUUID().substring(0, 8)}`;

    try {
      const res = (await redis.eval(
        SLIDING_WINDOW_LUA,
        1,
        key,
        now.toString(),
        effectiveLimit.toString(),
        effectiveWindowMs.toString(),
        memberId
      )) as [number, number, number];

      const allowed = res[0] === 1;
      const retryAfterMs = res[1];
      const remainingSlots = res[2];

      return {
        allowed,
        retryAfterMs,
        remainingSlots,
        remainingTokens: remainingSlots,
      };
    } catch (error) {
      console.error(
        `[OrgRateLimiter] Redis error evaluating rate limit for org ${organizationId}:`,
        error
      );
      // Security & Safety: Fail-closed so workers cannot flood downstream telephony provider when Redis fails
      return deniedRateLimit();
    }
  }

  /**
   * Reserves one dispatch slot for a campaign without letting that campaign's rate
   * replace the shared organisation limiter.
   *
   * The organisation key is always evaluated at the superadmin ceiling. The campaign
   * key is evaluated at min(campaignRps, organisationRps), so a campaign can be slower
   * than the organisation but cannot raise the shared ceiling for other campaigns or workers.
   */
  public static async reserveDispatch(input: {
    organizationId: string;
    organizationRps: number;
    campaignId: string;
    campaignRps: number;
  }): Promise<RateLimitResult> {
    const { organizationId, organizationRps, campaignId, campaignRps } = input;

    if (!(organizationRps > 0) || !(campaignRps > 0)) {
      return deniedRateLimit();
    }

    const cappedCampaignRps = Math.min(campaignRps, organizationRps);
    const orgWindow = resolveEffectiveWindow(organizationRps);
    const campaignWindow = resolveEffectiveWindow(cappedCampaignRps);
    if (!orgWindow || !campaignWindow) {
      return deniedRateLimit();
    }

    const orgKey = `ratelimit:org:${organizationId}`;
    const campaignKey = `ratelimit:campaign:${campaignId}`;
    const now = Date.now();
    const memberId = `${now}_${randomUUID().substring(0, 8)}`;

    try {
      const res = (await redis.eval(
        ORG_AND_CAMPAIGN_WINDOW_LUA,
        2,
        orgKey,
        campaignKey,
        now.toString(),
        orgWindow.effectiveLimit.toString(),
        orgWindow.effectiveWindowMs.toString(),
        campaignWindow.effectiveLimit.toString(),
        campaignWindow.effectiveWindowMs.toString(),
        memberId
      )) as [number, number, number];

      const allowed = res[0] === 1;
      return {
        allowed,
        retryAfterMs: res[1],
        remainingSlots: res[2],
        remainingTokens: res[2],
      };
    } catch (error) {
      console.error(
        `[OrgRateLimiter] Redis error reserving dispatch slot for org ${organizationId}:`,
        error
      );
      return deniedRateLimit();
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
