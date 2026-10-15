export type Role = "OWNER" | "ADMIN" | "MEMBER";

export type CampaignStatus =
  | "DRAFT"
  | "SCHEDULED"
  | "RUNNING"
  | "PAUSED"
  | "COMPLETED"
  | "CANCELLED";

export type ContactStatus =
  | "PENDING"
  | "QUEUED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "DO_NOT_CALL";

export type CallAttemptStatus =
  | "INITIATED"
  | "RINGING"
  | "IN_PROGRESS"
  | "ANSWERED"
  | "BUSY"
  | "FAILED"
  | "NO_ANSWER"
  | "VOICEMAIL"
  | "CANCELLED";

export interface OrganizationContext {
  id: string;
  name: string;
  slug: string;
  rateLimitPerMinute: number;
}

export interface WorkspaceContext {
  id: string;
  name: string;
  slug: string;
  organizationId: string;
}

export interface DashboardStats {
  totalCampaigns: number;
  activeCampaigns: number;
  totalContacts: number;
  completedCalls: number;
}

export interface ContactCsvRow {
  phoneNumber: string;
  firstName?: string;
  lastName?: string;
  [key: string]: string | undefined;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}
