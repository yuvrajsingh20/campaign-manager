export type Role = "SUPERADMIN" | "OWNER" | "ADMIN" | "MEMBER";

export type OrganizationStatus = "ACTIVE" | "INACTIVE";

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
  status: OrganizationStatus;
  rateLimitPerMinute: number;
  maxRequestsPerSecond: number;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  organizationId: string | null;
  organization?: OrganizationContext | null;
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
  leadId?: string;
  phoneNumber: string;
  firstName?: string;
  lastName?: string;
  customVariables?: Record<string, unknown>;
}

export interface CohortUploadSummary {
  totalRowsProcessed: number;
  acceptedRows: number;
  rejectedRows: number;
  duplicatesSkipped: number;
  errors: Array<{
    row: number;
    error: string;
    details?: string;
  }>;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
}

export interface PaginatedResult<T> {
  items: T[];
  pagination: PaginationMeta;
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
