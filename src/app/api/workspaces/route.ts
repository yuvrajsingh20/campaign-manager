import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isPrerenderInterrupted } from "@/lib/auth";
import { Role } from "@prisma/client";
import { ApiResponse } from "@/types";


/**
 * GET /api/workspaces
 * Lists workspaces scoped to authenticated tenant with organization details.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const where = user.role === Role.SUPERADMIN
      ? undefined
      : { organizationId: user.organizationId || "__none__" };

    const workspaces = await prisma.workspace.findMany({
      where,
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
            maxRequestsPerSecond: true,
            rateLimitPerMinute: true,
          },
        },
        _count: {
          select: { campaigns: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json<ApiResponse<typeof workspaces>>({
      success: true,
      data: workspaces,
    });
  } catch (error) {
    if (isPrerenderInterrupted(error)) throw error;
    console.error("GET /api/workspaces error:", error);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "Failed to fetch workspaces",
        },
      },
      { status: 500 }
    );
  }
}
