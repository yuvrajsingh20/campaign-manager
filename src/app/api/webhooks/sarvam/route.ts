import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enqueueContactRetry } from "@/lib/queue";
import { CallAttemptStatus, ContactStatus } from "@/types";

/**
 * Webhook payload schema from Sarvam / telephony provider.
 */
interface SarvamWebhookEvent {
  attempt_id: string;
  status: string; // "completed", "answered", "busy", "no_answer", "failed", "cancelled"
  duration_seconds?: number;
  duration?: number;
  start_time?: string;
  close_time?: string;
  failure_reason?: string;
  disconnection_reason?: string;
  recording_url?: string;
  transcript?: string;
  metadata?: {
    campaign_id?: string;
    contact_id?: string;
    lead_id?: string;
    attempt_id?: string;
  };
}

/**
 * Maps external provider status string to CallAttemptStatus enum.
 */
function mapCallAttemptStatus(status: string): CallAttemptStatus {
  const s = status.toLowerCase();
  if (s === "completed" || s === "answered" || s === "success" || s === "connected") return "ANSWERED";
  if (s === "busy") return "BUSY";
  if (s === "no_answer" || s === "no-answer" || s === "timeout") return "NO_ANSWER";
  if (s === "voicemail") return "VOICEMAIL";
  if (s === "cancelled") return "CANCELLED";
  return "FAILED";
}

/**
 * POST /api/webhooks/sarvam
 * Processes call outcome telemetry and applies retry policies.
 */
export async function POST(req: NextRequest) {
  try {
    // Webhook Security: Enforce secret verification
    const expectedSecret = process.env.WEBHOOK_SECRET;
    const isProduction = process.env.NODE_ENV === "production";

    // In production, reject if secret is missing or set to the default development secret
    if (isProduction && (!expectedSecret || expectedSecret === "local-dev-webhook-secret")) {
      console.error("[Webhook] WEBHOOK_SECRET is not configured or using default dev secret in production environment.");
      return NextResponse.json(
        { success: false, error: "Webhook secret is not configured securely for production." },
        { status: 500 }
      );
    }

    if (expectedSecret && (isProduction || expectedSecret !== "local-dev-webhook-secret")) {
      // Security: Webhook secrets must ONLY be passed via HTTP headers (x-webhook-secret or Authorization: Bearer).
      // Secrets are never accepted via query strings to prevent leakage in server access logs and URLs.
      const incomingSecret =
        req.headers.get("x-webhook-secret") ||
        req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

      if (!incomingSecret || incomingSecret !== expectedSecret) {
        return NextResponse.json(
          { success: false, error: "Invalid or missing webhook secret header" },
          { status: 401 }
        );
      }
    }

    const payload = (await req.json()) as SarvamWebhookEvent;

    if (!payload.attempt_id) {
      return NextResponse.json(
        { success: false, error: "Missing attempt_id in webhook payload" },
        { status: 400 }
      );
    }

    // Correlate with CallAttempt record by externalCallId or metadata
    let callAttempt = await prisma.callAttempt.findFirst({
      where: {
        OR: [
          { externalCallId: payload.attempt_id },
          ...(payload.metadata?.attempt_id ? [{ id: payload.metadata.attempt_id }] : []),
        ],
      },
      include: {
        campaign: true,
        contact: true,
      },
    });

    if (!callAttempt && payload.metadata?.contact_id) {
      callAttempt = await prisma.callAttempt.findFirst({
        where: { contactId: payload.metadata.contact_id },
        orderBy: { createdAt: "desc" },
        include: {
          campaign: true,
          contact: true,
        },
      });
    }

    if (!callAttempt) {
      return NextResponse.json(
        {
          success: false,
          error: `No call attempt found matching provider attempt_id '${payload.attempt_id}'`,
        },
        { status: 404 }
      );
    }

    const { campaign, contact } = callAttempt;
    const duration = payload.duration_seconds ?? payload.duration ?? callAttempt.durationSeconds ?? 0;
    const failureReason = payload.disconnection_reason || payload.failure_reason;

    // Idempotency check: If call attempt already reached terminal status with an endedAt timestamp
    if (callAttempt.endedAt !== null) {
      return NextResponse.json({
        success: true,
        message: "Call attempt already finalized by earlier webhook event",
        data: {
          attemptId: callAttempt.id,
          attemptStatus: callAttempt.status,
          contactStatus: contact.status,
          retrying: false,
        },
      });
    }

    const targetStatus = mapCallAttemptStatus(payload.status);
    const isShortDuration =
      targetStatus === "ANSWERED" &&
      campaign.retryOnShortDuration &&
      duration < campaign.shortDurationThresholdSeconds;

    // Update CallAttempt telemetry
    await prisma.callAttempt.update({
      where: { id: callAttempt.id },
      data: {
        status: targetStatus,
        durationSeconds: duration,
        endedAt: payload.close_time ? new Date(payload.close_time) : new Date(),
        startedAt: payload.start_time ? new Date(payload.start_time) : callAttempt.startedAt,
        failureReason: failureReason || callAttempt.failureReason,
        recordingUrl: payload.recording_url || callAttempt.recordingUrl,
        transcript: payload.transcript || callAttempt.transcript,
        rawResponse: payload as unknown as object,
      },
    });

    // Evaluate Contact Status & Retry Rules
    let newContactStatus: ContactStatus = "COMPLETED";
    let shouldRetry = false;

    if (targetStatus === "ANSWERED" && !isShortDuration) {
      newContactStatus = "COMPLETED";
    } else {
      // Determine retry eligibility based on campaign settings
      if (targetStatus === "BUSY" && campaign.retryOnBusy) {
        shouldRetry = true;
      } else if (targetStatus === "NO_ANSWER" && campaign.retryOnNoAnswer) {
        shouldRetry = true;
      } else if (isShortDuration && campaign.retryOnShortDuration) {
        shouldRetry = true;
      } else if (targetStatus === "FAILED") {
        shouldRetry = true;
      }

      // Check max retries budget
      if (shouldRetry && contact.retryCount >= campaign.maxRetries) {
        shouldRetry = false;
        newContactStatus = "FAILED";
      }

      // If campaign has been stopped or completed, do not retry
      if (campaign.status === "CANCELLED" || campaign.status === "COMPLETED") {
        shouldRetry = false;
        newContactStatus = "FAILED";
      } else if (campaign.status === "PAUSED") {
        // Paused campaign: do not re-enqueue active jobs right now, retain PENDING for resumption
        shouldRetry = false;
        newContactStatus = "PENDING";
      }
    }

    if (shouldRetry) {
      const backoffMs = campaign.retryIntervalMinutes * 60 * 1000;
      const nextAttemptDate = new Date(Date.now() + backoffMs);

      await prisma.contact.update({
        where: { id: contact.id },
        data: {
          status: "QUEUED",
          nextAttemptAt: nextAttemptDate,
        },
      });

      // Schedule delayed BullMQ retry job
      await enqueueContactRetry(campaign.id, contact.id, contact.retryCount + 1, backoffMs);
    } else {
      await prisma.contact.update({
        where: { id: contact.id },
        data: {
          status: newContactStatus,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        attemptId: callAttempt.id,
        externalCallId: payload.attempt_id,
        attemptStatus: targetStatus,
        contactStatus: shouldRetry ? "QUEUED" : newContactStatus,
        retrying: shouldRetry,
      },
    });
  } catch (error) {
    console.error("POST /api/webhooks/sarvam error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Webhook processing failed",
      },
      { status: 500 }
    );
  }
}
