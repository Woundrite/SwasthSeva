import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CalendarClient, CalendarEventInput, GoogleAccountCredentials } from "./calendar-client";
import { syncCalendarEvents } from "./calendar-sync";
import { encrypt } from "../lib/crypto";
import { hashPassword } from "../lib/password";
import { prisma } from "../lib/prisma";
import { AppointmentStatus, CalendarSyncStatus, Role } from "../generated/prisma/client";

class FakeCalendarClient implements CalendarClient {
  createCalls: CalendarEventInput[] = [];
  updateCalls: CalendarEventInput[] = [];
  deleteCalls: { calendarId: string; googleEventId: string }[] = [];
  failNextCreate = false;

  async createEvent(_account: GoogleAccountCredentials, input: CalendarEventInput): Promise<string> {
    if (this.failNextCreate) {
      throw new Error("simulated Google API failure");
    }
    this.createCalls.push(input);
    return `fake-event-${this.createCalls.length}`;
  }

  async updateEvent(_account: GoogleAccountCredentials, input: CalendarEventInput): Promise<void> {
    this.updateCalls.push(input);
  }

  async deleteEvent(_account: GoogleAccountCredentials, calendarId: string, googleEventId: string): Promise<void> {
    this.deleteCalls.push({ calendarId, googleEventId });
  }
}

const doctorEmail = `cal-doctor-${randomUUID()}@example.com`;
const patientEmail = `cal-patient-${randomUUID()}@example.com`;
const CLINIC_TZ = "Asia/Kolkata";
const PATIENT_TZ = "America/New_York";

let doctorProfileId: string;
let doctorUserId: string;
let patientId: string;
let slotOffset = 0;

async function createAppointment(status: AppointmentStatus = AppointmentStatus.SCHEDULED) {
  slotOffset += 1;
  const startsAt = new Date(Date.now() + 300 * 3_600_000 + slotOffset * 3_600_000);
  return prisma.appointment.create({
    data: {
      doctorId: doctorProfileId,
      patientId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 20 * 60_000),
      status,
      ...(status === AppointmentStatus.CANCELLED
        ? { cancelledAt: new Date(), cancellationReason: "PATIENT_REQUEST", cancelledById: patientId }
        : {}),
    },
  });
}

beforeAll(async () => {
  const passwordHash = await hashPassword("irrelevant-not-used-for-login");
  const doctor = await prisma.user.create({
    data: {
      email: doctorEmail,
      passwordHash,
      role: Role.DOCTOR,
      fullName: "Dr. Calendar Fixture",
      doctorProfile: { create: { specialisation: "General Medicine", clinicTimezone: CLINIC_TZ } },
    },
    include: { doctorProfile: true },
  });
  doctorProfileId = doctor.doctorProfile!.id;
  doctorUserId = doctor.id;

  const patient = await prisma.user.create({
    data: {
      email: patientEmail,
      passwordHash,
      role: Role.PATIENT,
      fullName: "Calendar Fixture Patient",
      timezone: PATIENT_TZ,
    },
  });
  patientId = patient.id;
});

afterAll(async () => {
  await prisma.appointment.deleteMany({ where: { doctorId: doctorProfileId } });
  await prisma.googleAccount.deleteMany({ where: { userId: { in: [doctorUserId, patientId] } } });
  await prisma.user.deleteMany({ where: { email: { in: [doctorEmail, patientEmail] } } });
  await prisma.$disconnect();
});

async function connectGoogleAccount(userId: string) {
  await prisma.googleAccount.upsert({
    where: { userId },
    update: { revokedAt: null },
    create: {
      userId,
      googleSub: `fake-sub-${userId}`,
      googleEmail: "fixture@gmail.example",
      accessTokenEnc: encrypt("fake-access-token"),
      refreshTokenEnc: encrypt("fake-refresh-token"),
      scope: "openid email https://www.googleapis.com/auth/calendar.events",
    },
  });
}

