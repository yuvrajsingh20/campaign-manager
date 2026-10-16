import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, canAccessOrganization } from "@/lib/auth";
import { enqueueCampaignContacts } from "@/lib/queue";
import { ApiResponse } from "@/types";


interface RouteParams {
  params: Promise<{ id: string; action: string }>;
}

const VALID_ACTIONS = ["start", "pause", "resume", "stop"] as const;
type LifecycleAction = (typeof VALID_ACTIONS)[number];

/**
 * POST /api/campaigns/[id]/[action]
 * Controls campaign lifecycle execution: start, pause, resume, stop.
 * Enforces server session authentication, tenant isolation, and inactive organization restrictions.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireAuth(req);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const { id: campaignId, action } = await params;

    if (!VALID_ACTIONS.includes(action as LifecycleAction)) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "INVALID_ACTION",
            message: `Invalid action '${action}'. Permitted actions are: ${VALID_ACTIONS.join(", ")}`,
          },
        },
        { status: 400 }
      );
    }

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        organization: true,
        _count: {
          select: { contacts: true },
        },
      },
    });

    if (!campaign) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: `Campaign with id '${campaignId}' not found.`,
          },
        },
        { status: 404 }
      );
    }

    // Tenant Isolation Guard
    if (!canAccessOrganization(user, campaign.organizationId)) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: `Campaign with id '${campaignId}' not found.`,
          },
        },
        { status: 404 }
      );
    }

    // Inactive Organization Enforcement
    if (campaign.organization.status === "INACTIVE" && (action === "start" || action === "resume")) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "ORGANIZATION_INACTIVE",
            message: "Cannot start or resume campaigns for an inactive organization.",
          },
        },
        { status: 400 }
      );
    }

    // --- Action: START ---
    if (action === "start") {
      // Idempotency: If already running, return success
      if (campaign.status === "RUNNING") {
        return NextResponse.json<ApiResponse>({
          success: true,
          data: { status: "RUNNING", message: "Campaign is already running" },
        });
      }

      // Guard: Cannot start completed or stopped campaigns
      if (campaign.status === "COMPLETED" || campaign.status === "CANCELLED") {
        return NextResponse.json<ApiResponse>(
          {
            success: false,
            error: {
              code: "INVALID_STATE_TRANSITION",
              message: `Campaign in '${campaign.status}' state cannot be started.`,
            },
          },
          { status: 400 }
        );
      }

      // Guard: Require at least 1 contact in the cohort
      if (campaign._count.contacts === 0) {
        return NextResponse.json<ApiResponse>(
          {
            success: false,
            error: {
              code: "NO_CONTACTS",
              message:
                "Cannot start campaign with 0 contacts. Please upload a customer cohort first.",
            },
          },
          { status: 400 }
        );
      }

      // Transition to RUNNING
      const updated = await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: "RUNNING" },
      });

      // Enqueue eligible contacts
      const enqueuedCount = await enqueueCampaignContacts(campaignId);

      return NextResponse.json<ApiResponse>({
        success: true,
        data: {
          campaign: updated,
          status: "RUNNING",
          enqueuedContacts: enqueuedCount,
        },
      });
    }

    // --- Action: PAUSE ---
    if (action === "pause") {
      if (campaign.status === "PAUSED") {
        return NextResponse.json<ApiResponse>({
          success: true,
          data: { status: "PAUSED", message: "Campaign is already paused" },
        });
      }

      if (campaign.status !== "RUNNING") {
        return NextResponse.json<ApiResponse>(
          {
            success: false,
            error: {
              code: "INVALID_STATE_TRANSITION",
              message: `Only RUNNING campaigns can be paused. Current status is '${campaign.status}'.`,
            },
          },
          { status: 400 }
        );
      }

      // Update to PAUSED
      const updated = await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: "PAUSED" },
      });

      // Revert QUEUED contacts back to PENDING so they halt dispatch
      await prisma.contact.updateMany({
        where: { campaignId, status: "QUEUED" },
        data: { status: "PENDING" },
      });

      return NextResponse.json<ApiResponse>({
        success: true,
        data: {
          campaign: updated,
          status: "PAUSED",
        },
      });
    }

    // --- Action: RESUME ---
    if (action === "resume") {
      if (campaign.status === "RUNNING") {
        return NextResponse.json<ApiResponse>({
          success: true,
          data: { status: "RUNNING", message: "Campaign is already running" },
        });
      }

      if (campaign.status !== "PAUSED") {
        return NextResponse.json<ApiResponse>(
          {
            success: false,
            error: {
              code: "INVALID_STATE_TRANSITION",
              message: `Only PAUSED campaigns can be resumed. Current status is '${campaign.status}'.`,
            },
          },
          { status: 400 }
        );
      }

      // Update to RUNNING
      const updated = await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: "RUNNING" },
      });

      // Re-enqueue eligible contacts
      const enqueuedCount = await enqueueCampaignContacts(campaignId);

      return NextResponse.json<ApiResponse>({
        success: true,
        data: {
          campaign: updated,
          status: "RUNNING",
          enqueuedContacts: enqueuedCount,
        },
      });
    }

    // --- Action: STOP ---
    if (action === "stop") {
      if (campaign.status === "CANCELLED") {
        return NextResponse.json<ApiResponse>({
          success: true,
          data: { status: "CANCELLED", message: "Campaign is already stopped" },
        });
      }

      // Update to CANCELLED
      const updated = await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: "CANCELLED" },
      });

      // Prevent future dispatches: mark remaining QUEUED / PENDING contacts as DO_NOT_CALL or CANCELLED
      await prisma.contact.updateMany({
        where: { campaignId, status: { in: ["PENDING", "QUEUED"] } },
        data: { status: "DO_NOT_CALL" },
      });

      return NextResponse.json<ApiResponse>({
        success: true,
        data: {
          campaign: updated,
          status: "CANCELLED",
        },
      });
    }

    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: { code: "UNKNOWN_ACTION", message: "Action not supported" },
      },
      { status: 400 }
    );
  } catch (error) {
    console.error("POST /api/campaigns/[id]/[action] error:", error);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "Failed to execute lifecycle action",
        },
      },
      { status: 500 }
    );
  }
}
