import { DateTime } from "luxon";
import { env } from "../../config/env";
import { getPostgresErrorCode, PG_EXCLUSION_VIOLATION } from "../../lib/db-errors";
import { AppError } from "../../lib/http-error";
import { prisma } from "../../lib/prisma";
import { generateDailySlots, isWithinBookingHorizon, type BusyInterval, type Slot } from "../../lib/slots";
import { AppointmentStatus, Role, type DoctorLeave, type DoctorWorkingHour } from "../../generated/prisma/client";
import type { LeaveInput, ReplaceWorkingHoursInput } from "./doctors.schemas";

export interface CallerIdentity {
  sub: string;
  role: Role;
}

export interface PublicDoctor {
  id: string;
  fullName: string;
  specialisation: string;
  qualifications: string | null;
  bio: string | null;
  consultationFee: string | null;
  slotDurationMinutes: number;
  clinicTimezone: string;
}

export interface OwnDoctorProfile {
  id: string;
  specialisation: string;
  qualifications: string | null;
  bio: string | null;
  consultationFee: string | null;
  slotDurationMinutes: number;
  bufferMinutes: number;
  clinicTimezone: string;
  isActive: boolean;
}

// The schedule endpoints below take a doctorId path param (also usable by an
// admin managing someone else's schedule), so a doctor managing their own
// schedule first needs to learn their own DoctorProfile id from their userId.
export async function getOwnDoctorProfile(userId: string): Promise<OwnDoctorProfile> {
  const doctor = await prisma.doctorProfile.findUnique({ where: { userId } });
  if (!doctor) {
    throw new AppError(403, "No doctor profile is associated with this account");
  }
  return {
    id: doctor.id,
    specialisation: doctor.specialisation,
    qualifications: doctor.qualifications,
    bio: doctor.bio,
    consultationFee: doctor.consultationFee?.toString() ?? null,
    slotDurationMinutes: doctor.slotDurationMinutes,
    bufferMinutes: doctor.bufferMinutes,
    clinicTimezone: doctor.clinicTimezone,
    isActive: doctor.isActive,
  };
}

export async function listActiveDoctors(): Promise<PublicDoctor[]> {
  const doctors = await prisma.doctorProfile.findMany({
    where: { isActive: true },
    include: { user: { select: { fullName: true } } },
    orderBy: { user: { fullName: "asc" } },
  });

  return doctors.map((doctor) => ({
    id: doctor.id,
    fullName: doctor.user.fullName,
    specialisation: doctor.specialisation,
    qualifications: doctor.qualifications,
    bio: doctor.bio,
    consultationFee: doctor.consultationFee?.toString() ?? null,
    slotDurationMinutes: doctor.slotDurationMinutes,
    clinicTimezone: doctor.clinicTimezone,
  }));
}

export async function getDoctorAvailability(
  doctorId: string,
  date: string,
): Promise<{ date: string; clinicTimezone: string; slotDurationMinutes: number; slots: Slot[] }> {
  const doctor = await prisma.doctorProfile.findUnique({
    where: { id: doctorId },
    include: { workingHours: true },
  });

  if (!doctor || !doctor.isActive) {
    throw new AppError(404, "Doctor not found");
  }

  const now = new Date();
  if (!isWithinBookingHorizon(date, doctor.clinicTimezone, now, env.BOOKING_HORIZON_DAYS)) {
    throw new AppError(400, "Requested date is not bookable");
  }

  const dayStart = DateTime.fromISO(date, { zone: doctor.clinicTimezone }).startOf("day");
  const dayEnd = dayStart.plus({ days: 1 });

  const [leaves, appointments] = await Promise.all([
    prisma.doctorLeave.findMany({
      where: {
        doctorId,
        startsAt: { lt: dayEnd.toJSDate() },
        endsAt: { gt: dayStart.toJSDate() },
      },
    }),
    prisma.appointment.findMany({
      where: {
        doctorId,
        status: { in: [AppointmentStatus.SCHEDULED, AppointmentStatus.COMPLETED] },
        startsAt: { lt: dayEnd.toJSDate() },
        endsAt: { gt: dayStart.toJSDate() },
      },
    }),
  ]);

  const busy: BusyInterval[] = [
    ...leaves.map((leave) => ({ start: leave.startsAt, end: leave.endsAt })),
    ...appointments.map((appt) => ({ start: appt.startsAt, end: appt.endsAt })),
  ];

  const slots = generateDailySlots({
    date,
    clinicTimezone: doctor.clinicTimezone,
    workingHours: doctor.workingHours,
    slotDurationMinutes: doctor.slotDurationMinutes,
    bufferMinutes: doctor.bufferMinutes,
    busy,
    now,
    minBookingNoticeMinutes: env.MIN_BOOKING_NOTICE_MINUTES,
  });

  return {
    date,
    clinicTimezone: doctor.clinicTimezone,
    slotDurationMinutes: doctor.slotDurationMinutes,
    slots,
  };
}

