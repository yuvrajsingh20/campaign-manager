import { prisma } from "./prisma";
import { OrgRateLimiter } from "./rate-limiter";
import { resolveOrganizationRequestsPerSecond } from "./validations/rate-limit";
import { isCallingWindowOpen } from "./scheduler";
import {
  sarvamClient,
  SarvamApiError,
  SarvamClient,
  resolveSarvamOutboundPathIds,
} from "./sarvam";
import { OutboundCallJobData, enqueueContactRetry } from "./queue";

export interface ExecutionResult {
  status: "DISPATCHED" | "SKIPPED" | "RESCHEDULED" | "FAILED" | "RATE_LIMITED";
  attemptId?: string;
  reason?: string;
}

/**
 * Core business processor for dispatching an outbound call job.
 * Enforces PostgreSQL authoritative state, calling windows, organization rate limits,
 * durable attempt logging, and Sarvam API communication.
 */
export async function processOutboundCallJob(
  jobData: OutboundCallJobData
): Promise<ExecutionResult> {
  const { campaignId, contactId } = jobData;

  // 1. Authoritative check: Load Campaign and Contact state from PostgreSQL
  const [campaign, contact] = await Promise.all([
    prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        organization: {
          select: { id: true, rateLimitPerMinute: true, maxRequestsPerSecond: true, status: true },
        },
      },
    }),
    prisma.contact.findUnique({
      where: { id: contactId },
    }),
  ]);

  if (!campaign) {
    return { status: "SKIPPED", reason: `Campaign ${campaignId} not found` };
  }

  if (!contact) {
    return { status: "SKIPPED", reason: `Contact ${contactId} not found` };
  }

  // Guard: Inactive organization cannot dispatch calls
  if (campaign.organization.status === "INACTIVE") {
    return {
      status: "SKIPPED",
      reason: `Organization ${campaign.organizationId} is INACTIVE. Dispatches blocked.`,
    };
  }

  // Guard: Campaign must be strictly RUNNING
  if (campaign.status !== "RUNNING") {
    // If paused, revert contact to PENDING so it can resume later
    if (campaign.status === "PAUSED" && contact.status === "QUEUED") {
      await prisma.contact.update({
        where: { id: contactId },
        data: { status: "PENDING" },
      });
    }
    return {
      status: "SKIPPED",
      reason: `Campaign is in '${campaign.status}' state, not RUNNING`,
    };
  }

  // Guard: Contact must be QUEUED or PENDING (prevent duplicate attempts or calling completed leads)
  if (contact.status !== "QUEUED" && contact.status !== "PENDING") {
    return {
      status: "SKIPPED",
      reason: `Contact is already in '${contact.status}' status`,
    };
  }

  // 2. Calling window and scheduling check
  const windowCheck = isCallingWindowOpen(campaign);
  if (!windowCheck.isAllowed) {
    const delay = windowCheck.delayMs || 3600 * 1000;

    // Keep the contact claimed as QUEUED and schedule one delayed job.
    // A separate PENDING write here would release the contact before the retry
    // job exists, so a second worker could dial the same number.
    await enqueueContactRetry(campaignId, contactId, contact.retryCount + 1, delay);

    return {
      status: "RESCHEDULED",
      reason: windowCheck.reason || "Outside permitted calling window",
    };
  }

  // 3. Organisation-wide rate limiting immediately prior to dispatch.
  // The shared Redis key always uses the superadmin organisation ceiling.
  // The campaign setting is a separate, lower-or-equal cap and cannot raise that ceiling.
  const orgRps = resolveOrganizationRequestsPerSecond(campaign.organization);
  const rateCheck = await OrgRateLimiter.reserveDispatch({
    organizationId: campaign.organizationId,
    organizationRps: orgRps,
    campaignId: campaign.id,
    campaignRps: campaign.maxRequestsPerSecond,
  });

  if (!rateCheck.allowed) {
    const delay = Math.max(500, rateCheck.retryAfterMs);
    // Delay contact attempt
    await enqueueContactRetry(campaignId, contactId, contact.retryCount + 1, delay);
    return {
      status: "RATE_LIMITED",
      reason: `Org-wide rate limit reached. Re-enqueued in ${delay}ms`,
    };
  }

  // 4. Atomically claim contact to prevent duplicate dispatches across concurrent workers
  const attemptNumber = contact.retryCount + 1;
  const claimResult = await prisma.contact.updateMany({
    where: {
      id: contactId,
      campaignId,
      status: { in: ["QUEUED", "PENDING"] },
    },
    data: {
      status: "IN_PROGRESS",
      retryCount: attemptNumber,
      lastAttemptAt: new Date(),
    },
  });

  if (claimResult.count === 0) {
    return {
      status: "SKIPPED",
      reason: `Contact ${contactId} was already claimed or updated by another worker`,
    };
  }

  // Create persistent CallAttempt record in PostgreSQL
  const callAttempt = await prisma.callAttempt.create({
    data: {
      campaignId,
      contactId,
      attemptNumber,
      status: "INITIATED",
      startedAt: new Date(),
    },
  });

  // 5. Construct mapped Sarvam payload matching official API contract
  const appVersion = SarvamClient.parseAppVersion(campaign.agentVersion);
  const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/webhooks/sarvam`;

  const appId = campaign.agentAppId || campaign.sarvamAgentId;
  const connId = campaign.connectionId;
  const callerNumber = campaign.callerPhoneNumber;
  // Assignment PDF explicitly specifies "app_type": "agent"
  const appType = campaign.agentType === "outbound_voice" ? "agent" : campaign.agentType || "agent";

  // Helper to detect development/demo placeholder strings
  const isPlaceholderValue = (val?: string | null) => {
    if (!val) return true;
    const lower = val.trim().toLowerCase();
    return (
      lower.startsWith("mock_") ||
      lower.includes("placeholder") ||
      lower.includes("example") ||
      lower.startsWith("dummy") ||
      lower === "agent_xxxxxxxx" ||
      lower === "agent_placeholder" ||
      lower === "conn_placeholder" ||
      lower === "+10000000000" ||
      lower === "+0000000000" ||
      lower === "+1234567890" ||
      lower === "+12345678901"
    );
  };

  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction && process.env.SARVAM_MOCK_MODE === "true" && process.env.ALLOW_MOCK_TELEPHONY !== "true") {
    throw new Error(
      "Cannot use mock telephony in production environment without explicit ALLOW_MOCK_TELEPHONY=true"
    );
  }

  // In live mode, validate configuration strictly rather than silently substituting fake placeholders
  const isMock =
    !isProduction
      ? process.env.SARVAM_MOCK_MODE === "true" ||
        process.env.NODE_ENV === "test" ||
        !process.env.SARVAM_API_KEY ||
        process.env.SARVAM_API_KEY === "your-sarvam-api-key-here"
      : process.env.SARVAM_MOCK_MODE === "true" && process.env.ALLOW_MOCK_TELEPHONY === "true";

  if (!isMock) {
    const invalidConfig: string[] = [];
    if (!appId || isPlaceholderValue(appId)) {
      invalidConfig.push("agentAppId must be a valid Sarvam agent ID (cannot be empty or placeholder)");
    }
    if (!connId || isPlaceholderValue(connId)) {
      invalidConfig.push("connectionId must be a valid telephony connection trunk (cannot be empty or placeholder)");
    }
    if (!callerNumber || isPlaceholderValue(callerNumber)) {
      invalidConfig.push("callerPhoneNumber must be a valid E.164 phone number (cannot be placeholder)");
    }
    if (!process.env.SARVAM_API_KEY || process.env.SARVAM_API_KEY === "your-sarvam-api-key-here") {
      invalidConfig.push("SARVAM_API_KEY must be configured with a valid provider key");
    }
    // Shared Sarvam account path IDs — distinct from Prisma organizationId / workspaceId
    try {
      resolveSarvamOutboundPathIds({ requireConfigured: true });
    } catch (err) {
      invalidConfig.push(
        err instanceof Error
          ? err.message
          : "SARVAM_ORG_ID and SARVAM_WORKSPACE_ID must be configured for live outbound calls"
      );
    }

    if (invalidConfig.length > 0) {
      throw new Error(
        `Cannot dispatch live call: invalid campaign telephony configuration:\n- ${invalidConfig.join("\n- ")}`
      );
    }
  }

  // External Sarvam path IDs for the provider URL; internal CUIDs stay on campaign for DB/auth/rate limits
  const { orgId: sarvamOrgId, workspaceId: sarvamWorkspaceId } =
    resolveSarvamOutboundPathIds({ requireConfigured: !isMock });

  const payload = {
    app_config: {
      app_id: appId || "mock_app_id",
      app_version: appVersion,
      app_type: appType,
      connection_config: {
        connection_id: connId || "mock_conn_id",
        agent_phone_number: callerNumber || "+10000000000",
      },
      agent_variables: (contact.customVariables as Record<string, unknown>) || {},
      app_overrides: (campaign.agentConfig as Record<string, unknown>) || null,
    },
    app_overrides: (campaign.agentConfig as Record<string, unknown>) || null,
    user_config: {
      user_phone_number: contact.phoneNumber,
    },
    webhook_config: {
      url: webhookUrl,
      metadata: {
        campaign_id: campaign.id,
        contact_id: contact.id,
        lead_id: contact.leadId || "",
        attempt_id: callAttempt.id,
      },
    },
  };

  // 6. Dispatch outbound call
  try {
    const response = await sarvamClient.createOutboundCall(
      sarvamOrgId,
      sarvamWorkspaceId,
      payload
    );

    // Update CallAttempt with provider external attempt ID
    await prisma.callAttempt.update({
      where: { id: callAttempt.id },
      data: {
        externalCallId: response.attempt_id,
        status: "RINGING",
      },
    });

    return {
      status: "DISPATCHED",
      attemptId: response.attempt_id,
    };
  } catch (error) {
    const isSarvamError = error instanceof SarvamApiError;
    const isAmbiguous = isSarvamError ? error.isAmbiguous : false;
    const failureReason = error instanceof Error ? error.message : "Unknown dispatch error";

    console.error(`[ExecutionEngine] Dispatch failed for contact ${contactId}:`, failureReason);

    await prisma.callAttempt.update({
      where: { id: callAttempt.id },
      data: {
        status: "FAILED",
        failureReason,
        endedAt: new Date(),
        rawResponse: isSarvamError && error.details ? (error.details as object) : undefined,
      },
    });

    // Handle retries & contact state safely without stranding contacts in IN_PROGRESS
    if (!isAmbiguous) {
      if (attemptNumber < campaign.maxRetries) {
        const backoffMs = campaign.retryIntervalMinutes * 60 * 1000;
        await prisma.contact.update({
          where: { id: contactId },
          data: {
            status: "PENDING",
            nextAttemptAt: new Date(Date.now() + backoffMs),
          },
        });
        await enqueueContactRetry(campaignId, contactId, attemptNumber + 1, backoffMs);
      } else {
        await prisma.contact.update({
          where: { id: contactId },
          data: { status: "FAILED" },
        });
      }
    } else {
      // Ambiguous dispatch failure (network timeout/5xx):
      // Do not leave contact permanently in IN_PROGRESS. Apply a reconciliation grace window
      // before retrying to prevent calling the customer twice if Sarvam initiated the call.
      const reconciliationMs = Math.max(5 * 60 * 1000, campaign.retryIntervalMinutes * 60 * 1000);
      if (attemptNumber < campaign.maxRetries) {
        await prisma.contact.update({
          where: { id: contactId },
          data: {
            status: "PENDING",
            nextAttemptAt: new Date(Date.now() + reconciliationMs),
          },
        });
        await enqueueContactRetry(campaignId, contactId, attemptNumber + 1, reconciliationMs);
      } else {
        await prisma.contact.update({
          where: { id: contactId },
          data: { status: "FAILED" },
        });
      }
    }

    return {
      status: "FAILED",
      reason: failureReason,
    };
  }
}

/**
 * Worker Stale-Job Recovery:
 * Scans for contacts left in IN_PROGRESS due to worker process crashes or network timeouts.
 * Safely recovers them without creating duplicate phone calls.
 */
export async function recoverStaleContacts(maxStaleAgeMs = 5 * 60 * 1000): Promise<number> {
  const staleThreshold = new Date(Date.now() - maxStaleAgeMs);

  const staleContacts = await prisma.contact.findMany({
    where: {
      status: "IN_PROGRESS",
      lastAttemptAt: { lt: staleThreshold },
    },
    include: {
      campaign: true,
      callAttempts: {
        orderBy: { attemptNumber: "desc" },
        take: 1,
      },
    },
  });

  let recoveredCount = 0;
  for (const contact of staleContacts) {
    const latestAttempt = contact.callAttempts[0];

    // If attempt has no externalCallId, the worker crashed before provider received request
    if (!latestAttempt || !latestAttempt.externalCallId) {
      if (latestAttempt) {
        await prisma.callAttempt.update({
          where: { id: latestAttempt.id },
          data: {
            status: "FAILED",
            failureReason: "Worker crashed before dispatch completed",
            endedAt: new Date(),
          },
        });
      }

      if (contact.campaign.status === "RUNNING") {
        if (contact.retryCount < contact.campaign.maxRetries) {
          await prisma.contact.update({
            where: { id: contact.id },
            data: { status: "PENDING" },
          });
          await enqueueContactRetry(contact.campaignId, contact.id, contact.retryCount + 1, 0);
        } else {
          await prisma.contact.update({
            where: { id: contact.id },
            data: { status: "FAILED" },
          });
        }
      } else {
        await prisma.contact.update({
          where: { id: contact.id },
          data: { status: "PENDING" },
        });
      }
      recoveredCount++;
    } else {
      // It had an externalCallId, but no webhook arrived within extended timeout
      const extendedTimeout = new Date(Date.now() - maxStaleAgeMs * 2);
      if (latestAttempt.startedAt && latestAttempt.startedAt < extendedTimeout) {
        await prisma.callAttempt.update({
          where: { id: latestAttempt.id },
          data: {
            status: "FAILED",
            failureReason: "Timed out awaiting provider webhook outcome",
            endedAt: new Date(),
          },
        });
        if (
          contact.retryCount < contact.campaign.maxRetries &&
          contact.campaign.status === "RUNNING"
        ) {
          await prisma.contact.update({
            where: { id: contact.id },
            data: { status: "PENDING" },
          });
          await enqueueContactRetry(
            contact.campaignId,
            contact.id,
            contact.retryCount + 1,
            contact.campaign.retryIntervalMinutes * 60 * 1000
          );
        } else {
          await prisma.contact.update({
            where: { id: contact.id },
            data: { status: "FAILED" },
          });
        }
        recoveredCount++;
      }
    }
  }

  return recoveredCount;
}


