import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app";
import { Role } from "../../generated/prisma/client";
import { hashPassword } from "../../lib/password";
import { prisma } from "../../lib/prisma";

const app = createApp();
const CLINIC_TZ = "Asia/Kolkata";

const doctorEmail = `doctor-${randomUUID()}@example.com`;
const patientEmail = `patient-${randomUUID()}@example.com`;
const patientPassword = "Sup3rSecret!";

let doctorProfileId: string;
let patientAccessToken: string;

// A weekday (Mon-Fri) at least 2 days out, and a weekend day, both within the
// booking horizon — computed relative to "now" so the suite isn't tied to a
// fixed calendar date.
function nextDateWithWeekday(minDaysOut: number, isoWeekdays: number[]): string {
  let day = DateTime.now().setZone(CLINIC_TZ).plus({ days: minDaysOut });
  while (!isoWeekdays.includes(day.weekday)) {
    day = day.plus({ days: 1 });
  }
  return day.toISODate()!;
}

const workingDate = nextDateWithWeekday(2, [1, 2, 3, 4, 5]);
const weekendDate = nextDateWithWeekday(2, [6, 7]);

beforeAll(async () => {
  const passwordHash = await hashPassword("irrelevant-not-used-for-login");
  const doctorUser = await prisma.user.create({
    data: {
      email: doctorEmail,
      passwordHash,
      role: Role.DOCTOR,
      fullName: "Dr. Test Doctor",
      doctorProfile: {
        create: {
          specialisation: "Cardiology",
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

  const registerRes = await request(app)
    .post("/api/v1/auth/register")
    .send({ email: patientEmail, password: patientPassword, fullName: "Test Patient" });
  patientAccessToken = registerRes.body.accessToken;
});

afterAll(async () => {
  await prisma.appointment.deleteMany({ where: { doctorId: doctorProfileId } });
  await prisma.user.deleteMany({ where: { email: { in: [doctorEmail, patientEmail] } } });
  await prisma.$disconnect();
});

describe("GET /api/v1/doctors", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/v1/doctors");
    expect(res.status).toBe(401);
  });

  it("lists the active test doctor with public fields only", async () => {
    const res = await request(app).get("/api/v1/doctors").set("Authorization", `Bearer ${patientAccessToken}`);
    expect(res.status).toBe(200);
    const listed = res.body.doctors.find((d: { id: string }) => d.id === doctorProfileId);
    expect(listed).toBeDefined();
    expect(listed.fullName).toBe("Dr. Test Doctor");
    expect(listed.specialisation).toBe("Cardiology");
    expect(listed.passwordHash).toBeUndefined();
  });
});

describe("GET /api/v1/doctors/:doctorId/availability", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get(`/api/v1/doctors/${doctorProfileId}/availability?date=${workingDate}`);
    expect(res.status).toBe(401);
  });

  it("404s for an unknown doctor", async () => {
    const res = await request(app)
      .get(`/api/v1/doctors/${randomUUID()}/availability?date=${workingDate}`)
      .set("Authorization", `Bearer ${patientAccessToken}`);
    expect(res.status).toBe(404);
  });

  it("400s on a malformed date", async () => {
    const res = await request(app)
      .get(`/api/v1/doctors/${doctorProfileId}/availability?date=not-a-date`)
      .set("Authorization", `Bearer ${patientAccessToken}`);
    expect(res.status).toBe(400);
  });

  it("returns an empty slot list on a non-working day", async () => {
    const res = await request(app)
      .get(`/api/v1/doctors/${doctorProfileId}/availability?date=${weekendDate}`)
      .set("Authorization", `Bearer ${patientAccessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.slots).toEqual([]);
  });

  it("generates correctly-spaced slots inside working hours, in the clinic's timezone", async () => {
    const res = await request(app)
      .get(`/api/v1/doctors/${doctorProfileId}/availability?date=${workingDate}`)
      .set("Authorization", `Bearer ${patientAccessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.slots.length).toBeGreaterThan(0);

    const first = DateTime.fromISO(res.body.slots[0].startsAt, { zone: CLINIC_TZ });
    expect(first.hour).toBe(9);
    expect(first.minute).toBe(0);

    const second = DateTime.fromISO(res.body.slots[1].startsAt, { zone: CLINIC_TZ });
    expect(second.diff(first, "minutes").minutes).toBe(25); // 20min slot + 5min buffer

    for (const slot of res.body.slots) {
      const start = DateTime.fromISO(slot.startsAt, { zone: CLINIC_TZ });
      const end = DateTime.fromISO(slot.endsAt, { zone: CLINIC_TZ });
      expect(end.diff(start, "minutes").minutes).toBe(20);
      const startOfDayMinutes = start.hour * 60 + start.minute;
      const endOfDayMinutes = end.hour * 60 + end.minute;
      expect(startOfDayMinutes).toBeGreaterThanOrEqual(9 * 60);
      expect(endOfDayMinutes).toBeLessThanOrEqual(17 * 60);
    }
  });
});