// Schedule management (working hours, leave) may be done by an admin on the
// doctor's behalf, or by the doctor themselves for their own profile.
async function assertCanManageDoctorSchedule(caller: CallerIdentity, doctorId: string): Promise<void> {
  const doctor = await prisma.doctorProfile.findUnique({ where: { id: doctorId }, select: { userId: true } });
  if (!doctor) {
    throw new AppError(404, "Doctor not found");
  }
  if (caller.role === Role.ADMIN) {
    return;
  }
  if (caller.role === Role.DOCTOR && doctor.userId === caller.sub) {
    return;
  }
  throw new AppError(403, "You do not have permission to manage this doctor's schedule");
}

function hasOverlap(blocks: { dayOfWeek: number; startMinute: number; endMinute: number }[]): boolean {
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i]!;
      const b = blocks[j]!;
      if (a.dayOfWeek === b.dayOfWeek && a.startMinute < b.endMinute && b.startMinute < a.endMinute) {
        return true;
      }
    }
  }
  return false;
}

export async function listWorkingHours(caller: CallerIdentity, doctorId: string): Promise<DoctorWorkingHour[]> {
  await assertCanManageDoctorSchedule(caller, doctorId);
  return prisma.doctorWorkingHour.findMany({
    where: { doctorId },
    orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
  });
}

export async function replaceWorkingHours(
  caller: CallerIdentity,
  doctorId: string,
  input: ReplaceWorkingHoursInput,
): Promise<DoctorWorkingHour[]> {
  await assertCanManageDoctorSchedule(caller, doctorId);

  if (hasOverlap(input.workingHours)) {
    throw new AppError(400, "Working hour blocks must not overlap on the same day");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.doctorWorkingHour.deleteMany({ where: { doctorId } });
      await tx.doctorWorkingHour.createMany({
        data: input.workingHours.map((block) => ({ doctorId, ...block })),
      });
      return tx.doctorWorkingHour.findMany({
        where: { doctorId },
        orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
      });
    });
  } catch (err) {
    if (getPostgresErrorCode(err) === PG_EXCLUSION_VIOLATION) {
      throw new AppError(400, "Working hour blocks must not overlap on the same day");
    }
    throw err;
  }
}

export async function listLeave(caller: CallerIdentity, doctorId: string): Promise<DoctorLeave[]> {
  await assertCanManageDoctorSchedule(caller, doctorId);
  return prisma.doctorLeave.findMany({ where: { doctorId }, orderBy: { startsAt: "asc" } });
}

export async function createLeave(caller: CallerIdentity, doctorId: string, input: LeaveInput): Promise<DoctorLeave> {
  await assertCanManageDoctorSchedule(caller, doctorId);

  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);

  // A leave period silently swallowing an already-booked appointment would
  // leave that appointment orphaned; force cancellation/rescheduling first.
  const conflictingAppointment = await prisma.appointment.findFirst({
    where: {
      doctorId,
      status: { in: [AppointmentStatus.SCHEDULED, AppointmentStatus.COMPLETED] },
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
    },
    select: { id: true },
  });
  if (conflictingAppointment) {
    throw new AppError(409, "This leave period overlaps an existing appointment; cancel or reschedule it first");
  }

  try {
    return await prisma.doctorLeave.create({
      data: { doctorId, startsAt, endsAt, reason: input.reason, createdById: caller.sub },
    });
  } catch (err) {
    if (getPostgresErrorCode(err) === PG_EXCLUSION_VIOLATION) {
      throw new AppError(409, "This leave period overlaps an existing leave period");
    }
    throw err;
  }
}

export async function deleteLeave(caller: CallerIdentity, doctorId: string, leaveId: string): Promise<void> {
  await assertCanManageDoctorSchedule(caller, doctorId);

  const result = await prisma.doctorLeave.deleteMany({ where: { id: leaveId, doctorId } });
  if (result.count === 0) {
    throw new AppError(404, "Leave period not found");
  }
}
