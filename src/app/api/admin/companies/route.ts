import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperadmin, hashPassword, generateTemporaryPassword, isPrerenderInterrupted } from "@/lib/auth";
import { Role, OrganizationStatus } from "@prisma/client";
import { ApiResponse } from "@/types";
import { z } from "zod";


const onboardCompanySchema = z.object({
  name: z.string().min(2, "Company name must be at least 2 characters"),
  ownerName: z.string().min(1, "Owner name is required"),
  ownerEmail: z.string().email("Valid owner email address is required"),
  maxRequestsPerSecond: z.coerce.number().min(0.1, "RPS limit must be greater than 0").default(5.0),
  ownerPassword: z.string().min(6, "Password must be at least 6 characters").optional(),
});

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/**
 * GET /api/admin/companies
 * Lists all onboarded companies with user/workspace/campaign counts and configured RPS.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireSuperadmin(req);
    if (auth.errorResponse) return auth.errorResponse;

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search")?.trim();

    const companies = await prisma.organization.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { slug: { contains: search, mode: "insensitive" } },
            ],
          }
        : undefined,
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: {
            users: true,
            workspaces: true,
            campaigns: true,
          },
        },
        users: {
          where: { role: Role.OWNER },
          select: {
            id: true,
            email: true,
            name: true,
          },
          take: 1,
        },
      },
    });

    return NextResponse.json<ApiResponse<typeof companies>>(
      {
        success: true,
        data: companies,
      },
      { status: 200 }
    );
  } catch (error) {
    if (isPrerenderInterrupted(error)) throw error;
    console.error("GET /api/admin/companies error:", error);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to fetch companies.",
        },
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/companies
 * Onboards a new company transactionally: creates Organization, default Workspace, and OWNER User.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireSuperadmin(req);
    if (auth.errorResponse) return auth.errorResponse;

    const body = await req.json().catch(() => null);
    const parseResult = onboardCompanySchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid onboarding parameters.",
            details: parseResult.error.flatten(),
          },
        },
        { status: 400 }
      );
    }

    const { name, ownerName, ownerEmail, maxRequestsPerSecond, ownerPassword } = parseResult.data;
    const normalizedEmail = ownerEmail.trim().toLowerCase();

    // Guard: Do not allow using Superadmin email as company owner
    const superadminEmail = (process.env.SUPERADMIN_EMAIL || "voiceagent@yopmail.com").toLowerCase();
    if (normalizedEmail === superadminEmail) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "INVALID_OWNER_EMAIL",
            message: "The designated Superadmin email cannot be used as a company owner.",
          },
        },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "DUPLICATE_USER",
            message: `A user with email '${normalizedEmail}' already exists. Please use a unique owner email.`,
          },
        },
        { status: 409 }
      );
    }

    // Compute unique slug
    const baseSlug = generateSlug(name) || "company";
    let uniqueSlug = baseSlug;
    let counter = 1;
    while (await prisma.organization.findUnique({ where: { slug: uniqueSlug } })) {
      uniqueSlug = `${baseSlug}-${counter++}`;
    }

    // Temporary or custom password
    const tempPassword = ownerPassword || generateTemporaryPassword();
    const passwordHash = hashPassword(tempPassword);
    const rateLimitPerMinute = Math.max(1, Math.round(maxRequestsPerSecond * 60));

    // Transactional creation: Organization + default Workspace + OWNER User
    const result = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: name.trim(),
          slug: uniqueSlug,
          status: OrganizationStatus.ACTIVE,
          maxRequestsPerSecond,
          rateLimitPerMinute,
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          name: "Default Workspace",
          slug: "default",
          organizationId: organization.id,
        },
      });

      const owner = await tx.user.create({
        data: {
          email: normalizedEmail,
          name: ownerName.trim(),
          role: Role.OWNER,
          organizationId: organization.id,
          passwordHash,
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          createdAt: true,
        },
      });

      return {
        organization,
        workspace,
        owner,
      };
    });

    return NextResponse.json<
      ApiResponse<{
        organization: typeof result.organization;
        workspace: typeof result.workspace;
        owner: typeof result.owner;
        temporaryPassword: string;
      }>
    >(
      {
        success: true,
        data: {
          organization: result.organization,
          workspace: result.workspace,
          owner: result.owner,
          temporaryPassword: tempPassword,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/admin/companies error:", error);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "Failed to onboard company.",
        },
      },
      { status: 500 }
    );
  }
}
