import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { prisma } from "@/lib/prisma";
import { ApiResponse } from "@/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/campaigns/[id]/contacts/sample
 * Generates and downloads a sample CSV cohort template tailored to the campaign's configuration.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id: campaignId } = await params;

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true,
        name: true,
        requiredVariables: true,
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

    // Core headers
    const headers = ["lead_id", "phone_number", "first_name", "last_name"];

    // Append campaign's agent-specific required variables
    const requiredVars = campaign.requiredVariables || [];
    for (const v of requiredVars) {
      if (!headers.includes(v)) {
        headers.push(v);
      }
    }

    // Generate fictional placeholder rows
    const sampleRows = [
      {
        lead_id: "lead_001",
        phone_number: "+919876543210",
        first_name: "Aarav",
        last_name: "Sharma",
        ...Object.fromEntries(requiredVars.map((v) => [v, `sample_${v}_val`])),
      },
      {
        lead_id: "lead_002",
        phone_number: "+14155552671",
        first_name: "Emily",
        last_name: "Watson",
        ...Object.fromEntries(requiredVars.map((v) => [v, `sample_${v}_val`])),
      },
    ];

    const csvContent = Papa.unparse({
      fields: headers,
      data: sampleRows,
    });

    const safeName = campaign.name
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "_")
      .slice(0, 30);
    const filename = `cohort_template_${safeName}.csv`;

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("GET /api/campaigns/[id]/contacts/sample error:", error);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "Failed to generate sample CSV",
        },
      },
      { status: 500 }
    );
  }
}

