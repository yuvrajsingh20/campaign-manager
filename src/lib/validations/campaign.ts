import { z } from "zod";
import {
  isRequestsPerSecondStepAligned,
  REQUESTS_PER_SECOND_ABSOLUTE_MAX,
  REQUESTS_PER_SECOND_MIN,
} from "./rate-limit";

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const PHONE_REGEX = /^\+?[1-9]\d{7,14}$/;

export const requestsPerSecondSchema = z
  .number()
  .min(REQUESTS_PER_SECOND_MIN, "Rate limit must be at least 0.1 requests/sec")
  .max(REQUESTS_PER_SECOND_ABSOLUTE_MAX, "Rate limit cannot exceed 100 requests/sec")
  .refine(isRequestsPerSecondStepAligned, "Rate limit must use increments of 0.1 requests/sec");

export function campaignValidationMessage(
  error: { issues: { path: PropertyKey[]; message: string }[] },
  fallback: string
): string {
  const rateIssue = error.issues.find((issue) => issue.path[0] === "maxRequestsPerSecond");
  return rateIssue?.message || fallback;
}

export const ALLOWED_DAYS_ENUM = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
] as const;

export const createCampaignSchema = z.object({
  name: z.string().trim().min(2, "Campaign name must be at least 2 characters").max(100),
  description: z.string().trim().max(500).optional(),
  workspaceId: z.string().min(1, "Workspace ID is required"),

  // Agent configuration
  sarvamAgentId: z.string().trim().optional().nullable(),
  agentAppId: z.string().trim().optional().nullable(),
  agentVersion: z.string().trim().default("v1"),
  agentType: z.string().trim().default("outbound_voice"),
  agentConfig: z.record(z.string(), z.unknown()).optional().default({}),
  requiredVariables: z.array(z.string().trim()).default([]),

  // Telephony & Rate controls
  connectionId: z.string().trim().optional().nullable(),
  callerPhoneNumber: z
    .string()
    .trim()
    .regex(PHONE_REGEX, "Caller phone must be a valid international E.164 number (e.g. +14155552671)")
    .optional()
    .nullable()
    .or(z.literal("")),
  maxRequestsPerSecond: requestsPerSecondSchema.default(5.0),

  // Scheduling and allowed calling windows
  scheduledStartTime: z.string().datetime().optional().nullable(),
  scheduledEndTime: z.string().datetime().optional().nullable(),
  dailyStartTime: z
    .string()
    .regex(TIME_REGEX, "Daily start time must be HH:mm (24-hour)")
    .default("09:00"),
  dailyEndTime: z
    .string()
    .regex(TIME_REGEX, "Daily end time must be HH:mm (24-hour)")
    .default("18:00"),
  timezone: z.string().trim().default("UTC"),
  allowedDays: z.array(z.enum(ALLOWED_DAYS_ENUM)).default([
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
  ]),

  // Retry rules and concurrency controls
  maxRetries: z.number().int().min(0).max(10).default(3),
  retryIntervalMinutes: z.number().int().min(1).max(1440).default(30),
  concurrencyLimit: z.number().int().min(1).max(50).default(5),
  retryOnBusy: z.boolean().default(true),
  retryOnNoAnswer: z.boolean().default(true),
  retryOnShortDuration: z.boolean().default(true),
  shortDurationThresholdSeconds: z.number().int().min(1).max(120).default(15),

  // Initial status must default to non-running state
  status: z.enum(["DRAFT", "SCHEDULED"]).default("DRAFT"),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export const updateCampaignSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  
  sarvamAgentId: z.string().trim().optional().nullable(),
  agentAppId: z.string().trim().optional().nullable(),
  agentVersion: z.string().trim().optional(),
  agentType: z.string().trim().optional(),
  agentConfig: z.record(z.string(), z.unknown()).optional(),
  requiredVariables: z.array(z.string().trim()).optional(),

  connectionId: z.string().trim().optional().nullable(),
  callerPhoneNumber: z
    .string()
    .trim()
    .regex(PHONE_REGEX, "Must be a valid international E.164 number")
    .optional()
    .nullable()
    .or(z.literal("")),
  maxRequestsPerSecond: requestsPerSecondSchema.optional(),

  scheduledStartTime: z.string().datetime().optional().nullable(),
  scheduledEndTime: z.string().datetime().optional().nullable(),
  dailyStartTime: z.string().regex(TIME_REGEX).optional(),
  dailyEndTime: z.string().regex(TIME_REGEX).optional(),
  timezone: z.string().trim().optional(),
  allowedDays: z.array(z.enum(ALLOWED_DAYS_ENUM)).optional(),

  maxRetries: z.number().int().min(0).max(10).optional(),
  retryIntervalMinutes: z.number().int().min(1).max(1440).optional(),
  concurrencyLimit: z.number().int().min(1).max(50).optional(),
  retryOnBusy: z.boolean().optional(),
  retryOnNoAnswer: z.boolean().optional(),
  retryOnShortDuration: z.boolean().optional(),
  shortDurationThresholdSeconds: z.number().int().min(1).max(120).optional(),

  status: z.enum(["DRAFT", "SCHEDULED", "PAUSED", "CANCELLED"]).optional(),
});

export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;

export const campaignFilterSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["DRAFT", "SCHEDULED", "RUNNING", "PAUSED", "COMPLETED", "CANCELLED"]).optional(),
  workspaceId: z.string().optional(),
});

export type CampaignFilterInput = z.infer<typeof campaignFilterSchema>;

export const contactFilterSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z
    .enum(["PENDING", "QUEUED", "IN_PROGRESS", "COMPLETED", "FAILED", "DO_NOT_CALL", "RETRYING"])
    .optional(),
  search: z.string().optional(),
});

export type ContactFilterInput = z.infer<typeof contactFilterSchema>;

/**
 * Normalizes phone numbers by stripping whitespace, dashes, parens,
 * and ensuring proper international E.164 format.
 */
export function normalizePhoneNumber(raw: string): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/[\s\-\(\)\.]/g, "");
  if (!PHONE_REGEX.test(cleaned)) {
    return null;
  }
  return cleaned;
}
