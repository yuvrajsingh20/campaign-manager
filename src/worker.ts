import { Worker, Job } from "bullmq";
import { redis } from "./lib/redis";
import { OUTBOUND_CALL_QUEUE_NAME, OutboundCallJobData } from "./lib/queue";
import { processOutboundCallJob, recoverStaleContacts } from "./lib/execution-engine";

console.log(`[Worker] Starting Campaign Manager Outbound Voice Worker...`);
console.log(`[Worker] Connected to queue: ${OUTBOUND_CALL_QUEUE_NAME}`);

// Periodic stale job recovery (every 60 seconds)
const recoveryInterval = setInterval(async () => {
  try {
    const recovered = await recoverStaleContacts(5 * 60 * 1000);
    if (recovered > 0) {
      console.log(`[Worker] Recovered ${recovered} stale IN_PROGRESS contacts.`);
    }
  } catch (err) {
    console.error("[Worker] Error during stale contact recovery:", err);
  }
}, 60000);

// Run initial recovery sweep on startup
recoverStaleContacts(5 * 60 * 1000).catch((err) =>
  console.error("[Worker] Initial stale contact recovery error:", err)
);

export const worker = new Worker<OutboundCallJobData>(
  OUTBOUND_CALL_QUEUE_NAME,
  async (job: Job<OutboundCallJobData>) => {
    const { campaignId, contactId, attemptNumber } = job.data;
    console.log(
      `[Worker] Processing job ${job.id} -> Campaign: ${campaignId}, Contact: ${contactId}, Attempt: ${attemptNumber}`
    );

    const result = await processOutboundCallJob(job.data);
    console.log(`[Worker] Job ${job.id} outcome: ${result.status} ${result.reason ? `(${result.reason})` : ""}`);
    return result;
  },
  {
    connection: redis,
    concurrency: 10,
    lockDuration: 30000,
  }
);

worker.on("completed", (job) => {
  console.log(`[Worker] Job ${job.id} completed successfully`);
});

worker.on("failed", (job, err) => {
  console.error(`[Worker] Job ${job?.id} failed with error:`, err.message);
});

worker.on("error", (err) => {
  console.error(`[Worker] Redis / Worker error:`, err);
});

// Graceful shutdown handling
const handleShutdown = async (signal: string) => {
  console.log(`[Worker] Received ${signal}. Shutting down gracefully...`);
  clearInterval(recoveryInterval);
  try {
    await worker.close();
    console.log(`[Worker] Worker closed cleanly.`);
    process.exit(0);
  } catch (error) {
    console.error(`[Worker] Error during worker shutdown:`, error);
    process.exit(1);
  }
};

process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));


