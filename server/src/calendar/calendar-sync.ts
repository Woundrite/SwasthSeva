import type { CalendarClient } from "./calendar-client";
import { getDecryptedCredentials } from "./google-account.service";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { AppointmentStatus, CalendarSyncStatus, Role, type Prisma } from "../generated/prisma/client";

const SYNC_BATCH_SIZE = 20;
const CALENDAR_MAX_ATTEMPTS = 5;

const DUE_ROW_INCLUDE = {
  appointment: {
    include: {
      doctor: { select: { specialisation: true, clinicTimezone: true, user: { select: { fullName: true } } } },
      patient: { select: { fullName: true, timezone: true } },
    },
  },
  user: { select: { role: true } },
} satisfies Prisma.CalendarEventInclude;

type DueCalendarEvent = Prisma.CalendarEventGetPayload<{ include: typeof DUE_ROW_INCLUDE }>;

// CalendarSyncStatus has no intermediate "claiming" state the way OutboxStatus
// has SENDING, so this can't atomically claim a row before processing it the
// way drainEmailOutbox does. In the normal single-worker deployment this
// project uses that's not observable; it would only matter if two worker
// processes were consuming the same queue at once, in which case both could
// pick up the same row and (harmlessly, since Google dedupes by request
// idempotency in most SDKs, but not guaranteed) create a duplicate event.
// Documented rather than fixed with an unrequested schema change.
export async function syncCalendarEvents(client: CalendarClient, now: Date = new Date()): Promise<number> {
  const due = await prisma.calendarEvent.findMany({
    where: { syncStatus: CalendarSyncStatus.PENDING },
    take: SYNC_BATCH_SIZE,
    orderBy: { updatedAt: "asc" },
    include: DUE_ROW_INCLUDE,
  });

  let processed = 0;
  for (const row of due) {
    await processOne(client, row, now);
    processed++;
  }
  return processed;
}

async function processOne(client: CalendarClient, row: DueCalendarEvent, now: Date): Promise<void> {
  const credentials = await getDecryptedCredentials(row.userId);
  if (!credentials) {
    await prisma.calendarEvent.update({
      where: { id: row.id },
      data: { syncStatus: CalendarSyncStatus.DISCONNECTED },
    });
    return;
  }

  const isDoctor = row.user.role === Role.DOCTOR;
  const timezone = isDoctor ? row.appointment.doctor.clinicTimezone : row.appointment.patient.timezone;
  const counterpartName = isDoctor ? row.appointment.patient.fullName : row.appointment.doctor.user.fullName;
  const eventInput = {
    calendarId: row.calendarId,
    googleEventId: row.googleEventId,
    summary: `Appointment with ${counterpartName}`,
    description: [row.appointment.doctor.specialisation, row.appointment.reasonForVisit].filter(Boolean).join(" — "),
    startsAt: row.appointment.startsAt,
    endsAt: row.appointment.endsAt,
    timezone,
  };

  try {
    if (row.appointment.status === AppointmentStatus.CANCELLED) {
      if (row.googleEventId) {
        await client.deleteEvent(credentials, row.calendarId, row.googleEventId);
      }
      await prisma.calendarEvent.update({
        where: { id: row.id },
        data: { syncStatus: CalendarSyncStatus.DELETED, syncedAt: now, attempts: { increment: 1 }, lastError: null },
      });
      return;
    }

    if (row.googleEventId) {
      await client.updateEvent(credentials, eventInput);
      await prisma.calendarEvent.update({
        where: { id: row.id },
        data: { syncStatus: CalendarSyncStatus.SYNCED, syncedAt: now, attempts: { increment: 1 }, lastError: null },
      });
    } else {
      const googleEventId = await client.createEvent(credentials, eventInput);
      await prisma.calendarEvent.update({
        where: { id: row.id },
        data: {
          syncStatus: CalendarSyncStatus.SYNCED,
          googleEventId,
          syncedAt: now,
          attempts: { increment: 1 },
          lastError: null,
        },
      });
    }
  } catch (err) {
    const attempts = row.attempts + 1;
    const isDead = attempts >= CALENDAR_MAX_ATTEMPTS;
    logger.error({ err, calendarEventId: row.id, attempts, isDead }, "calendar sync failed");
    await prisma.calendarEvent.update({
      where: { id: row.id },
      data: {
        syncStatus: isDead ? CalendarSyncStatus.FAILED : CalendarSyncStatus.PENDING,
        attempts,
        lastError: err instanceof Error ? err.message : String(err),
      },
    });
  }
}