describe("syncCalendarEvents", () => {
  it("creates a new event for a scheduled appointment and marks the row SYNCED", async () => {
    await connectGoogleAccount(patientId);
    const appt = await createAppointment();
    const row = await prisma.calendarEvent.create({
      data: { appointmentId: appt.id, userId: patientId, calendarId: "primary", syncStatus: CalendarSyncStatus.PENDING },
    });

    const client = new FakeCalendarClient();
    await syncCalendarEvents(client);

    expect(client.createCalls).toHaveLength(1);
    expect(client.createCalls[0]!.timezone).toBe(PATIENT_TZ); // the patient's own timezone, not the clinic's

    const after = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.syncStatus).toBe(CalendarSyncStatus.SYNCED);
    expect(after.googleEventId).toBe("fake-event-1");
    expect(after.syncedAt).not.toBeNull();
  });

  it("uses the clinic timezone for the doctor's own event", async () => {
    await connectGoogleAccount(doctorUserId);
    const appt = await createAppointment();
    await prisma.calendarEvent.create({
      data: { appointmentId: appt.id, userId: doctorUserId, calendarId: "primary", syncStatus: CalendarSyncStatus.PENDING },
    });

    const client = new FakeCalendarClient();
    await syncCalendarEvents(client);

    expect(client.createCalls[0]!.timezone).toBe(CLINIC_TZ);
  });

  it("updates (not creates) when the row already has a googleEventId", async () => {
    const appt = await createAppointment();
    await prisma.calendarEvent.create({
      data: {
        appointmentId: appt.id,
        userId: patientId,
        calendarId: "primary",
        syncStatus: CalendarSyncStatus.PENDING,
        googleEventId: "already-exists-on-google",
      },
    });

    const client = new FakeCalendarClient();
    await syncCalendarEvents(client);

    expect(client.createCalls).toHaveLength(0);
    expect(client.updateCalls).toHaveLength(1);
  });

  it("deletes the Google event for a cancelled appointment that was previously synced", async () => {
    const appt = await createAppointment(AppointmentStatus.CANCELLED);
    const row = await prisma.calendarEvent.create({
      data: {
        appointmentId: appt.id,
        userId: patientId,
        calendarId: "primary",
        syncStatus: CalendarSyncStatus.PENDING,
        googleEventId: "event-to-delete",
      },
    });

    const client = new FakeCalendarClient();
    await syncCalendarEvents(client);

    expect(client.deleteCalls).toEqual([{ calendarId: "primary", googleEventId: "event-to-delete" }]);
    const after = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.syncStatus).toBe(CalendarSyncStatus.DELETED);
  });

  it("resolves a cancelled appointment that was never synced without calling the client", async () => {
    const appt = await createAppointment(AppointmentStatus.CANCELLED);
    const row = await prisma.calendarEvent.create({
      data: { appointmentId: appt.id, userId: patientId, calendarId: "primary", syncStatus: CalendarSyncStatus.PENDING },
    });

    const client = new FakeCalendarClient();
    await syncCalendarEvents(client);

    expect(client.deleteCalls).toHaveLength(0);
    const after = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.syncStatus).toBe(CalendarSyncStatus.DELETED);
  });

  it("marks the row DISCONNECTED if the account is no longer connected", async () => {
    const appt = await createAppointment();
    const row = await prisma.calendarEvent.create({
      data: { appointmentId: appt.id, userId: patientId, calendarId: "primary", syncStatus: CalendarSyncStatus.PENDING },
    });
    await prisma.googleAccount.updateMany({ where: { userId: patientId }, data: { revokedAt: new Date() } });

    const client = new FakeCalendarClient();
    await syncCalendarEvents(client);

    const after = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.syncStatus).toBe(CalendarSyncStatus.DISCONNECTED);
    expect(client.createCalls).toHaveLength(0);

    await connectGoogleAccount(patientId); // reconnect for subsequent tests
  });

  it("retries on failure and gives up (FAILED) once max attempts is reached", async () => {
    const appt = await createAppointment();
    const row = await prisma.calendarEvent.create({
      data: {
        appointmentId: appt.id,
        userId: patientId,
        calendarId: "primary",
        syncStatus: CalendarSyncStatus.PENDING,
        attempts: 4, // one below CALENDAR_MAX_ATTEMPTS (5)
      },
    });

    const client = new FakeCalendarClient();
    client.failNextCreate = true;
    await syncCalendarEvents(client);

    const after = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.syncStatus).toBe(CalendarSyncStatus.FAILED);
    expect(after.attempts).toBe(5);
    expect(after.lastError).toContain("simulated Google API failure");
  });
});
