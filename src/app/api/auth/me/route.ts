import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, isPrerenderInterrupted } from "@/lib/auth";
import { ApiResponse, AuthUser } from "@/types";


export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Not authenticated.",
          },
        },
        { status: 401 }
      );
    }

    return NextResponse.json<ApiResponse<{ user: AuthUser }>>(
      {
        success: true,
        data: { user },
      },
      { status: 200 }
    );
  } catch (error) {
    if (isPrerenderInterrupted(error)) throw error;
    console.error("GET /api/auth/me error:", error);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to resolve session.",
        },
      },
      { status: 500 }
    );
  }
}
