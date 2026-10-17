import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireCampaignOperator } from "@/lib/auth";
import { createCampaignSchema, campaignFilterSchema, campaignValidationMessage } from "@/lib/validations/campaign";
import {
  resolveOrganizationRequestsPerSecond,
  validateCampaignRequestsPerSecond,
} from "@/lib/validations/rate-limit";
import { Role } from "@prisma/client";
import { ApiResponse, PaginatedResult } from "@/types";


/**
 * POST /api/campaigns
 * Creates a new campaign with strict tenant isolation and workspace verification.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;
    const denied = requireCampaignOperator(user);
    if (denied) return denied;

    const body = await req.json();
    const parseResult = createCampaignSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: campaignValidationMessage(parseResult.error, "Invalid campaign parameters"),
            details: parseResult.error.flatten(),
          },
        },
        { status: 400 }
      );
    }

    const data = parseResult.data;

    // Verify workspace exists and get its associated organization
    const workspace = await prisma.workspace.findUnique({
      where: { id: data.workspaceId },
      include: { organization: true },
    });

    if (!workspace) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: `Workspace with id '${data.workspaceId}' not found. Please provide a valid workspace.`,
          },
        },
        { status: 404 }
      );
    }

    // Tenant Isolation Enforcement:
    // Non-superadmin users can ONLY create campaigns in their own organisation's workspaces
    let targetOrgId = workspace.organizationId;
    if (user.role !== Role.SUPERADMIN) {
      if (!user.organizationId || workspace.organizationId !== user.organizationId) {
        return NextResponse.json<ApiResponse>(
          {
            success: false,
            error: {
              code: "FORBIDDEN",
              message: "You cannot create campaigns in a workspace that does not belong to your organization.",
            },
          },
          { status: 403 }
        );
      }

      if (user.organization?.status === "INACTIVE" || workspace.organization.status === "INACTIVE") {
        return NextResponse.json<ApiResponse>(
          {
            success: false,
            error: {
              code: "ORGANIZATION_INACTIVE",
              message: "Cannot create campaigns for an inactive organization.",
            },
          },
          { status: 403 }
        );
      }

      targetOrgId = user.organizationId;
    }

    const orgLimit = resolveOrganizationRequestsPerSecond(workspace.organization);
    const rateCheck = validateCampaignRequestsPerSecond(data.maxRequestsPerSecond, orgLimit);
    if (!rateCheck.ok) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: rateCheck.message,
          },
        },
        { status: 400 }
      );
    }

    const campaign = await prisma.campaign.create({
      data: {
        name: data.name,
        description: data.description ?? null,
        workspaceId: workspace.id,
        organizationId: targetOrgId,
        status: data.status,

        sarvamAgentId: data.sarvamAgentId ?? null,
        agentAppId: data.agentAppId ?? null,
        agentVersion: data.agentVersion,
        agentType: data.agentType,
        agentConfig: (data.agentConfig as object) ?? {},
        requiredVariables: data.requiredVariables,

        connectionId: data.connectionId ?? null,
        callerPhoneNumber: data.callerPhoneNumber || null,
        maxRequestsPerSecond: rateCheck.value,

        scheduledStartTime: data.scheduledStartTime ? new Date(data.scheduledStartTime) : null,
        scheduledEndTime: data.scheduledEndTime ? new Date(data.scheduledEndTime) : null,
        dailyStartTime: data.dailyStartTime,
        dailyEndTime: data.dailyEndTime,
        timezone: data.timezone,
        allowedDays: data.allowedDays,

        maxRetries: data.maxRetries,
        retryIntervalMinutes: data.retryIntervalMinutes,
        concurrencyLimit: data.concurrencyLimit,
        retryOnBusy: data.retryOnBusy,
        retryOnNoAnswer: data.retryOnNoAnswer,
        retryOnShortDuration: data.retryOnShortDuration,
        shortDurationThresholdSeconds: data.shortDurationThresholdSeconds,
      },
      include: {
        workspace: {
          select: { id: true, name: true, slug: true },
        },
        _count: {
          select: { contacts: true },
        },
      },
    });

    return NextResponse.json<ApiResponse>(
      {
        success: true,
        data: campaign,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/campaigns error:", error);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "Failed to create campaign",
        },
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/campaigns
 * Lists campaigns scoped to user's authorised organisation with pagination and contact counts.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const { searchParams } = new URL(req.url);
    const filterResult = campaignFilterSchema.safeParse({
      page: searchParams.get("page") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      workspaceId: searchParams.get("workspaceId") ?? undefined,
    });

    if (!filterResult.success) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid query parameters",
            details: filterResult.error.flatten(),
          },
        },
        { status: 400 }
      );
    }

    const { page, limit, status, workspaceId } = filterResult.data;
    const skip = (page - 1) * limit;

    // Tenant isolation filter: Non-superadmins see only their own organization's campaigns
    let orgFilter: { organizationId?: string } = {};
    if (user.role !== Role.SUPERADMIN) {
      if (!user.organizationId) {
        return NextResponse.json<ApiResponse<PaginatedResult<unknown>>>({
          success: true,
          data: { items: [], pagination: { page, limit, totalItems: 0, totalPages: 1 } },
        });
      }
      orgFilter = { organizationId: user.organizationId };

      // If workspaceId was requested, verify it belongs to user's org
      if (workspaceId) {
        const ws = await prisma.workspace.findFirst({
          where: { id: workspaceId, organizationId: user.organizationId },
        });
        if (!ws) {
          return NextResponse.json<ApiResponse<PaginatedResult<unknown>>>({
            success: true,
            data: { items: [], pagination: { page, limit, totalItems: 0, totalPages: 1 } },
          });
        }
      }
    }

    const where = {
      ...orgFilter,
      ...(status ? { status } : {}),
      ...(workspaceId ? { workspaceId } : {}),
    };

    const [totalItems, campaigns, activeCampaigns, totalContacts, completedCalls, failedCalls] =
      await Promise.all([
        prisma.campaign.count({ where }),
        prisma.campaign.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          include: {
            workspace: {
              select: { id: true, name: true, slug: true },
            },
            _count: {
              select: {
                contacts: true,
                callAttempts: true,
              },
            },
          },
        }),
        prisma.campaign.count({
          where: {
            ...orgFilter,
            status: { in: ["RUNNING", "SCHEDULED"] },
          },
        }),
        prisma.contact.count({
          where: {
            campaign: orgFilter,
          },
        }),
        prisma.callAttempt.count({
          where: {
            campaign: orgFilter,
            status: "ANSWERED",
          },
        }),
        prisma.callAttempt.count({
          where: {
            campaign: orgFilter,
            status: { in: ["FAILED", "BUSY", "NO_ANSWER"] },
          },
        }),
      ]);

    const totalPages = Math.ceil(totalItems / limit) || 1;

    const result = {
      items: campaigns,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages,
      },
      metrics: {
        totalCampaigns: totalItems,
        activeCampaigns,
        totalContacts,
        completedCalls,
        failedCalls,
      },
    };

    return NextResponse.json<ApiResponse<typeof result>>({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("GET /api/campaigns error:", error);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "Failed to fetch campaigns",
        },
      },
      { status: 500 }
    );
  }
}
