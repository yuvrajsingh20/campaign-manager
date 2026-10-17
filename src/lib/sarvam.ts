export interface SarvamOutboundPayload {
  app_config: {
    app_id: string;
    app_version: number;
    app_type?: string;
    connection_config: {
      connection_id: string;
      agent_phone_number: string;
    };
    agent_variables?: Record<string, unknown> | null;
    app_overrides?: Record<string, unknown> | null;
  };
  app_overrides?: Record<string, unknown> | null;
  user_config: {
    user_phone_number: string;
  };
  webhook_config?: {
    url: string;
    metadata?: Record<string, unknown> | null;
  } | null;
}

export interface SarvamOutboundResponse {
  attempt_id: string;
}

export class SarvamApiError extends Error {
  public statusCode?: number;
  public details?: unknown;
  public isAmbiguous: boolean;

  constructor(message: string, statusCode?: number, details?: unknown, isAmbiguous = false) {
    super(message);
    this.name = "SarvamApiError";
    this.statusCode = statusCode;
    this.details = details;
    this.isAmbiguous = isAmbiguous;
  }
}

/**
 * Returns true when a Sarvam path ID env value is missing or still a template placeholder.
 * Internal Prisma CUIDs must never be treated as valid Sarvam org/workspace IDs.
 */
function isUnsetSarvamPathId(value: string | undefined, placeholder: string): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  return (
    trimmed === placeholder ||
    lower.includes("placeholder") ||
    lower.includes("example") ||
    lower.startsWith("mock_") ||
    lower.startsWith("your-")
  );
}

/**
 * Resolves the Sarvam org/workspace IDs used in the outbound API path.
 *
 * These are external provider IDs from `SARVAM_ORG_ID` / `SARVAM_WORKSPACE_ID`,
 * not Prisma `Organization.id` / `Workspace.id` CUIDs. Live mode never falls
 * back to internal tenant IDs or mock placeholders.
 */
export function resolveSarvamOutboundPathIds(options: {
  requireConfigured: boolean;
}): { orgId: string; workspaceId: string } {
  const orgId = process.env.SARVAM_ORG_ID?.trim() ?? "";
  const workspaceId = process.env.SARVAM_WORKSPACE_ID?.trim() ?? "";

  if (options.requireConfigured) {
    if (isUnsetSarvamPathId(orgId, "your-sarvam-org-id-here")) {
      throw new SarvamApiError(
        "SARVAM_ORG_ID must be configured with your Sarvam organisation ID for live outbound calls",
        401
      );
    }
    if (isUnsetSarvamPathId(workspaceId, "your-sarvam-workspace-id-here")) {
      throw new SarvamApiError(
        "SARVAM_WORKSPACE_ID must be configured with your Sarvam workspace ID for live outbound calls",
        401
      );
    }
    return { orgId, workspaceId };
  }

  return {
    orgId: isUnsetSarvamPathId(orgId, "your-sarvam-org-id-here")
      ? "mock_sarvam_org"
      : orgId,
    workspaceId: isUnsetSarvamPathId(workspaceId, "your-sarvam-workspace-id-here")
      ? "mock_sarvam_workspace"
      : workspaceId,
  };
}

export class SarvamClient {
  private apiKey: string;
  private baseUrl: string;
  private isMockMode: boolean;

  constructor(options?: { apiKey?: string; baseUrl?: string; mockMode?: boolean }) {
    this.apiKey = options?.apiKey || process.env.SARVAM_API_KEY || "";
    this.baseUrl =
      options?.baseUrl || process.env.SARVAM_API_BASE_URL || "https://apps.sarvam.ai";
    // Check if explicitly passed or set in environment
    const isProduction = process.env.NODE_ENV === "production";
    if (options?.mockMode !== undefined) {
      this.isMockMode = options.mockMode;
    } else if (process.env.SARVAM_MOCK_MODE === "false") {
      this.isMockMode = false;
    } else if (isProduction) {
      // In production, mock mode requires explicit ALLOW_MOCK_TELEPHONY flag
      this.isMockMode = process.env.SARVAM_MOCK_MODE === "true" && process.env.ALLOW_MOCK_TELEPHONY === "true";
    } else {
      this.isMockMode =
        process.env.SARVAM_MOCK_MODE === "true" ||
        process.env.NODE_ENV === "test" ||
        !this.apiKey ||
        this.apiKey === "your-sarvam-api-key-here";
    }
  }

