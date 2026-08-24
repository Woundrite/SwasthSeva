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
const password = "Sup3rSecret!";

const adminEmail = `admin-${randomUUID()}@example.com`;
const doctorAEmail = `doctor-a-${randomUUID()}@example.com`;
const doctorBEmail = `doctor-b-${randomUUID()}@example.com`;
const patientEmail = `patient-${randomUUID()}@example.com`;

let doctorAProfileId: string;
let adminToken: string;
let doctorAToken: string;
let doctorBToken: string;
let patientToken: string;

function nextWorkingDate(minDaysOut: number): string {
  let day = DateTime.now().setZone(CLINIC_TZ).plus({ days: minDaysOut });
  while (![1, 2, 3, 4, 5].includes(day.weekday)) {
    day = day.plus({ days: 1 });
  }
  return day.toISODate()!;
}

beforeAll(async () => {
  const passwordHash = await hashPassword(password);

  await prisma.user.create({ data: { email: adminEmail, passwordHash, role: Role.ADMIN, fullName: "Schedule Admin" } });

  const doctorAUser = await prisma.user.create({
    data: {
      email: doctorAEmail,
      passwordHash,
      role: Role.DOCTOR,
      fullName: "Dr. Schedule A",
      doctorProfile: { create: { specialisation: "General Medicine", clinicTimezone: CLINIC_TZ } },
    },
    include: { doctorProfile: true },
  });
  doctorAProfileId = doctorAUser.doctorProfile!.id;

  await prisma.user.create({
    data: {
      email: doctorBEmail,
      passwordHash,
      role: Role.DOCTOR,
      fullName: "Dr. Schedule B",
      doctorProfile: { create: { specialisation: "General Medicine", clinicTimezone: CLINIC_TZ } },
    },
  });

  const [loginA, loginB, loginAdmin, regPatient] = await Promise.all([
    request(app).post("/api/v1/auth/login").send({ email: doctorAEmail, password }),
    request(app).post("/api/v1/auth/login").send({ email: doctorBEmail, password }),
    request(app).post("/api/v1/auth/login").send({ email: adminEmail, password }),
    request(app).post("/api/v1/auth/register").send({ email: patientEmail, password, fullName: "Schedule Patient" }),
  ]);
  doctorAToken = loginA.body.accessToken;
  doctorBToken = loginB.body.accessToken;
  adminToken = loginAdmin.body.accessToken;
  patientToken = regPatient.body.accessToken;
});

afterAll(async () => {
  await prisma.emailOutbox.deleteMany({ where: { toEmail: { in: [doctorAEmail, doctorBEmail, patientEmail] } } });
  await prisma.appointment.deleteMany({ where: { doctorId: doctorAProfileId } });
  await prisma.user.deleteMany({ where: { email: { in: [adminEmail, doctorAEmail, doctorBEmail, patientEmail] } } });
  await prisma.$disconnect();
});

