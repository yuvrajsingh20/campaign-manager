import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiResponse } from "@/types";

/**
 * GET /api/workspaces
 * Lists workspaces with organization details for campaign assignment.
 */
export async function GET() {
  try {
    const workspaces = await prisma.workspace.findMany({
      include: {
        organization: {
          select: { id: true, name: true, slug: true, rateLimitPerMinute: true },
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

