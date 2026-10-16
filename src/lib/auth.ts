import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "./prisma";
import { Role } from "@prisma/client";
import { AuthUser, ApiResponse } from "@/types";

export const SESSION_COOKIE_NAME = "session_token";
export const SESSION_EXPIRY_DAYS = 7;

interface CachedSession {
  user: AuthUser;
  cachedAt: number;
}
const sessionCache = new Map<string, CachedSession>();
const SESSION_CACHE_TTL_MS = 5000;

export function clearSessionCache(): void {
  sessionCache.clear();
}

/**
 * Hash a plaintext password using standard scrypt key derivation.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString("hex")}`;
}

/**
 * Timing-safe password verification.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    const [salt, key] = storedHash.split(":");
    if (!salt || !key) return false;
    const keyBuffer = Buffer.from(key, "hex");
    const derivedKey = scryptSync(password, salt, 64);
    return timingSafeEqual(keyBuffer, derivedKey);
  } catch {
    return false;
  }
}

/**
 * Generate a cryptographically random, secure temporary password for onboarded owners.
 */
export function generateTemporaryPassword(): string {
  // Generates a 12-character cryptographically secure temporary password (alphanumeric + symbols)
  const bytes = randomBytes(9);
  return bytes.toString("base64url");
}

/**
 * Create a new database-backed session for a user.
 */
export async function createSession(userId: string): Promise<{ sessionToken: string; expiresAt: Date }> {
  const sessionToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  await prisma.session.create({
    data: {
      userId,
      sessionToken,
      expiresAt,
    },
  });

  return { sessionToken, expiresAt };
}

/**
 * Delete a session from the database (logout).
 */
export async function deleteSession(sessionToken: string): Promise<void> {
  sessionCache.delete(sessionToken);
  await prisma.session.deleteMany({
    where: { sessionToken },
  });
}

/**
 * Set session HTTP-only cookie on response.
 */
export function setSessionCookie(response: NextResponse, sessionToken: string, expiresAt: Date): void {
  response.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/**
 * Clear session cookie on response.
 */
export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export function isPrerenderInterrupted(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === "object" &&
      "digest" in err &&
      (err as { digest: string }).digest === "NEXT_PRERENDER_INTERRUPTED"
  );
}

/**
 * Extract session token from NextRequest cookie or Authorization Bearer header.
 */
export function extractSessionToken(req: NextRequest): string | null {
  try {
    const cookieVal = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (cookieVal) return cookieVal;
  } catch (err: unknown) {
    if (isPrerenderInterrupted(err)) {
      throw err;
    }
  }

  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.substring(7).trim();
  }

  // Fallback: raw cookie header parsing if NextRequest cookies collection was empty
  const rawCookie = req.headers.get("cookie");
  if (rawCookie) {
    const match = rawCookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`));
    if (match) return match[1];
  }

  return null;
}

/**
 * Authoritatively resolve current authenticated user from database session.
 */
export async function getCurrentUser(req: NextRequest): Promise<AuthUser | null> {
  const token = extractSessionToken(req);
  if (!token) return null;

  const cached = sessionCache.get(token);
  if (cached && Date.now() - cached.cachedAt < SESSION_CACHE_TTL_MS) {
    return cached.user;
  }

  const session = await prisma.session.findUnique({
    where: { sessionToken: token },
    include: {
      user: {
        include: {
          organization: true,
        },
      },
    },
  });

  if (!session) {
    sessionCache.delete(token);
    return null;
  }

  // Expired session check
  if (session.expiresAt < new Date()) {
    sessionCache.delete(token);
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  const { user } = session;
  const authUser: AuthUser = {
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

  sessionCache.set(token, { user: authUser, cachedAt: Date.now() });
  return authUser;
}

/**
 * Result returned by route auth guards.
 */
export type AuthResult =
  | { user: AuthUser; errorResponse?: never }
  | { user?: never; errorResponse: NextResponse<ApiResponse> };

/**
 * Route guard: Requires any authenticated user.
 */
export async function requireAuth(req: NextRequest): Promise<AuthResult> {
  const user = await getCurrentUser(req);
  if (!user) {
    return {
      errorResponse: NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Authentication required. Please log in.",
          },
        },
        { status: 401 }
      ),
    };
  }

  return { user };
}

/**
 * Route guard: Requires SUPERADMIN role.
 */
export async function requireSuperadmin(req: NextRequest): Promise<AuthResult> {
  const authRes = await requireAuth(req);
  if (authRes.errorResponse) return authRes;

  if (authRes.user.role !== Role.SUPERADMIN) {
    return {
      errorResponse: NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "Superadmin access required for this action.",
          },
        },
        { status: 403 }
      ),
    };
  }

  return { user: authRes.user };
}

/**
 * Check if a user is permitted to access a specific organization's data.
 * SUPERADMIN has global access; other roles must belong to the specified organization.
 */
export function canAccessOrganization(user: AuthUser, organizationId: string): boolean {
  if (user.role === Role.SUPERADMIN) return true;
  return user.organizationId === organizationId;
}

/**
 * OWNER, ADMIN, and SUPERADMIN may change campaigns and workspaces.
 * MEMBER is limited to read access inside their organisation.
 */
export function requireCampaignOperator(user: AuthUser): NextResponse<ApiResponse> | null {
  if (user.role === Role.MEMBER) {
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Members can view campaigns but cannot create or change them.",
        },
      },
      { status: 403 }
    );
  }
  return null;
}
