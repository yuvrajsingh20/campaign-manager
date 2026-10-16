import { NextRequest, NextResponse } from "next/server";
import { extractSessionToken, deleteSession, clearSessionCookie } from "@/lib/auth";
import { ApiResponse } from "@/types";


export async function POST(req: NextRequest) {
  try {
    const token = extractSessionToken(req);
    if (token) {
      await deleteSession(token);
    }

    const response = NextResponse.json<ApiResponse>(
      {
        success: true,
        data: { message: "Logged out successfully." },
      },
      { status: 200 }
    );

    clearSessionCookie(response);
    return response;
  } catch (error) {
    console.error("POST /api/auth/logout error:", error);
    const response = NextResponse.json<ApiResponse>(
      {
        success: true,
        data: { message: "Logged out." },
      },
      { status: 200 }
    );
    clearSessionCookie(response);
    return response;
  }
}
