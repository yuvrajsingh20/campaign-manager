import { Queue } from "bullmq";
import { redis } from "./redis";

export const OUTBOUND_CALL_QUEUE_NAME = "outbound-calls";

export interface OutboundCallJobData {
  campaignId: string;
  contactId: string;
  phoneNumber: string;
  attemptNumber: number;
  sarvamAgentId?: string;
  customVariables?: Record<string, unknown>;
}

const globalForQueue = globalThis as unknown as {
  outboundCallQueue: Queue<OutboundCallJobData> | undefined;
};

export const getOutboundCallQueue = (): Queue<OutboundCallJobData> => {
  if (!globalForQueue.outboundCallQueue) {
    globalForQueue.outboundCallQueue = new Queue<OutboundCallJobData>(
      OUTBOUND_CALL_QUEUE_NAME,
      {
        connection: redis,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 5000,
          },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      }
    );
  }
  return globalForQueue.outboundCallQueue;
};
