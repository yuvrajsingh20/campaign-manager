import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const getDatabaseUrl = (): string | undefined => {
  if (process.env.NODE_ENV === "test" && process.env.DIRECT_URL) {
    return process.env.DIRECT_URL;
  }
  return process.env.DATABASE_URL;
};

function createPrismaClient() {
  const url = getDatabaseUrl();

  // Only override the datasource when we have a real URL.
  // Passing `{ url: undefined }` throws PrismaClientConstructorValidationError
  // during `next build` (e.g. on Vercel when DATABASE_URL is unset).
  return new PrismaClient({
    ...(url
      ? {
          datasources: {
            db: { url },
          },
        }
      : {}),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
