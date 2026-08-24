import { DateTime } from "luxon";
import { PRE_VISIT_PROMPT_VERSION } from "../../ai/pre-visit-summary";
import { env } from "../../config/env";
import { enqueuePreVisitSummaryJob } from "../../jobs/maintenance.queue";
import { getPostgresErrorCode, PG_EXCLUSION_VIOLATION } from "../../lib/db-errors";
import { AppError } from "../../lib/http-error";
import { prisma } from "../../lib/prisma";
import { generateDailySlots, isWithinBookingHorizon, type BusyInterval } from "../../lib/slots";
import { EmailTemplate } from "../../notifications/email-templates";
import { enqueueEmail } from "../../notifications/outbox";
import {
  AppointmentStatus,
  CalendarSyncStatus,
  CancellationReason,
  Role,
  SummaryKind,
  SummaryStatus,
  type Appointment,
} from "../../generated/prisma/client";
import type { BookAppointmentInput, PrescriptionInput, SymptomIntakeInput, VisitNoteInput } from "./appointments.schemas";

const DOCTOR_PUBLIC_SELECT = { id: true, specialisation: true, user: { select: { fullName: true } } } as const;
const PATIENT_PUBLIC_SELECT = { id: true, fullName: true } as const;

async function loadBusyIntervals(doctorId: string, dayStart: DateTime, dayEnd: DateTime): Promise<BusyInterval[]> {
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

  return [
    ...leaves.map((leave) => ({ start: leave.startsAt, end: leave.endsAt })),
    ...appointments.map((appt) => ({ start: appt.startsAt, end: appt.endsAt })),
  ];
}

export async function book(patientId: string, input: BookAppointmentInput): Promise<Appointment> {
  const [doctor, patient] = await Promise.all([
    prisma.doctorProfile.findUnique({
      where: { id: input.doctorId },
      include: { workingHours: true, user: true },
    }),
    prisma.user.findUniqueOrThrow({ where: { id: patientId } }),
  ]);
  if (!doctor || !doctor.isActive) {
    throw new AppError(404, "Doctor not found");
  }

  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(startsAt.getTime() + doctor.slotDurationMinutes * 60_000);
  const now = new Date();

  const localDate = DateTime.fromJSDate(startsAt, { zone: doctor.clinicTimezone }).toISODate();
  if (!localDate || !isWithinBookingHorizon(localDate, doctor.clinicTimezone, now, env.BOOKING_HORIZON_DAYS)) {
    throw new AppError(400, "Requested slot is not bookable");
  }

  // The same slot generator that powers GET availability decides what counts
  // as a real, open slot here too, so the two endpoints can never disagree.
  const dayStart = DateTime.fromISO(localDate, { zone: doctor.clinicTimezone }).startOf("day");
  const dayEnd = dayStart.plus({ days: 1 });
  const busy = await loadBusyIntervals(doctor.id, dayStart, dayEnd);

  const slots = generateDailySlots({
    date: localDate,
    clinicTimezone: doctor.clinicTimezone,
    workingHours: doctor.workingHours,
    slotDurationMinutes: doctor.slotDurationMinutes,
    bufferMinutes: doctor.bufferMinutes,
    busy,
    now,
    minBookingNoticeMinutes: env.MIN_BOOKING_NOTICE_MINUTES,
  });

  const isRealSlot = slots.some((slot) => slot.startsAt.getTime() === startsAt.getTime());
  if (!isRealSlot) {
    throw new AppError(409, "Requested slot is not available");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      // Serialises concurrent booking attempts for this doctor. The lock is
      // transaction-scoped and released automatically on commit/rollback.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${doctor.id}))`;

      const overlap = await tx.appointment.findFirst({
        where: {
          doctorId: doctor.id,
          status: { in: [AppointmentStatus.SCHEDULED, AppointmentStatus.COMPLETED] },
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
        },
        select: { id: true },
      });
      if (overlap) {
        throw new AppError(409, "Requested slot is not available");
      }

      const appointment = await tx.appointment.create({
        data: {
          doctorId: doctor.id,
          patientId,
          startsAt,
          endsAt,
          reasonForVisit: input.reasonForVisit,
        },
      });

      const bookedPayload = {
        specialisation: doctor.specialisation,
        startsAtIso: appointment.startsAt.toISOString(),
        reasonForVisit: input.reasonForVisit,
      };
      await enqueueEmail(tx, {
        toEmail: patient.email,
        toName: patient.fullName,
        template: EmailTemplate.APPOINTMENT_BOOKED_PATIENT,
        payload: { ...bookedPayload, recipientName: patient.fullName, counterpartName: doctor.user.fullName, timezone: patient.timezone },
        dedupeKey: `appt-booked-patient:${appointment.id}`,
      });
      await enqueueEmail(tx, {
        toEmail: doctor.user.email,
        toName: doctor.user.fullName,
        template: EmailTemplate.APPOINTMENT_BOOKED_DOCTOR,
        payload: { ...bookedPayload, recipientName: doctor.user.fullName, counterpartName: patient.fullName, timezone: doctor.clinicTimezone },
        dedupeKey: `appt-booked-doctor:${appointment.id}`,
      });

      // One calendar event per connected account — only for whoever has
      // actually linked Google Calendar; no row at all otherwise.
      const connectedAccounts = await tx.googleAccount.findMany({
        where: { userId: { in: [patientId, doctor.userId] }, revokedAt: null },
        select: { userId: true, calendarId: true },
      });
      for (const account of connectedAccounts) {
        await tx.calendarEvent.create({
          data: {
            appointmentId: appointment.id,
            userId: account.userId,
            calendarId: account.calendarId,
            syncStatus: CalendarSyncStatus.PENDING,
          },
        });
      }

      return appointment;
    });
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    // Backstop: the GiST exclusion constraint is what actually makes an
    // overlap impossible even if the advisory lock above were ever bypassed.
    if (getPostgresErrorCode(err) === PG_EXCLUSION_VIOLATION) {
      throw new AppError(409, "Requested slot is not available");
    }
    throw err;
  }
}

