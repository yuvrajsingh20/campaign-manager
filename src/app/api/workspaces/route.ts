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

/**
 * POST /api/workspaces
 * Creates a new workspace for an organization.
 * SUPERADMIN can specify organizationId; ORG users create workspaces in their own org.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const body = await req.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name || name.length < 2) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Workspace name must be at least 2 characters.",
          },
        },
        { status: 400 }
      );
    }

    const targetOrgId =
      user.role === Role.SUPERADMIN
        ? body?.organizationId || user.organizationId
        : user.organizationId;

    if (!targetOrgId) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "ORGANIZATION_REQUIRED",
            message: "Organization ID is required.",
          },
        },
        { status: 400 }
      );
    }

    // Verify organization exists
    const organization = await prisma.organization.findUnique({
      where: { id: targetOrgId },
    });

    if (!organization) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: `Organization with id '${targetOrgId}' not found.`,
          },
        },
        { status: 404 }
      );
    }

    if (user.role !== Role.SUPERADMIN && organization.status === "INACTIVE") {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "ORGANIZATION_INACTIVE",
            message: "Cannot create workspaces for an inactive organization.",
          },
        },
        { status: 403 }
      );
    }

    // Generate unique slug
    const baseSlug =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "") || "workspace";
    let uniqueSlug = baseSlug;
    let counter = 1;
    while (
      await prisma.workspace.findUnique({
        where: {
          organizationId_slug: { organizationId: targetOrgId, slug: uniqueSlug },
        },
      })
    ) {
      uniqueSlug = `${baseSlug}-${counter++}`;
    }

    const workspace = await prisma.workspace.create({
      data: {
        name,
        slug: uniqueSlug,
        organizationId: targetOrgId,
      },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
            maxRequestsPerSecond: true,
          },
        },
      },
    });

    return NextResponse.json<ApiResponse<typeof workspace>>(
      {
        success: true,
        data: workspace,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/workspaces error:", error);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "Failed to create workspace",
        },
      },
      { status: 500 }
    );
  }
}