  /**
   * Helper to parse app_version to an integer.
   * e.g. "v1" -> 1, "2.0" -> 2, 1 -> 1.
   */
  public static parseAppVersion(rawVersion?: string | number | null): number {
    if (typeof rawVersion === "number") return Math.max(1, Math.floor(rawVersion));
    if (!rawVersion) return 1;
    const cleaned = rawVersion.toString().replace(/[^0-9]/g, "");
    const parsed = parseInt(cleaned, 10);
    return isNaN(parsed) || parsed < 1 ? 1 : parsed;
  }

  /**
   * Dispatches an outbound voice call via Sarvam's API.
   *
   * @param orgId - External Sarvam organisation ID (from SARVAM_ORG_ID), not a Prisma CUID
   * @param workspaceId - External Sarvam workspace ID (from SARVAM_WORKSPACE_ID), not a Prisma CUID
   * @param payload - Outbound call payload matching Sarvam API specification
   */
  public async createOutboundCall(
    orgId: string,
    workspaceId: string,
    payload: SarvamOutboundPayload
  ): Promise<SarvamOutboundResponse> {
    // If mock mode is active, simulate realistic provider response without calling live customers
    if (this.isMockMode) {
      return this.simulateMockCall(payload);
    }

    if (!this.apiKey) {
      throw new SarvamApiError(
        "SARVAM_API_KEY is not configured and mock mode is disabled",
        401
      );
    }

    // Live path IDs must come from SARVAM_ORG_ID / SARVAM_WORKSPACE_ID (never Prisma CUIDs).
    // Re-resolve from env so a caller cannot silently substitute internal tenant IDs.
    const pathIds = resolveSarvamOutboundPathIds({ requireConfigured: true });
    if (
      orgId.trim() !== pathIds.orgId ||
      workspaceId.trim() !== pathIds.workspaceId
    ) {
      throw new SarvamApiError(
        "Live outbound calls must use SARVAM_ORG_ID and SARVAM_WORKSPACE_ID (not internal database IDs)",
        401
      );
    }

    const endpoint = `${this.baseUrl}/api/outbounds/v1/orgs/${pathIds.orgId}/workspaces/${pathIds.workspaceId}/outbounds`;

    let response: Response;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15-second timeout

      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "X-API-Key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
    } catch (networkError) {
      // Network timeout / connection drop after dispatch is ambiguous (call may have initiated)
      const message = networkError instanceof Error ? networkError.message : "Network error";
      const isTimeout = networkError instanceof Error && networkError.name === "AbortError";
      throw new SarvamApiError(
        `Sarvam API request failed: ${message}${isTimeout ? " (Request timed out)" : ""}`,
        undefined,
        networkError,
        true // mark as ambiguous outcome
      );
    }

    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = await response.text();
      }

      // 5xx errors from provider are potentially ambiguous
      const isAmbiguous = response.status >= 500 && response.status <= 504;

      throw new SarvamApiError(
        `Sarvam API returned HTTP ${response.status}: ${JSON.stringify(errorBody)}`,
        response.status,
        errorBody,
        isAmbiguous
      );
    }

    try {
      const data = (await response.json()) as SarvamOutboundResponse;
      if (!data.attempt_id) {
        throw new SarvamApiError(
          "Sarvam API response missing attempt_id field",
          response.status,
          data
        );
      }
      return data;
    } catch (parseError) {
      throw new SarvamApiError(
        "Failed to parse Sarvam API response JSON",
        response.status,
        parseError
      );
    }
  }

  /**
   * Simulates a mock outbound call response for safe development and automated testing.
   */
  private async simulateMockCall(
    payload: SarvamOutboundPayload
  ): Promise<SarvamOutboundResponse> {
    // Basic validation of required fields
    if (!payload.user_config?.user_phone_number) {
      throw new SarvamApiError("Validation error: user_phone_number is required", 422);
    }
    if (!payload.app_config?.app_id) {
      throw new SarvamApiError("Validation error: app_id is required", 422);
    }

    // Deterministic mock failure test cases if requested in variables
    if (payload.app_config.agent_variables?.__test_simulate_failure === true) {
      throw new SarvamApiError("Simulated Sarvam telephony failure", 500);
    }

    const uniqueSuffix = Math.random().toString(36).substring(2, 10);
    return {
      attempt_id: `mock_att_${Date.now()}_${uniqueSuffix}`,
    };
  }
}

export const sarvamClient = new SarvamClient();

