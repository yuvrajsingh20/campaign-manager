import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword, createSession, setSessionCookie } from "@/lib/auth";
import { ApiResponse, AuthUser } from "@/types";


export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Email and password are required.",
          },
        },
        { status: 400 }
      );
    }

    const { email, password } = body as { email?: unknown; password?: unknown };

    if (!email || typeof email !== "string" || !email.trim()) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "A valid email address is required.",
          },
        },
        { status: 400 }
      );
    }

    if (!password || typeof password !== "string") {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Password is required.",
          },
        },
        { status: 400 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Look up user with organization
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        organization: true,
      },
    });

    if (!user || !user.passwordHash) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "INVALID_CREDENTIALS",
            message: "Invalid email or password.",
          },
        },
        { status: 401 }
      );
    }

    const isValid = verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "INVALID_CREDENTIALS",
            message: "Invalid email or password.",
          },
        },
        { status: 401 }
      );
    }

    // Create session in database
    const { sessionToken, expiresAt } = await createSession(user.id);

    const authUserData: AuthUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organizationId: user.organizationId,
      organization: user.organization
        ? {
            id: user.organization.id,
            name: user.organization.name,
            slug: user.organization.slug,
            status: user.organization.status,
            rateLimitPerMinute: user.organization.rateLimitPerMinute,
            maxRequestsPerSecond: user.organization.maxRequestsPerSecond,
          }
        : null,
    };

    const response = NextResponse.json<ApiResponse<{ user: AuthUser }>>(
      {
        success: true,
        data: { user: authUserData },
      },
      { status: 200 }
    );

    // Set secure HTTP-only cookie
    setSessionCookie(response, sessionToken, expiresAt);

    return response;
  } catch (error) {
    console.error("POST /api/auth/login error:", error);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? `${error.message}` : "An unexpected error occurred during login.",
        },
      },
      { status: 500 }
    );
  }
}
