import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperadmin, isPrerenderInterrupted } from "@/lib/auth";
import { ApiResponse } from "@/types";


export async function GET(req: NextRequest) {
  try {
    const auth = await requireSuperadmin(req);
    if (auth.errorResponse) return auth.errorResponse;

    const [totalCompanies, totalWorkspaces, totalCampaigns] = await Promise.all([
      prisma.organization.count(),
      prisma.workspace.count(),
      prisma.campaign.count(),
    ]);

    return NextResponse.json<
      ApiResponse<{
        totalCompanies: number;
        totalWorkspaces: number;
        totalCampaigns: number;
      }>
    >(
      {
        success: true,
        data: {
          totalCompanies,
          totalWorkspaces,
          totalCampaigns,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    if (isPrerenderInterrupted(error)) throw error;
    console.error("GET /api/admin/metrics error:", error);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to fetch admin metrics.",
        },
      },
      { status: 500 }
    );
  }
}
