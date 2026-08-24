import { DateTime } from "luxon";

export interface WorkingHourBlock {
  dayOfWeek: number; // 0 = Sunday ... 6 = Saturday, matching the schema
  startMinute: number;
  endMinute: number;
}

export interface BusyInterval {
  start: Date;
  end: Date;
}

export interface Slot {
  startsAt: Date;
  endsAt: Date;
}

export interface GenerateDailySlotsParams {
  date: string; // YYYY-MM-DD, interpreted in clinicTimezone
  clinicTimezone: string;
  workingHours: WorkingHourBlock[];
  slotDurationMinutes: number;
  bufferMinutes: number;
  busy: BusyInterval[];
  now: Date;
  minBookingNoticeMinutes: number;
}

// Working hours are stored as local minutes-from-midnight so a doctor's 9am is
// always 9am regardless of DST; we re-anchor to midnight of the requested date
// in the clinic's zone on every call, so each date picks up its own UTC offset.
export function generateDailySlots(params: GenerateDailySlotsParams): Slot[] {
  const {
    date,
    clinicTimezone,
    workingHours,
    slotDurationMinutes,
    bufferMinutes,
    busy,
    now,
    minBookingNoticeMinutes,
  } = params;

  const dayStart = DateTime.fromISO(date, { zone: clinicTimezone });
  if (!dayStart.isValid) {
    return [];
  }

  const dayOfWeek = dayStart.weekday % 7; // Luxon: Mon=1..Sun=7 -> schema: Sun=0..Sat=6
  const blocks = workingHours.filter((block) => block.dayOfWeek === dayOfWeek);
  const step = slotDurationMinutes + bufferMinutes;
  const earliestBookableMs = now.getTime() + minBookingNoticeMinutes * 60_000;

  const slots: Slot[] = [];

  for (const block of blocks) {
    for (let minute = block.startMinute; minute + slotDurationMinutes <= block.endMinute; minute += step) {
      const startsAt = dayStart.plus({ minutes: minute });
      const endsAt = startsAt.plus({ minutes: slotDurationMinutes });

      if (startsAt.toMillis() < earliestBookableMs) {
        continue;
      }

      const overlapsBusy = busy.some(
        (interval) => startsAt.toMillis() < interval.end.getTime() && endsAt.toMillis() > interval.start.getTime(),
      );
      if (overlapsBusy) {
        continue;
      }

      slots.push({ startsAt: startsAt.toJSDate(), endsAt: endsAt.toJSDate() });
    }
  }

  return slots;
}

export function isWithinBookingHorizon(date: string, clinicTimezone: string, now: Date, horizonDays: number): boolean {
  const day = DateTime.fromISO(date, { zone: clinicTimezone });
  if (!day.isValid) {
    return false;
  }
  const today = DateTime.fromJSDate(now, { zone: clinicTimezone }).startOf("day");
  const diffDays = day.startOf("day").diff(today, "days").days;
  return diffDays >= 0 && diffDays <= horizonDays;
}