async function resolveDoctorProfileId(userId: string): Promise<string> {
  const profile = await prisma.doctorProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!profile) {
    throw new AppError(403, "No doctor profile is associated with this account");
  }
  return profile.id;
}

export interface CallerIdentity {
  sub: string;
  role: Role;
}

export async function list(caller: CallerIdentity) {
  if (caller.role === Role.DOCTOR) {
    const doctorProfileId = await resolveDoctorProfileId(caller.sub);
    return prisma.appointment.findMany({
      where: { doctorId: doctorProfileId },
      include: { patient: { select: PATIENT_PUBLIC_SELECT } },
      orderBy: { startsAt: "asc" },
    });
  }

  return prisma.appointment.findMany({
    where: { patientId: caller.sub },
    include: { doctor: { select: DOCTOR_PUBLIC_SELECT } },
    orderBy: { startsAt: "asc" },
  });
}

export async function getDetail(caller: CallerIdentity, appointmentId: string) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      doctor: { select: DOCTOR_PUBLIC_SELECT },
      patient: { select: PATIENT_PUBLIC_SELECT },
      symptomIntake: true,
      visitNote: true,
      prescription: { include: { items: true } },
      summaries: { where: { kind: SummaryKind.PRE_VISIT }, take: 1 },
    },
  });
  if (!appointment) {
    throw new AppError(404, "Appointment not found");
  }

  const { summaries, ...appointmentFields } = appointment;
  const withPreVisitSummary = { ...appointmentFields, preVisitSummary: summaries[0] ?? null };

  if (caller.role === Role.PATIENT) {
    if (appointment.patientId !== caller.sub) {
      throw new AppError(403, "You do not have permission to access this appointment");
    }
    // The AI briefing and visit notes are for the doctor; patients never see them directly.
    const { visitNote: _visitNote, preVisitSummary: _preVisitSummary, ...visibleToPatient } = withPreVisitSummary;
    return visibleToPatient;
  }

  const doctorProfileId = await resolveDoctorProfileId(caller.sub);
  if (appointment.doctorId !== doctorProfileId) {
    throw new AppError(403, "You do not have permission to access this appointment");
  }
  return withPreVisitSummary;
}

