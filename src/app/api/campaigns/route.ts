import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createCampaignSchema, campaignFilterSchema } from "@/lib/validations/campaign";
import { ApiResponse, PaginatedResult } from "@/types";

/**
 * POST /api/campaigns
 * Creates a new campaign.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parseResult = createCampaignSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid campaign parameters",
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

    // Notice: Tenant isolation and authorization middleware are pending implementation.
    // We attach organizationId from the verified workspace.
    const campaign = await prisma.campaign.create({
      data: {
        name: data.name,
        description: data.description ?? null,
        workspaceId: workspace.id,
        organizationId: workspace.organizationId,
        status: data.status,

        sarvamAgentId: data.sarvamAgentId ?? null,
        agentAppId: data.agentAppId ?? null,
        agentVersion: data.agentVersion,
        agentType: data.agentType,
        agentConfig: (data.agentConfig as object) ?? {},
        requiredVariables: data.requiredVariables,

        connectionId: data.connectionId ?? null,
        callerPhoneNumber: data.callerPhoneNumber || null,
        maxRequestsPerSecond: data.maxRequestsPerSecond,

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
 * Lists campaigns with pagination, filters, and contact counts.
 */
export async function GET(req: NextRequest) {
  try {
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

    const where = {
      ...(status ? { status } : {}),
      ...(workspaceId ? { workspaceId } : {}),
    };

    const [totalItems, campaigns] = await Promise.all([
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
    ]);

    const totalPages = Math.ceil(totalItems / limit) || 1;

    const result: PaginatedResult<(typeof campaigns)[0]> = {
      items: campaigns,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages,
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
