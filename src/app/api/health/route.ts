import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";

export async function GET() {
  let dbStatus = "connected";
  let redisStatus = "connected";
  let isHealthy = true;

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    dbStatus = error instanceof Error ? error.message : "disconnected";
    isHealthy = false;
  }

  try {
    const pong = await redis.ping();
    if (pong !== "PONG") {
      redisStatus = `unexpected: ${pong}`;
      isHealthy = false;
    }
  } catch (error) {
    redisStatus = error instanceof Error ? error.message : "disconnected";
    isHealthy = false;
  }

  const responsePayload = {
    status: isHealthy ? "healthy" : "unhealthy",
    timestamp: new Date().toISOString(),
    service: "campaign-manager",
    version: "0.1.0",
    checks: {
      database: dbStatus,
      redis: redisStatus,
    },
  };

  return NextResponse.json(responsePayload, { status: isHealthy ? 200 : 503 });
}


