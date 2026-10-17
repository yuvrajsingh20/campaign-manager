/**
 * Campaign requests-per-second rules.
 * Decimal rates are supported in 0.1 increments and cannot exceed the
 * organisation ceiling configured by a superadmin.
 */

export const REQUESTS_PER_SECOND_MIN = 0.1;
export const REQUESTS_PER_SECOND_STEP = 0.1;
export const REQUESTS_PER_SECOND_ABSOLUTE_MAX = 100;
export const DEFAULT_ORGANIZATION_RPS = 5;

const STEP_TOLERANCE = 1e-6;

export function isRequestsPerSecondStepAligned(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const steps = value / REQUESTS_PER_SECOND_STEP;
  return Math.abs(steps - Math.round(steps)) < STEP_TOLERANCE;
}

export function normalizeRequestsPerSecond(value: number): number {
  return Math.round(value * 10) / 10;
}

export function resolveOrganizationRequestsPerSecond(
  organization:
    | {
        maxRequestsPerSecond?: number | null;
        rateLimitPerMinute?: number | null;
      }
    | null
    | undefined
): number {
  if (organization?.maxRequestsPerSecond != null && organization.maxRequestsPerSecond > 0) {
    return organization.maxRequestsPerSecond;
  }
  if (organization?.rateLimitPerMinute != null && organization.rateLimitPerMinute > 0) {
    return organization.rateLimitPerMinute / 60;
  }
  return DEFAULT_ORGANIZATION_RPS;
}

export type CampaignRateLimitValidation =
  | { ok: true; value: number }
  | { ok: false; message: string };

/**
 * Accepts numbers and numeric strings from the rate-limit input.
 * The organisation ceiling is the hard maximum, even when it is below the absolute cap.
 */
export function validateCampaignRequestsPerSecond(
  raw: unknown,
  organizationLimit: number
): CampaignRateLimitValidation {
  const parsed =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw.trim())
        : Number.NaN;

  if (!Number.isFinite(parsed)) {
    return { ok: false, message: "Rate limit must be a number of requests per second." };
  }

  if (!isRequestsPerSecondStepAligned(parsed)) {
    return { ok: false, message: "Rate limit must use increments of 0.1 requests/sec." };
  }

  const value = normalizeRequestsPerSecond(parsed);

  if (value < REQUESTS_PER_SECOND_MIN) {
    return { ok: false, message: "Rate limit must be at least 0.1 requests/sec." };
  }

  if (value > REQUESTS_PER_SECOND_ABSOLUTE_MAX) {
    return { ok: false, message: "Rate limit cannot exceed 100 requests/sec." };
  }

  if (!Number.isFinite(organizationLimit) || organizationLimit <= 0) {
    return { ok: false, message: "Organisation rate limit is not configured." };
  }

  if (value > organizationLimit + STEP_TOLERANCE) {
    return {
      ok: false,
      message: `Rate limit cannot exceed the organisation limit of ${formatRequestsPerSecond(organizationLimit)} requests/sec.`,
    };
  }

  return { ok: true, value };
}

export function formatRequestsPerSecond(value: number): string {
  if (!Number.isFinite(value)) return "";
  const normalized = normalizeRequestsPerSecond(value);
  return Number.isInteger(normalized) ? String(normalized) : normalized.toFixed(1);
}
