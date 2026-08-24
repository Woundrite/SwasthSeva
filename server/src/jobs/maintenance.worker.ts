import { Worker, type Job } from "bullmq";
import { generatePreVisitSummary } from "../ai/pre-visit-summary";
import { syncCalendarEvents } from "../calendar/calendar-sync";
import { GoogleCalendarClient } from "../calendar/calendar-client";
import { persistRefreshedAccessToken } from "../calendar/google-account.service";
import { logger } from "../lib/logger";
import { redis } from "../lib/redis";
import { MAINTENANCE_QUEUE_NAME, MaintenanceJob } from "./maintenance.queue";
import {
  cleanupExpiredRefreshTokens,
  drainEmailOutbox,
  reconcileStaleAppointments,
  reconcileStuckAiSummaries,
  sweepExpiredSlotHolds,
} from "./maintenance.processors";

const googleCalendarClient = new GoogleCalendarClient(persistRefreshedAccessToken);

async function processMaintenanceJob(job: Job): Promise<number> {
  switch (job.name) {
    case MaintenanceJob.SWEEP_EXPIRED_SLOT_HOLDS:
      return sweepExpiredSlotHolds();
    case MaintenanceJob.CLEANUP_EXPIRED_REFRESH_TOKENS:
      return cleanupExpiredRefreshTokens();
    case MaintenanceJob.RECONCILE_STALE_APPOINTMENTS:
      return reconcileStaleAppointments();
    case MaintenanceJob.DRAIN_EMAIL_OUTBOX:
      return drainEmailOutbox();
    case MaintenanceJob.RECONCILE_STUCK_AI_SUMMARIES:
      return reconcileStuckAiSummaries();
    case MaintenanceJob.GENERATE_PRE_VISIT_SUMMARY:
      await generatePreVisitSummary((job.data as { appointmentId: string }).appointmentId);
      return 1;
    case MaintenanceJob.SYNC_CALENDAR_EVENTS:
      return syncCalendarEvents(googleCalendarClient);
    default:
      throw new Error(`Unknown maintenance job: ${job.name}`);
  }
}

export function createMaintenanceWorker(): Worker {
  const worker = new Worker(MAINTENANCE_QUEUE_NAME, processMaintenanceJob, { connection: redis });

  worker.on("completed", (job, result: number) => {
    if (result > 0) {
      logger.info({ job: job.name, affected: result }, "maintenance job completed");
    }
  });
  worker.on("failed", (job, err) => {
    logger.error({ job: job?.name, err }, "maintenance job failed");
  });

  return worker;
}
