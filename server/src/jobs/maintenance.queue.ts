import { Queue } from "bullmq";
import { redis } from "../lib/redis";

export const MAINTENANCE_QUEUE_NAME = "maintenance";

export const MaintenanceJob = {
  SWEEP_EXPIRED_SLOT_HOLDS: "sweep-expired-slot-holds",
  CLEANUP_EXPIRED_REFRESH_TOKENS: "cleanup-expired-refresh-tokens",
  RECONCILE_STALE_APPOINTMENTS: "reconcile-stale-appointments",
  DRAIN_EMAIL_OUTBOX: "drain-email-outbox",
  GENERATE_PRE_VISIT_SUMMARY: "generate-pre-visit-summary",
  RECONCILE_STUCK_AI_SUMMARIES: "reconcile-stuck-ai-summaries",
  SYNC_CALENDAR_EVENTS: "sync-calendar-events",
} as const;

export type MaintenanceJobName = (typeof MaintenanceJob)[keyof typeof MaintenanceJob];

const FIFTEEN_SECONDS_MS = 15_000;
const TWENTY_SECONDS_MS = 20_000;
const ONE_MINUTE_MS = 60_000;
const FIVE_MINUTES_MS = 5 * ONE_MINUTE_MS;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

export const maintenanceQueue = new Queue(MAINTENANCE_QUEUE_NAME, { connection: redis });

// Registers the repeating schedule for each maintenance job via BullMQ's Job
// Scheduler API. upsertJobScheduler is keyed by the scheduler id, so calling
// this on every process start is idempotent — it updates the existing
// schedule in place rather than creating duplicates.
export async function scheduleMaintenanceJobs(): Promise<void> {
  await Promise.all([
    maintenanceQueue.upsertJobScheduler(
      MaintenanceJob.SWEEP_EXPIRED_SLOT_HOLDS,
      { every: ONE_MINUTE_MS },
      { name: MaintenanceJob.SWEEP_EXPIRED_SLOT_HOLDS, opts: { removeOnComplete: 10, removeOnFail: 50 } },
    ),
    maintenanceQueue.upsertJobScheduler(
      MaintenanceJob.CLEANUP_EXPIRED_REFRESH_TOKENS,
      { every: ONE_DAY_MS },
      { name: MaintenanceJob.CLEANUP_EXPIRED_REFRESH_TOKENS, opts: { removeOnComplete: 10, removeOnFail: 50 } },
    ),
    maintenanceQueue.upsertJobScheduler(
      MaintenanceJob.RECONCILE_STALE_APPOINTMENTS,
      { every: ONE_HOUR_MS },
      { name: MaintenanceJob.RECONCILE_STALE_APPOINTMENTS, opts: { removeOnComplete: 10, removeOnFail: 50 } },
    ),
    maintenanceQueue.upsertJobScheduler(
      MaintenanceJob.DRAIN_EMAIL_OUTBOX,
      { every: FIFTEEN_SECONDS_MS },
      { name: MaintenanceJob.DRAIN_EMAIL_OUTBOX, opts: { removeOnComplete: 10, removeOnFail: 50 } },
    ),
    maintenanceQueue.upsertJobScheduler(
      MaintenanceJob.RECONCILE_STUCK_AI_SUMMARIES,
      { every: FIVE_MINUTES_MS },
      { name: MaintenanceJob.RECONCILE_STUCK_AI_SUMMARIES, opts: { removeOnComplete: 10, removeOnFail: 50 } },
    ),
    maintenanceQueue.upsertJobScheduler(
      MaintenanceJob.SYNC_CALENDAR_EVENTS,
      { every: TWENTY_SECONDS_MS },
      { name: MaintenanceJob.SYNC_CALENDAR_EVENTS, opts: { removeOnComplete: 10, removeOnFail: 50 } },
    ),
  ]);
}

// One-off, immediate dispatch — not part of the repeatable schedule above.
// Triggered right when symptom intake is submitted; the reconcile sweep is
// the backstop if this enqueue is ever lost.
export async function enqueuePreVisitSummaryJob(appointmentId: string): Promise<void> {
  await maintenanceQueue.add(
    MaintenanceJob.GENERATE_PRE_VISIT_SUMMARY,
    { appointmentId },
    { removeOnComplete: 10, removeOnFail: 50 },
  );
}
