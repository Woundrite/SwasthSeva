import { generatePreVisitSummary } from "../ai/pre-visit-summary";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { sendMail } from "../lib/mailer";
import { prisma } from "../lib/prisma";
import { renderEmail } from "../notifications/email-templates";
import { AppointmentStatus, HoldStatus, OutboxStatus, SummaryKind, SummaryStatus } from "../generated/prisma/client";

// Two patients can never hold the same slot at once because ACTIVE holds are
// covered by a GiST exclusion constraint; this sweep is what actually frees
// an abandoned hold once its TTL passes, exactly as described in the
// booking-integrity migration's comments ("moved out of ACTIVE ... by the
// sweeper job"). No booking flow currently creates SlotHold rows, so this is
// a no-op today, but it's cheap, correct, and ready for when one does.
export async function sweepExpiredSlotHolds(now: Date = new Date()): Promise<number> {
  const result = await prisma.slotHold.updateMany({
    where: { status: HoldStatus.ACTIVE, expiresAt: { lt: now } },
    data: { status: HoldStatus.EXPIRED, releasedAt: now },
  });
  return result.count;
}

// Pure hygiene: refresh tokens that are long expired, or were revoked a
// while ago (rotated out, logged out, or caught by reuse detection), have no
// further security or audit value. A short retention window after the fact
// keeps recently-revoked tokens around briefly in case they're useful for
// debugging a live incident.
const REFRESH_TOKEN_RETENTION_DAYS = 7;

export async function cleanupExpiredRefreshTokens(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - REFRESH_TOKEN_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await prisma.refreshToken.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }],
    },
  });
  return result.count;
}

// An appointment left SCHEDULED long after it ended usually just means
// nobody closed it out. This is a judgment call, not a fact the system can
// verify — a generous grace period (well past any realistic delay in a
// doctor completing their notes) is used so this only catches appointments
// that were genuinely never resolved, not ones a doctor simply hasn't
// documented yet.
const STALE_APPOINTMENT_GRACE_HOURS = 48;

export async function reconcileStaleAppointments(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_APPOINTMENT_GRACE_HOURS * 60 * 60 * 1000);
  const result = await prisma.appointment.updateMany({
    where: { status: AppointmentStatus.SCHEDULED, endsAt: { lt: cutoff } },
    data: { status: AppointmentStatus.NO_SHOW },
  });
  return result.count;
}

// Transactional-outbox drain: business code only ever writes PENDING rows
// (see notifications/outbox.ts); this is the sole place that actually talks
// to SMTP, on a short interval so confirmation/cancellation email feels
// close to instant without needing a push trigger from the request path.
const OUTBOX_BATCH_SIZE = 20;
const OUTBOX_BACKOFF_BASE_MS = 30_000;
const OUTBOX_BACKOFF_MAX_MS = 30 * 60_000;

function nextBackoff(attempts: number): Date {
  const delay = Math.min(OUTBOX_BACKOFF_BASE_MS * 2 ** (attempts - 1), OUTBOX_BACKOFF_MAX_MS);
  return new Date(Date.now() + delay);
}

export async function drainEmailOutbox(now: Date = new Date()): Promise<number> {
  const due = await prisma.emailOutbox.findMany({
    where: { status: OutboxStatus.PENDING, nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: "asc" },
    take: OUTBOX_BATCH_SIZE,
  });

  let sentCount = 0;

  for (const row of due) {
    // Claim it first so two concurrent drains (e.g. inline worker + a
    // dedicated worker process both running) can't send the same email twice.
    const claimed = await prisma.emailOutbox.updateMany({
      where: { id: row.id, status: OutboxStatus.PENDING },
      data: { status: OutboxStatus.SENDING },
    });
    if (claimed.count === 0) {
      continue;
    }

    try {
      const rendered = renderEmail(row.template, row.payload);
      const { messageId } = await sendMail({ toEmail: row.toEmail, toName: row.toName, ...rendered });
      await prisma.emailOutbox.update({
        where: { id: row.id },
        data: {
          status: OutboxStatus.SENT,
          sentAt: new Date(),
          providerMessageId: messageId,
          attempts: { increment: 1 },
        },
      });
      sentCount++;
    } catch (err) {
      const attempts = row.attempts + 1;
      const isDead = attempts >= row.maxAttempts;
      logger.error({ err, outboxId: row.id, attempts, isDead }, "email delivery failed");
      await prisma.emailOutbox.update({
        where: { id: row.id },
        data: {
          status: isDead ? OutboxStatus.DEAD : OutboxStatus.PENDING,
          attempts,
          lastError: err instanceof Error ? err.message : String(err),
          nextAttemptAt: isDead ? row.nextAttemptAt : nextBackoff(attempts),
        },
      });
    }
  }

  return sentCount;
}

// Backstop for pre-visit summary generation: the normal path is an
// immediate one-off job enqueued right when symptom intake is submitted, but
// a row can be left PENDING if that enqueue is lost (e.g. a crash between
// the DB commit and the Redis write). This sweep retries anything stuck for
// a few minutes, and gives up (DEAD-equivalent: FAILED) once attempts are
// exhausted rather than retrying forever.
const STUCK_SUMMARY_AGE_MINUTES = 5;

export async function reconcileStuckAiSummaries(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STUCK_SUMMARY_AGE_MINUTES * 60_000);
  const stuck = await prisma.aiSummary.findMany({
    where: { kind: SummaryKind.PRE_VISIT, status: SummaryStatus.PENDING, updatedAt: { lt: cutoff } },
    select: { appointmentId: true, attempts: true },
  });

  let processed = 0;
  for (const row of stuck) {
    if (row.attempts >= env.LLM_MAX_ATTEMPTS) {
      await prisma.aiSummary.updateMany({
        where: { appointmentId: row.appointmentId, kind: SummaryKind.PRE_VISIT, status: SummaryStatus.PENDING },
        data: { status: SummaryStatus.FAILED, error: "Exceeded maximum generation attempts" },
      });
    } else {
      await generatePreVisitSummary(row.appointmentId);
    }
    processed++;
  }
  return processed;
}
