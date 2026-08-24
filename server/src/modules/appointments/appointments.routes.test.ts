import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app";
import { Role } from "../../generated/prisma/client";
import { encrypt } from "../../lib/crypto";
import { hashPassword } from "../../lib/password";
import { prisma } from "../../lib/prisma";

const app = createApp();
const CLINIC_TZ = "Asia/Kolkata";

const doctorEmail = `doctor-${randomUUID()}@example.com`;
const patientAEmail = `patient-a-${randomUUID()}@example.com`;
const patientBEmail = `patient-b-${randomUUID()}@example.com`;
const password = "Sup3rSecret!";

let doctorProfileId: string;
let patientAId: string;
let patientAToken: string;
let patientBToken: string;

function nextWorkingDate(minDaysOut: number): string {
  let day = DateTime.now().setZone(CLINIC_TZ).plus({ days: minDaysOut });
  while (![1, 2, 3, 4, 5].includes(day.weekday)) {
    day = day.plus({ days: 1 });
  }
  return day.toISODate()!;
}

async function getSlots(date: string, token: string): Promise<{ startsAt: string; endsAt: string }[]> {
  const res = await request(app)
    .get(`/api/v1/doctors/${doctorProfileId}/availability?date=${date}`)
    .set("Authorization", `Bearer ${token}`);
  return res.body.slots;
}

beforeAll(async () => {
  const passwordHash = await hashPassword("irrelevant-not-used-for-login");
  const doctorUser = await prisma.user.create({
    data: {
      email: doctorEmail,
      passwordHash,
      role: Role.DOCTOR,
      fullName: "Dr. Booking Test",
      doctorProfile: {
        create: {
          specialisation: "General Medicine",
          slotDurationMinutes: 20,
          bufferMinutes: 5,
          clinicTimezone: CLINIC_TZ,
          workingHours: {
            createMany: {
              data: [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, startMinute: 9 * 60, endMinute: 17 * 60 })),
            },
          },
        },
      },
    },
    include: { doctorProfile: true },
  });
  doctorProfileId = doctorUser.doctorProfile!.id;

  const [resA, resB] = await Promise.all([
    request(app).post("/api/v1/auth/register").send({ email: patientAEmail, password, fullName: "Patient A" }),
    request(app).post("/api/v1/auth/register").send({ email: patientBEmail, password, fullName: "Patient B" }),
  ]);
  patientAToken = resA.body.accessToken;
  patientAId = resA.body.user.id;
  patientBToken = resB.body.accessToken;
});

afterAll(async () => {
  await prisma.emailOutbox.deleteMany({ where: { toEmail: { in: [doctorEmail, patientAEmail, patientBEmail] } } });
  await prisma.googleAccount.deleteMany({ where: { userId: patientAId } });
  await prisma.appointment.deleteMany({ where: { doctorId: doctorProfileId } });
  await prisma.user.deleteMany({ where: { email: { in: [doctorEmail, patientAEmail, patientBEmail] } } });
  await prisma.$disconnect();
});

