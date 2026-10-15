import { z } from "zod";

export const createCampaignSchema = z.object({
  name: z.string().min(2, "Campaign name must be at least 2 characters").max(100),
  description: z.string().max(500).optional(),
  workspaceId: z.string().min(1, "Workspace ID is required"),
  sarvamAgentId: z.string().min(1, "Sarvam Agent ID is required"),
  agentConfig: z.record(z.string(), z.unknown()).optional(),
  
  // Calling windows and scheduling
  scheduledStartTime: z.string().datetime().optional().nullable(),
  scheduledEndTime: z.string().datetime().optional().nullable(),
  dailyStartTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Format must be HH:mm (24-hour)")
    .default("09:00"),
  dailyEndTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Format must be HH:mm (24-hour)")
    .default("18:00"),
  timezone: z.string().default("UTC"),

  // Retries and concurrency
  maxRetries: z.number().int().min(0).max(10).default(3),
  retryIntervalMinutes: z.number().int().min(5).max(1440).default(30),
  concurrencyLimit: z.number().int().min(1).max(50).default(5),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export const updateCampaignStatusSchema = z.object({
  status: z.enum(["RUNNING", "PAUSED", "COMPLETED", "CANCELLED"]),
  reason: z.string().max(200).optional(),
});

export type UpdateCampaignStatusInput = z.infer<typeof updateCampaignStatusSchema>;

export const csvContactRowSchema = z.object({
  phoneNumber: z
    .string()
    .min(8, "Phone number too short")
    .max(20, "Phone number too long")
    .regex(/^\+?[1-9]\d{7,14}$/, "Must be a valid E.164 phone number"),
  firstName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
});

export type CsvContactRow = z.infer<typeof csvContactRowSchema>;

export const contactCohortUploadSchema = z.object({
  campaignId: z.string().min(1, "Campaign ID is required"),
  contacts: z.array(
    z.object({
      phoneNumber: z.string(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      customVariables: z.record(z.string(), z.unknown()).optional(),
    })
  ).min(1, "Cohort must contain at least 1 contact"),
});
