import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, canAccessOrganization } from "@/lib/auth";
import { updateCampaignSchema, contactFilterSchema } from "@/lib/validations/campaign";
import { Role } from "@prisma/client";
import { ApiResponse, PaginatedResult } from "@/types";


interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/campaigns/[id]
 * Fetches campaign details and its associated contacts (paginated), scoped to authenticated tenant.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireAuth(req);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const { id } = await params;
    const { searchParams } = new URL(req.url);

    const contactFilter = contactFilterSchema.safeParse({
      page: searchParams.get("page") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      search: searchParams.get("search") ?? undefined,
    });

    if (!contactFilter.success) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid query parameters",
            details: contactFilter.error.flatten(),
          },
        },
        { status: 400 }
      );
    }

    const { page, limit, status, search } = contactFilter.data;
    const skip = (page - 1) * limit;

    const campaign = await prisma.campaign.findUnique({
      where: { id },
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
    });

    if (!campaign) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: `Campaign with id '${id}' was not found.`,
          },
        },
        { status: 404 }
      );
    }

    // Tenant Isolation Guard: Verify access to campaign's organization
    if (!canAccessOrganization(user, campaign.organizationId)) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: `Campaign with id '${id}' was not found.`,
          },
        },
        { status: 404 }
      );
    }

    const contactWhere = {
      campaignId: id,
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { phoneNumber: { contains: search, mode: "insensitive" as const } },
              { firstName: { contains: search, mode: "insensitive" as const } },
              { lastName: { contains: search, mode: "insensitive" as const } },
              { leadId: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [totalContacts, contacts, statusGroups, retryingCount, totalAnsweredCalls, totalFailedCalls] =
      await Promise.all([
        prisma.contact.count({ where: contactWhere }),
        prisma.contact.findMany({
          where: contactWhere,
          skip,
          take: limit,
          orderBy: { createdAt: "asc" },
          include: {
            callAttempts: {
              orderBy: { attemptNumber: "desc" },
              take: 5,
            },
          },
        }),
        prisma.contact.groupBy({
          by: ["status"],
          where: { campaignId: id },
          _count: { status: true },
        }),
        prisma.contact.count({
          where: {
            campaignId: id,
            status: { in: ["PENDING", "QUEUED"] },
            retryCount: { gt: 0 },
          },
        }),
        prisma.callAttempt.count({
          where: {
            campaignId: id,
            status: "ANSWERED",
          },
        }),
        prisma.callAttempt.count({
          where: {
            campaignId: id,
            status: { in: ["FAILED", "BUSY", "NO_ANSWER"] },
          },
        }),
      ]);

    const statusCounts: Record<string, number> = {
      TOTAL: 0,
      PENDING: 0,
      QUEUED: 0,
      IN_PROGRESS: 0,
      COMPLETED: 0,
      FAILED: 0,
      DO_NOT_CALL: 0,
      RETRYING: retryingCount,
    };
    let totalCohort = 0;
    for (const group of statusGroups) {
      statusCounts[group.status] = group._count.status;
      totalCohort += group._count.status;
    }
    statusCounts.TOTAL = totalCohort;

    const totalPages = Math.ceil(totalContacts / limit) || 1;

    const contactsPaginated: PaginatedResult<(typeof contacts)[0]> = {
      items: contacts,
      pagination: {
        page,
        limit,
        totalItems: totalContacts,
        totalPages,
      },
    };

    return NextResponse.json<
      ApiResponse<{
        campaign: typeof campaign;
        contacts: typeof contactsPaginated;
        statusCounts: typeof statusCounts;
        metrics: {
          answeredCalls: number;
          failedCalls: number;
        };
      }>
    >({
      success: true,
      data: {
        campaign,
        contacts: contactsPaginated,
        statusCounts,
        metrics: {
          answeredCalls: totalAnsweredCalls,
          failedCalls: totalFailedCalls,
        },
      },
    });
  } catch (error) {
    console.error("GET /api/campaigns/[id] error:", error);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "Failed to fetch campaign",
        },
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/campaigns/[id]
 * Updates campaign configuration safely while validating state rules and tenant isolation.
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireAuth(req);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const { id } = await params;
    const body = await req.json();

    const parseResult = updateCampaignSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid update parameters",
            details: parseResult.error.flatten(),
          },
        },
        { status: 400 }
      );
    }

    const existing = await prisma.campaign.findUnique({
      where: { id },
      include: { organization: true },
    });

    if (!existing) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: `Campaign with id '${id}' not found.`,
          },
        },
        { status: 404 }
      );
    }

    // Tenant Isolation Guard
    if (!canAccessOrganization(user, existing.organizationId)) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: `Campaign with id '${id}' not found.`,
          },
        },
        { status: 404 }
      );
    }

    // Inactive Organization Guard
    if (user.role !== Role.SUPERADMIN && existing.organization.status === "INACTIVE") {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "ORGANIZATION_INACTIVE",
            message: "Cannot modify campaigns for an inactive organization.",
          },
        },
        { status: 403 }
      );
    }

    // Guard: Prevent updating completed or cancelled campaigns
    if (existing.status === "COMPLETED" || existing.status === "CANCELLED") {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "INVALID_STATE",
            message: `Campaign in '${existing.status}' status cannot be updated.`,
          },
        },
        { status: 400 }
      );
    }

    const data = parseResult.data;

    const updated = await prisma.campaign.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.sarvamAgentId !== undefined ? { sarvamAgentId: data.sarvamAgentId } : {}),
        ...(data.agentAppId !== undefined ? { agentAppId: data.agentAppId } : {}),
        ...(data.agentVersion !== undefined ? { agentVersion: data.agentVersion } : {}),
        ...(data.agentType !== undefined ? { agentType: data.agentType } : {}),
        ...(data.agentConfig !== undefined ? { agentConfig: data.agentConfig as object } : {}),
        ...(data.requiredVariables !== undefined ? { requiredVariables: data.requiredVariables } : {}),
        ...(data.connectionId !== undefined ? { connectionId: data.connectionId } : {}),
        ...(data.callerPhoneNumber !== undefined
          ? { callerPhoneNumber: data.callerPhoneNumber || null }
          : {}),
        ...(data.maxRequestsPerSecond !== undefined
          ? { maxRequestsPerSecond: data.maxRequestsPerSecond }
          : {}),
        ...(data.scheduledStartTime !== undefined
          ? {
              scheduledStartTime: data.scheduledStartTime
                ? new Date(data.scheduledStartTime)
                : null,
            }
          : {}),
        ...(data.scheduledEndTime !== undefined
          ? {
              scheduledEndTime: data.scheduledEndTime
                ? new Date(data.scheduledEndTime)
                : null,
            }
          : {}),
        ...(data.dailyStartTime !== undefined ? { dailyStartTime: data.dailyStartTime } : {}),
        ...(data.dailyEndTime !== undefined ? { dailyEndTime: data.dailyEndTime } : {}),
        ...(data.timezone !== undefined ? { timezone: data.timezone } : {}),
        ...(data.allowedDays !== undefined ? { allowedDays: data.allowedDays } : {}),
        ...(data.maxRetries !== undefined ? { maxRetries: data.maxRetries } : {}),
        ...(data.retryIntervalMinutes !== undefined
          ? { retryIntervalMinutes: data.retryIntervalMinutes }
          : {}),
        ...(data.concurrencyLimit !== undefined
          ? { concurrencyLimit: data.concurrencyLimit }
          : {}),
        ...(data.retryOnBusy !== undefined ? { retryOnBusy: data.retryOnBusy } : {}),
        ...(data.retryOnNoAnswer !== undefined ? { retryOnNoAnswer: data.retryOnNoAnswer } : {}),
        ...(data.retryOnShortDuration !== undefined
          ? { retryOnShortDuration: data.retryOnShortDuration }
          : {}),
        ...(data.shortDurationThresholdSeconds !== undefined
          ? { shortDurationThresholdSeconds: data.shortDurationThresholdSeconds }
          : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
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
        data: updated,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("PATCH /api/campaigns/[id] error:", error);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "Failed to update campaign",
        },
      },
      { status: 500 }
    );
  }
}
