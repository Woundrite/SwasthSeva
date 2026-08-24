import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app";
import { Role } from "../../generated/prisma/client";
import { hashPassword } from "../../lib/password";
import { prisma } from "../../lib/prisma";

const app = createApp();

const adminEmail = `admin-${randomUUID()}@example.com`;
const patientEmail = `patient-${randomUUID()}@example.com`;
const newDoctorEmail = `new-doctor-${randomUUID()}@example.com`;
const password = "Sup3rSecret!";

let adminToken: string;
let patientToken: string;
let createdDoctorId: string;
let createdDoctorUserId: string;

beforeAll(async () => {
  const passwordHash = await hashPassword(password);
  await prisma.user.create({
    data: { email: adminEmail, passwordHash, role: Role.ADMIN, fullName: "Test Admin" },
  });

  const [loginAdmin, regPatient] = await Promise.all([
    request(app).post("/api/v1/auth/login").send({ email: adminEmail, password }),
    request(app).post("/api/v1/auth/register").send({ email: patientEmail, password, fullName: "Test Patient" }),
  ]);
  adminToken = loginAdmin.body.accessToken;
  patientToken = regPatient.body.accessToken;
});

afterAll(async () => {
  if (createdDoctorUserId) {
    await prisma.appointment.deleteMany({ where: { patientId: createdDoctorUserId } });
  }
  const doctorProfile = createdDoctorId ? await prisma.doctorProfile.findUnique({ where: { id: createdDoctorId } }) : null;
  if (doctorProfile) {
    await prisma.appointment.deleteMany({ where: { doctorId: doctorProfile.id } });
  }
  await prisma.user.deleteMany({ where: { email: { in: [adminEmail, patientEmail, newDoctorEmail] } } });
  await prisma.$disconnect();
});

describe("POST /api/v1/admin/doctors", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).post("/api/v1/admin/doctors").send({});
    expect(res.status).toBe(401);
  });

  it("rejects a patient (wrong role)", async () => {
    const res = await request(app)
      .post("/api/v1/admin/doctors")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ email: newDoctorEmail, password, fullName: "x", specialisation: "y" });
    expect(res.status).toBe(403);
  });

  it("creates a doctor account and profile together", async () => {
    const res = await request(app)
      .post("/api/v1/admin/doctors")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        email: newDoctorEmail,
        password,
        fullName: "Dr. Created By Admin",
        specialisation: "Pediatrics",
        slotDurationMinutes: 15,
        bufferMinutes: 5,
      });
    expect(res.status).toBe(201);
    expect(res.body.doctor.email).toBe(newDoctorEmail);
    expect(res.body.doctor.specialisation).toBe("Pediatrics");
    expect(res.body.doctor.isActive).toBe(true);
    expect(res.body.doctor.accountEnabled).toBe(true);
    expect(res.body.doctor.passwordHash).toBeUndefined();

    createdDoctorId = res.body.doctor.id;
    createdDoctorUserId = res.body.doctor.userId;
  });

  it("rejects a duplicate email", async () => {
    const res = await request(app)
      .post("/api/v1/admin/doctors")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: newDoctorEmail, password, fullName: "Dupe", specialisation: "x" });
    expect(res.status).toBe(409);
  });

  it("lets the created doctor log in", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({ email: newDoctorEmail, password });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("DOCTOR");
  });
});

describe("GET /api/v1/admin/doctors", () => {
  it("rejects a patient (wrong role)", async () => {
    const res = await request(app).get("/api/v1/admin/doctors").set("Authorization", `Bearer ${patientToken}`);
    expect(res.status).toBe(403);
  });

  it("lists the created doctor for an admin", async () => {
    const res = await request(app).get("/api/v1/admin/doctors").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.doctors.some((d: { id: string }) => d.id === createdDoctorId)).toBe(true);
  });
});

describe("GET /api/v1/admin/doctors/:doctorId", () => {
  it("404s for an unknown doctor", async () => {
    const res = await request(app)
      .get(`/api/v1/admin/doctors/${randomUUID()}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/v1/admin/doctors/:doctorId", () => {
  it("updates profile fields", async () => {
    const res = await request(app)
      .patch(`/api/v1/admin/doctors/${createdDoctorId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ bio: "Updated bio", consultationFee: 750 });
    expect(res.status).toBe(200);
    expect(res.body.doctor.bio).toBe("Updated bio");
    expect(res.body.doctor.consultationFee).toBe("750");
  });

  it("deactivating the doctor profile removes them from the public listing", async () => {
    const patch = await request(app)
      .patch(`/api/v1/admin/doctors/${createdDoctorId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ isActive: false });
    expect(patch.status).toBe(200);
    expect(patch.body.doctor.isActive).toBe(false);

    const listing = await request(app).get("/api/v1/doctors").set("Authorization", `Bearer ${patientToken}`);
    expect(listing.body.doctors.some((d: { id: string }) => d.id === createdDoctorId)).toBe(false);
  });

  it("disabling the account (accountEnabled: false) blocks login", async () => {
    const patch = await request(app)
      .patch(`/api/v1/admin/doctors/${createdDoctorId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ accountEnabled: false });
    expect(patch.status).toBe(200);
    expect(patch.body.doctor.accountEnabled).toBe(false);

    const loginAttempt = await request(app).post("/api/v1/auth/login").send({ email: newDoctorEmail, password });
    expect(loginAttempt.status).toBe(403);
  });

  it("rejects an empty update body", async () => {
    const res = await request(app)
      .patch(`/api/v1/admin/doctors/${createdDoctorId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(400);
  });
});