export async function cancel(patientId: string, appointmentId: string): Promise<Appointment> {
  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });

  if (!appointment) {
    throw new AppError(404, "Appointment not found");
  }
  if (appointment.patientId !== patientId) {
    throw new AppError(403, "You do not have permission to cancel this appointment");
  }
  if (appointment.status !== AppointmentStatus.SCHEDULED) {
    throw new AppError(409, "Only scheduled appointments can be cancelled");
  }

  const minNoticeMs = env.MIN_CANCELLATION_NOTICE_MINUTES * 60_000;
  if (appointment.startsAt.getTime() - Date.now() < minNoticeMs) {
    throw new AppError(
      409,
      `Appointments can only be cancelled at least ${env.MIN_CANCELLATION_NOTICE_MINUTES} minutes in advance`,
    );
  }

  const [patient, doctor] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: appointment.patientId } }),
    prisma.doctorProfile.findUniqueOrThrow({ where: { id: appointment.doctorId }, include: { user: true } }),
  ]);

  return prisma.$transaction(async (tx) => {
    const result = await tx.appointment.updateMany({
      where: { id: appointmentId, patientId, status: AppointmentStatus.SCHEDULED },
      data: {
        status: AppointmentStatus.CANCELLED,
        cancelledAt: new Date(),
        cancellationReason: CancellationReason.PATIENT_REQUEST,
        cancelledById: patientId,
      },
    });

    if (result.count === 0) {
      // Lost a race with another cancellation of the same appointment.
      throw new AppError(409, "Only scheduled appointments can be cancelled");
    }

    const cancelledPayload = {
      specialisation: doctor.specialisation,
      startsAtIso: appointment.startsAt.toISOString(),
      cancellationReason: "Cancelled by patient",
    };
    await enqueueEmail(tx, {
      toEmail: patient.email,
      toName: patient.fullName,
      template: EmailTemplate.APPOINTMENT_CANCELLED_PATIENT,
      payload: { ...cancelledPayload, recipientName: patient.fullName, counterpartName: doctor.user.fullName, timezone: patient.timezone },
      dedupeKey: `appt-cancelled-patient:${appointmentId}`,
    });
    await enqueueEmail(tx, {
      toEmail: doctor.user.email,
      toName: doctor.user.fullName,
      template: EmailTemplate.APPOINTMENT_CANCELLED_DOCTOR,
      payload: { ...cancelledPayload, recipientName: doctor.user.fullName, counterpartName: patient.fullName, timezone: doctor.clinicTimezone },
      dedupeKey: `appt-cancelled-doctor:${appointmentId}`,
    });

    // Any calendar event already synced (or waiting to be) for this
    // appointment now needs to be removed from Google, not created/updated —
    // syncCalendarEvents() decides create vs. delete from the appointment's
    // current status, so resetting to PENDING is enough to trigger that.
    await tx.calendarEvent.updateMany({
      where: { appointmentId, syncStatus: { in: [CalendarSyncStatus.SYNCED, CalendarSyncStatus.PENDING] } },
      data: { syncStatus: CalendarSyncStatus.PENDING },
    });

    return tx.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
  });
}

async function requireOwnAppointmentAsPatient(patientId: string, appointmentId: string): Promise<Appointment> {
  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
  if (!appointment) {
    throw new AppError(404, "Appointment not found");
  }
  if (appointment.patientId !== patientId) {
    throw new AppError(403, "You do not have permission to access this appointment");
  }
  return appointment;
}

async function requireOwnAppointmentAsDoctor(doctorUserId: string, appointmentId: string): Promise<Appointment> {
  const doctorProfileId = await resolveDoctorProfileId(doctorUserId);
  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
  if (!appointment) {
    throw new AppError(404, "Appointment not found");
  }
  if (appointment.doctorId !== doctorProfileId) {
    throw new AppError(403, "You are not the assigned doctor for this appointment");
  }
  return appointment;
}

