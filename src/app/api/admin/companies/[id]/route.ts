import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperadmin, clearSessionCache } from "@/lib/auth";
import { OrganizationStatus } from "@prisma/client";
import { ApiResponse } from "@/types";
import { z } from "zod";


interface RouteParams {
  params: Promise<{ id: string }>;
}

const updateCompanySchema = z.object({
  status: z.nativeEnum(OrganizationStatus).optional(),
  maxRequestsPerSecond: z.coerce.number().min(0.1).optional(),
  rateLimitPerMinute: z.coerce.number().min(1).optional(),
});

/**
 * GET /api/admin/companies/[id]
 * Fetches company detail with its workspaces, users, campaigns, and call stats.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireSuperadmin(req);
    if (auth.errorResponse) return auth.errorResponse;

    const { id } = await params;

    const organization = await prisma.organization.findUnique({
      where: { id },
      include: {
        workspaces: {
          select: {
            id: true,
            name: true,
            slug: true,
            createdAt: true,
            _count: {
              select: { campaigns: true },
            },
          },
        },
        users: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            createdAt: true,
          },
        },
        campaigns: {
          select: {
            id: true,
            name: true,
            status: true,
            callerPhoneNumber: true,
            maxRequestsPerSecond: true,
            createdAt: true,
            workspace: {
              select: { id: true, name: true },
            },
            _count: {
              select: { contacts: true, callAttempts: true },
            },
          },
          orderBy: { createdAt: "desc" },
        },
        _count: {
          select: {
            workspaces: true,
            users: true,
            campaigns: true,
          },
        },
      },
    });

    if (!organization) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: `Company with id '${id}' not found.`,
          },
        },
        { status: 404 }
      );
    }

    return NextResponse.json<ApiResponse<typeof organization>>(
      {
        success: true,
        data: organization,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("GET /api/admin/companies/[id] error:", error);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to fetch company details.",
        },
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/companies/[id]
 * Updates company permitted RPS limit and/or activates/deactivates company.
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireSuperadmin(req);
    if (auth.errorResponse) return auth.errorResponse;

    const { id } = await params;
    const body = await req.json().catch(() => null);

    const parseResult = updateCompanySchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid update parameters.",
            details: parseResult.error.flatten(),
          },
        },
        { status: 400 }
      );
    }

    const existing = await prisma.organization.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: `Company with id '${id}' not found.`,
          },
        },
        { status: 404 }
      );
    }

    const { status, maxRequestsPerSecond, rateLimitPerMinute } = parseResult.data;

    const computedRps = maxRequestsPerSecond !== undefined ? maxRequestsPerSecond : existing.maxRequestsPerSecond;
    const computedRpm = rateLimitPerMinute !== undefined
      ? rateLimitPerMinute
      : maxRequestsPerSecond !== undefined
      ? Math.max(1, Math.round(maxRequestsPerSecond * 60))
      : existing.rateLimitPerMinute;

    const updated = await prisma.organization.update({
      where: { id },
      data: {
        ...(status !== undefined ? { status } : {}),
        ...(maxRequestsPerSecond !== undefined ? { maxRequestsPerSecond: computedRps } : {}),
        rateLimitPerMinute: computedRpm,
      },
    });

    clearSessionCache();

    return NextResponse.json<ApiResponse<typeof updated>>(
      {
        success: true,
        data: updated,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("PATCH /api/admin/companies/[id] error:", error);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to update company.",
        },
      },
      { status: 500 }
    );
  }
}