describe("POST /api/v1/appointments", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).post("/api/v1/appointments").send({ doctorId: doctorProfileId, startsAt: "x" });
    expect(res.status).toBe(401);
  });

  it("rejects a slot in the past", async () => {
    const res = await request(app)
      .post("/api/v1/appointments")
      .set("Authorization", `Bearer ${patientAToken}`)
      .send({ doctorId: doctorProfileId, startsAt: "2020-01-01T03:30:00.000Z" });
    expect(res.status).toBe(400);
  });

  it("rejects a slot outside working hours", async () => {
    const date = nextWorkingDate(2);
    const midnightUtc = DateTime.fromISO(date, { zone: CLINIC_TZ }).toUTC().toISO();
    const res = await request(app)
      .post("/api/v1/appointments")
      .set("Authorization", `Bearer ${patientAToken}`)
      .send({ doctorId: doctorProfileId, startsAt: midnightUtc }); // midnight local, well outside 09:00-17:00
    expect(res.status).toBe(409);
  });

  it("rejects a time that doesn't align with the slot grid", async () => {
    const date = nextWorkingDate(2);
    const slots = await getSlots(date, patientAToken);
    const offGrid = DateTime.fromISO(slots[0]!.startsAt).plus({ minutes: 7 }).toISO();
    const res = await request(app)
      .post("/api/v1/appointments")
      .set("Authorization", `Bearer ${patientAToken}`)
      .send({ doctorId: doctorProfileId, startsAt: offGrid });
    expect(res.status).toBe(409);
  });

  it("books an available slot for the authenticated patient", async () => {
    const date = nextWorkingDate(3);
    const slots = await getSlots(date, patientAToken);
    const res = await request(app)
      .post("/api/v1/appointments")
      .set("Authorization", `Bearer ${patientAToken}`)
      .send({ doctorId: doctorProfileId, startsAt: slots[0]!.startsAt, reasonForVisit: "Checkup" });

    expect(res.status).toBe(201);
    expect(res.body.appointment.status).toBe("SCHEDULED");
    expect(res.body.appointment.doctorId).toBe(doctorProfileId);

    // Booking writes both confirmation emails transactionally with the appointment.
    const outboxRows = await prisma.emailOutbox.findMany({
      where: { dedupeKey: { in: [`appt-booked-patient:${res.body.appointment.id}`, `appt-booked-doctor:${res.body.appointment.id}`] } },
    });
    expect(outboxRows).toHaveLength(2);
    expect(outboxRows.every((row) => row.status === "PENDING")).toBe(true);
  });

  it("rejects booking the same slot again", async () => {
    const date = nextWorkingDate(4);
    const slots = await getSlots(date, patientAToken);
    const startsAt = slots[0]!.startsAt;

    const first = await request(app)
      .post("/api/v1/appointments")
      .set("Authorization", `Bearer ${patientAToken}`)
      .send({ doctorId: doctorProfileId, startsAt });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/v1/appointments")
      .set("Authorization", `Bearer ${patientBToken}`)
      .send({ doctorId: doctorProfileId, startsAt });
    expect(second.status).toBe(409);
  });

  it("allows only one winner when two patients race for the same slot concurrently", async () => {
    const date = nextWorkingDate(5);
    const slots = await getSlots(date, patientAToken);
    const startsAt = slots[0]!.startsAt;

    const book = (token: string) =>
      request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${token}`)
        .send({ doctorId: doctorProfileId, startsAt });

    const [resA, resB] = await Promise.all([book(patientAToken), book(patientBToken)]);
    const statuses = [resA.status, resB.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);

    const bookedCount = await prisma.appointment.count({
      where: { doctorId: doctorProfileId, startsAt: new Date(startsAt), status: "SCHEDULED" },
    });
    expect(bookedCount).toBe(1);
  });
});

describe("GET /api/v1/appointments", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/v1/appointments");
    expect(res.status).toBe(401);
  });

  it("returns only the authenticated patient's appointments", async () => {
    const date = nextWorkingDate(6);
    const slots = await getSlots(date, patientAToken);
    const booked = await request(app)
      .post("/api/v1/appointments")
      .set("Authorization", `Bearer ${patientAToken}`)
      .send({ doctorId: doctorProfileId, startsAt: slots[0]!.startsAt });
    const appointmentId = booked.body.appointment.id;

    const asA = await request(app).get("/api/v1/appointments").set("Authorization", `Bearer ${patientAToken}`);
    expect(asA.status).toBe(200);
    expect(asA.body.appointments.some((a: { id: string }) => a.id === appointmentId)).toBe(true);

    const asB = await request(app).get("/api/v1/appointments").set("Authorization", `Bearer ${patientBToken}`);
    expect(asB.status).toBe(200);
    expect(asB.body.appointments.some((a: { id: string }) => a.id === appointmentId)).toBe(false);
  });
});

describe("POST /api/v1/appointments/:id/cancel", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).post(`/api/v1/appointments/${randomUUID()}/cancel`);
    expect(res.status).toBe(401);
  });

  it("404s for a nonexistent appointment", async () => {
    const res = await request(app)
      .post(`/api/v1/appointments/${randomUUID()}/cancel`)
      .set("Authorization", `Bearer ${patientAToken}`);
    expect(res.status).toBe(404);
  });

  it("prevents a patient from cancelling another patient's appointment", async () => {
    const date = nextWorkingDate(7);
    const slots = await getSlots(date, patientAToken);
    const booked = await request(app)
      .post("/api/v1/appointments")
      .set("Authorization", `Bearer ${patientAToken}`)
      .send({ doctorId: doctorProfileId, startsAt: slots[0]!.startsAt });
    const appointmentId = booked.body.appointment.id;

    const res = await request(app)
      .post(`/api/v1/appointments/${appointmentId}/cancel`)
      .set("Authorization", `Bearer ${patientBToken}`);
    expect(res.status).toBe(403);

    const stillScheduled = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
    expect(stillScheduled.status).toBe("SCHEDULED");
  });

  it("lets a patient cancel their own appointment", async () => {
    const date = nextWorkingDate(8);
    const slots = await getSlots(date, patientAToken);
    const booked = await request(app)
      .post("/api/v1/appointments")
      .set("Authorization", `Bearer ${patientAToken}`)
      .send({ doctorId: doctorProfileId, startsAt: slots[0]!.startsAt });
    const appointmentId = booked.body.appointment.id;

    const res = await request(app)
      .post(`/api/v1/appointments/${appointmentId}/cancel`)
      .set("Authorization", `Bearer ${patientAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.appointment.status).toBe("CANCELLED");
    expect(res.body.appointment.cancellationReason).toBe("PATIENT_REQUEST");

    const outboxRows = await prisma.emailOutbox.findMany({
      where: { dedupeKey: { in: [`appt-cancelled-patient:${appointmentId}`, `appt-cancelled-doctor:${appointmentId}`] } },
    });
    expect(outboxRows).toHaveLength(2);

    const again = await request(app)
      .post(`/api/v1/appointments/${appointmentId}/cancel`)
      .set("Authorization", `Bearer ${patientAToken}`);
    expect(again.status).toBe(409);
  });
});

