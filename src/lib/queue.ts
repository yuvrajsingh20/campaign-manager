import { Queue } from "bullmq";
import { redis } from "./redis";
import { prisma } from "./prisma";

export const OUTBOUND_CALL_QUEUE_NAME = "outbound-calls";

export interface OutboundCallJobData {
  campaignId: string;
  contactId: string;
  attemptNumber: number;
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
          attempts: 2,
          backoff: {
            type: "exponential",
            delay: 3000,
          },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      }
    );
  }
  return globalForQueue.outboundCallQueue;
};

export const outboundCallQueue = getOutboundCallQueue();

/**
 * Enqueues all eligible PENDING contacts for a campaign.
 * Updates contact statuses to QUEUED in PostgreSQL and creates idempotent BullMQ jobs.
 */
export async function enqueueCampaignContacts(campaignId: string): Promise<number> {
  const queue = getOutboundCallQueue();

  const contacts = await prisma.contact.findMany({
    where: {
      campaignId,
      status: "PENDING",
    },
    select: {
      id: true,
      retryCount: true,
    },
  });

  if (contacts.length === 0) {
    return 0;
  }

  // Mark contacts as QUEUED in database
  const contactIds = contacts.map((c) => c.id);
  await prisma.contact.updateMany({
    where: { id: { in: contactIds } },
    data: { status: "QUEUED" },
  });

  // Prepare batch BullMQ jobs with deterministic job IDs
  const jobs = contacts.map((contact) => ({
    name: "dispatch-call",
    data: {
      campaignId,
      contactId: contact.id,
      attemptNumber: contact.retryCount + 1,
    },
    opts: {
      jobId: `job_${campaignId}_${contact.id}_att${contact.retryCount + 1}`,
    },
  }));

  await queue.addBulk(jobs);
  return jobs.length;
}

/**
 * Enqueues a single contact retry attempt with an optional execution delay.
 */
export async function enqueueContactRetry(
  campaignId: string,
  contactId: string,
  attemptNumber: number,
  delayMs = 0
): Promise<void> {
  const queue = getOutboundCallQueue();

  await prisma.contact.update({
    where: { id: contactId },
    data: { status: "QUEUED" },
  });

  await queue.add(
    "dispatch-call",
    {
      campaignId,
      contactId,
      attemptNumber,
    },
    {
      jobId: `job_${campaignId}_${contactId}_att${attemptNumber}_${Date.now()}`,
      delay: Math.max(0, delayMs),
    }
  );
}
