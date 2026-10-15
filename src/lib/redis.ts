import Redis from "ioredis";

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

const getRedisUrl = (): string => {
  return process.env.REDIS_URL || "redis://localhost:6379";
};

export const getRedisClient = (): Redis => {
  if (!globalForRedis.redis) {
    globalForRedis.redis = new Redis(getRedisUrl(), {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });
  }
  return globalForRedis.redis;
};

export const redis = getRedisClient();

export default redis;

