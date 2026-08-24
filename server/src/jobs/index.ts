import type { Worker } from "bullmq";
import { logger } from "../lib/logger";
import { maintenanceQueue, scheduleMaintenanceJobs } from "./maintenance.queue";
import { createMaintenanceWorker } from "./maintenance.worker";

let worker: Worker | undefined;

export async function startJobSystem(): Promise<void> {
  await scheduleMaintenanceJobs();
  worker = createMaintenanceWorker();
  logger.info("Background job system started");
}

export async function stopJobSystem(): Promise<void> {
  await worker?.close();
  await maintenanceQueue.close();
}

export { maintenanceQueue };