function assertCanSubmitIntake(appointment: Appointment): void {
  if (appointment.status !== AppointmentStatus.SCHEDULED) {
    throw new AppError(409, "Symptom intake can only be submitted for a scheduled appointment");
  }
  if (appointment.startsAt.getTime() <= Date.now()) {
    throw new AppError(409, "Symptom intake can only be submitted before the appointment takes place");
  }
}

function assertVisitHasOccurred(appointment: Appointment): void {
  if (appointment.status !== AppointmentStatus.SCHEDULED && appointment.status !== AppointmentStatus.COMPLETED) {
    throw new AppError(409, "This appointment is not in a state that can be documented");
  }
  if (appointment.startsAt.getTime() > Date.now()) {
    throw new AppError(409, "This appointment has not taken place yet");
  }
}

export async function submitSymptomIntake(patientId: string, appointmentId: string, input: SymptomIntakeInput) {
  const appointment = await requireOwnAppointmentAsPatient(patientId, appointmentId);
  assertCanSubmitIntake(appointment);

  const intake = await prisma.$transaction(async (tx) => {
    const intake = await tx.symptomIntake.upsert({
      where: { appointmentId },
      update: input,
      create: { appointmentId, ...input },
    });

    // Re-submitting intake regenerates the briefing from scratch — reset to
    // PENDING (and clear any prior attempts) rather than leaving a stale one.
    await tx.aiSummary.upsert({
      where: { appointmentId_kind: { appointmentId, kind: SummaryKind.PRE_VISIT } },
      update: { status: SummaryStatus.PENDING, attempts: 0, error: null },
      create: {
        appointmentId,
        kind: SummaryKind.PRE_VISIT,
        status: SummaryStatus.PENDING,
        promptVersion: PRE_VISIT_PROMPT_VERSION,
      },
    });

    return intake;
  });

  // Outside the transaction: Redis isn't part of the Postgres transaction,
  // so this can only happen once the row is durably committed. If the
  // process dies between the two, the stuck-row backstop sweep catches it.
  await enqueuePreVisitSummaryJob(appointmentId);

  return intake;
}

export async function submitVisitNote(doctorUserId: string, appointmentId: string, input: VisitNoteInput) {
  const appointment = await requireOwnAppointmentAsDoctor(doctorUserId, appointmentId);
  assertVisitHasOccurred(appointment);

  const data = {
    diagnosis: input.diagnosis,
    clinicalNotes: input.clinicalNotes,
    followUpDate: input.followUpDate ? new Date(input.followUpDate) : null,
  };

  return prisma.visitNote.upsert({
    where: { appointmentId },
    update: data,
    create: { appointmentId, ...data },
  });
}

export async function submitPrescription(doctorUserId: string, appointmentId: string, input: PrescriptionInput) {
  const appointment = await requireOwnAppointmentAsDoctor(doctorUserId, appointmentId);
  assertVisitHasOccurred(appointment);

  const items = input.items.map((item) => ({ ...item, startDate: new Date(item.startDate) }));

  return prisma.$transaction(async (tx) => {
    await tx.prescriptionItem.deleteMany({ where: { prescription: { appointmentId } } });
    return tx.prescription.upsert({
      where: { appointmentId },
      update: { generalInstructions: input.generalInstructions, items: { create: items } },
      create: { appointmentId, generalInstructions: input.generalInstructions, items: { create: items } },
      include: { items: true },
    });
  });
}

export async function complete(doctorUserId: string, appointmentId: string): Promise<Appointment> {
  const appointment = await requireOwnAppointmentAsDoctor(doctorUserId, appointmentId);

  if (appointment.status !== AppointmentStatus.SCHEDULED) {
    throw new AppError(409, "Only scheduled appointments can be marked completed");
  }
  if (appointment.startsAt.getTime() > Date.now()) {
    throw new AppError(409, "This appointment has not taken place yet");
  }

  const result = await prisma.appointment.updateMany({
    where: { id: appointmentId, status: AppointmentStatus.SCHEDULED },
    data: { status: AppointmentStatus.COMPLETED },
  });
  if (result.count === 0) {
    throw new AppError(409, "Only scheduled appointments can be marked completed");
  }

  return prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
}