describe("Google Calendar sync on booking/cancellation", () => {
  it("creates a calendar event row only for the patient who has connected Google, and resets it on cancel", async () => {
    await prisma.googleAccount.create({
      data: {
        userId: patientAId,
        googleSub: `fake-sub-${patientAId}`,
        googleEmail: "patient-a@gmail.example",
        accessTokenEnc: encrypt("fake-access-token"),
        refreshTokenEnc: encrypt("fake-refresh-token"),
        scope: "openid email https://www.googleapis.com/auth/calendar.events",
      },
    });

    const date = nextWorkingDate(9);
    const slots = await getSlots(date, patientAToken);
    const booked = await request(app)
      .post("/api/v1/appointments")
      .set("Authorization", `Bearer ${patientAToken}`)
      .send({ doctorId: doctorProfileId, startsAt: slots[0]!.startsAt });
    const appointmentId = booked.body.appointment.id;

    const events = await prisma.calendarEvent.findMany({ where: { appointmentId } });
    expect(events).toHaveLength(1); // only patient A is connected — not the doctor
    expect(events[0]!.userId).toBe(patientAId);
    expect(events[0]!.syncStatus).toBe("PENDING");

    // Mark it as if a prior sync already succeeded, then cancel and confirm it's reset.
    await prisma.calendarEvent.update({
      where: { id: events[0]!.id },
      data: { syncStatus: "SYNCED", googleEventId: "already-synced-event" },
    });

    await request(app)
      .post(`/api/v1/appointments/${appointmentId}/cancel`)
      .set("Authorization", `Bearer ${patientAToken}`);

    const afterCancel = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: events[0]!.id } });
    expect(afterCancel.syncStatus).toBe("PENDING"); // reset so the sync job deletes it from Google
  });

  it("creates no calendar event row when neither party has connected Google", async () => {
    const date = nextWorkingDate(10);
    const slots = await getSlots(date, patientBToken);
    const booked = await request(app)
      .post("/api/v1/appointments")
      .set("Authorization", `Bearer ${patientBToken}`)
      .send({ doctorId: doctorProfileId, startsAt: slots[0]!.startsAt });

    const events = await prisma.calendarEvent.findMany({ where: { appointmentId: booked.body.appointment.id } });
    expect(events).toHaveLength(0);
  });
});