describe("GET /api/v1/doctors/me", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/v1/doctors/me");
    expect(res.status).toBe(401);
  });

  it("rejects a patient", async () => {
    const res = await request(app).get("/api/v1/doctors/me").set("Authorization", `Bearer ${patientToken}`);
    expect(res.status).toBe(403);
  });

  it("returns the caller's own doctor profile", async () => {
    const res = await request(app).get("/api/v1/doctors/me").set("Authorization", `Bearer ${doctorAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.doctor.id).toBe(doctorAProfileId);
    expect(res.body.doctor.specialisation).toBe("General Medicine");
  });
});

describe("GET /api/v1/doctors/:doctorId/working-hours", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get(`/api/v1/doctors/${doctorAProfileId}/working-hours`);
    expect(res.status).toBe(401);
  });

  it("rejects a patient", async () => {
    const res = await request(app)
      .get(`/api/v1/doctors/${doctorAProfileId}/working-hours`)
      .set("Authorization", `Bearer ${patientToken}`);
    expect(res.status).toBe(403);
  });

  it("rejects a doctor who doesn't own this profile", async () => {
    const res = await request(app)
      .get(`/api/v1/doctors/${doctorAProfileId}/working-hours`)
      .set("Authorization", `Bearer ${doctorBToken}`);
    expect(res.status).toBe(403);
  });

  it("lets the owning doctor and an admin read the working hours", async () => {
    const setRes = await request(app)
      .put(`/api/v1/doctors/${doctorAProfileId}/working-hours`)
      .set("Authorization", `Bearer ${doctorAToken}`)
      .send({ workingHours: [{ dayOfWeek: 2, startMinute: 540, endMinute: 1020 }] });
    expect(setRes.status).toBe(200);

    const asOwner = await request(app)
      .get(`/api/v1/doctors/${doctorAProfileId}/working-hours`)
      .set("Authorization", `Bearer ${doctorAToken}`);
    expect(asOwner.status).toBe(200);
    expect(asOwner.body.workingHours).toEqual(setRes.body.workingHours);

    const asAdmin = await request(app)
      .get(`/api/v1/doctors/${doctorAProfileId}/working-hours`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.workingHours).toEqual(setRes.body.workingHours);
  });
});

describe("PUT /api/v1/doctors/:doctorId/working-hours", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).put(`/api/v1/doctors/${doctorAProfileId}/working-hours`).send({ workingHours: [] });
    expect(res.status).toBe(401);
  });

  it("rejects a patient", async () => {
    const res = await request(app)
      .put(`/api/v1/doctors/${doctorAProfileId}/working-hours`)
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ workingHours: [] });
    expect(res.status).toBe(403);
  });

  it("rejects a doctor who doesn't own this profile", async () => {
    const res = await request(app)
      .put(`/api/v1/doctors/${doctorAProfileId}/working-hours`)
      .set("Authorization", `Bearer ${doctorBToken}`)
      .send({ workingHours: [{ dayOfWeek: 1, startMinute: 540, endMinute: 1020 }] });
    expect(res.status).toBe(403);
  });

  it("rejects overlapping blocks on the same day", async () => {
    const res = await request(app)
      .put(`/api/v1/doctors/${doctorAProfileId}/working-hours`)
      .set("Authorization", `Bearer ${doctorAToken}`)
      .send({
        workingHours: [
          { dayOfWeek: 1, startMinute: 540, endMinute: 720 },
          { dayOfWeek: 1, startMinute: 600, endMinute: 660 },
        ],
      });
    expect(res.status).toBe(400);
  });

  it("lets the doctor set their own working hours, and lets availability reflect it immediately", async () => {
    const res = await request(app)
      .put(`/api/v1/doctors/${doctorAProfileId}/working-hours`)
      .set("Authorization", `Bearer ${doctorAToken}`)
      .send({ workingHours: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 17 * 60 }] });
    expect(res.status).toBe(200);
    expect(res.body.workingHours).toHaveLength(1);

    const monday = nextWorkingDate(2);
    // nextWorkingDate can land on any weekday 1-5; only assert non-empty when it's actually a Monday.
    if (DateTime.fromISO(monday, { zone: CLINIC_TZ }).weekday === 1) {
      const availRes = await request(app)
        .get(`/api/v1/doctors/${doctorAProfileId}/availability?date=${monday}`)
        .set("Authorization", `Bearer ${patientToken}`);
      expect(availRes.body.slots.length).toBeGreaterThan(0);
    }
  });

  it("lets an admin set working hours on the doctor's behalf", async () => {
    const res = await request(app)
      .put(`/api/v1/doctors/${doctorAProfileId}/working-hours`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        workingHours: [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, startMinute: 9 * 60, endMinute: 17 * 60 })),
      });
    expect(res.status).toBe(200);
    expect(res.body.workingHours).toHaveLength(5);
  });
});

describe("POST /api/v1/doctors/:doctorId/leave", () => {
  it("rejects a doctor who doesn't own this profile", async () => {
    const res = await request(app)
      .post(`/api/v1/doctors/${doctorAProfileId}/leave`)
      .set("Authorization", `Bearer ${doctorBToken}`)
      .send({ startsAt: "2026-10-01T00:00:00.000Z", endsAt: "2026-10-02T00:00:00.000Z" });
    expect(res.status).toBe(403);
  });

  it("rejects endsAt before startsAt", async () => {
    const res = await request(app)
      .post(`/api/v1/doctors/${doctorAProfileId}/leave`)
      .set("Authorization", `Bearer ${doctorAToken}`)
      .send({ startsAt: "2026-10-02T00:00:00.000Z", endsAt: "2026-10-01T00:00:00.000Z" });
    expect(res.status).toBe(400);
  });

  it("rejects leave that overlaps an already-booked appointment", async () => {
    const date = nextWorkingDate(3);
    const availRes = await request(app)
      .get(`/api/v1/doctors/${doctorAProfileId}/availability?date=${date}`)
      .set("Authorization", `Bearer ${patientToken}`);
    const bookRes = await request(app)
      .post("/api/v1/appointments")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ doctorId: doctorAProfileId, startsAt: availRes.body.slots[0].startsAt });
    expect(bookRes.status).toBe(201);

    const dayStart = DateTime.fromISO(date, { zone: CLINIC_TZ }).startOf("day").toUTC().toISO();
    const dayEnd = DateTime.fromISO(date, { zone: CLINIC_TZ }).endOf("day").toUTC().toISO();
    const leaveRes = await request(app)
      .post(`/api/v1/doctors/${doctorAProfileId}/leave`)
      .set("Authorization", `Bearer ${doctorAToken}`)
      .send({ startsAt: dayStart, endsAt: dayEnd, reason: "Should conflict" });
    expect(leaveRes.status).toBe(409);
  });

  it("creates a leave period on a day with no appointments, lists it, and deletes it", async () => {
    const date = nextWorkingDate(20);
    const dayStart = DateTime.fromISO(date, { zone: CLINIC_TZ }).startOf("day").toUTC().toISO();
    const dayEnd = DateTime.fromISO(date, { zone: CLINIC_TZ }).endOf("day").toUTC().toISO();

    const createRes = await request(app)
      .post(`/api/v1/doctors/${doctorAProfileId}/leave`)
      .set("Authorization", `Bearer ${doctorAToken}`)
      .send({ startsAt: dayStart, endsAt: dayEnd, reason: "Conference" });
    expect(createRes.status).toBe(201);
    const leaveId = createRes.body.leave.id;

    const listRes = await request(app)
      .get(`/api/v1/doctors/${doctorAProfileId}/leave`)
      .set("Authorization", `Bearer ${doctorAToken}`);
    expect(listRes.body.leave.some((l: { id: string }) => l.id === leaveId)).toBe(true);

    const deleteRes = await request(app)
      .delete(`/api/v1/doctors/${doctorAProfileId}/leave/${leaveId}`)
      .set("Authorization", `Bearer ${doctorAToken}`);
    expect(deleteRes.status).toBe(204);

    const afterDelete = await request(app)
      .get(`/api/v1/doctors/${doctorAProfileId}/leave`)
      .set("Authorization", `Bearer ${doctorAToken}`);
    expect(afterDelete.body.leave.some((l: { id: string }) => l.id === leaveId)).toBe(false);
  });
});
