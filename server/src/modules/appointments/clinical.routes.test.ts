import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app";
import { AppointmentStatus, Role } from "../../generated/prisma/client";
import { hashPassword } from "../../lib/password";
import { prisma } from "../../lib/prisma";

const app = createApp();
const CLINIC_TZ = "Asia/Kolkata";

const doctorAEmail = `doctor-a-${randomUUID()}@example.com`;
const doctorBEmail = `doctor-b-${randomUUID()}@example.com`;
const patientAEmail = `patient-a-${randomUUID()}@example.com`;
const patientBEmail = `patient-b-${randomUUID()}@example.com`;
const password = "Sup3rSecret!";

let doctorAProfileId: string;
let patientAId: string;
let patientAToken: string;
let doctorAToken: string;
let doctorBToken: string;
let patientBToken: string;
let pastAppointmentId: string;
let futureAppointmentId: string;

function nextWorkingDate(minDaysOut: number): string {
  let day = DateTime.now().setZone(CLINIC_TZ).plus({ days: minDaysOut });
  while (![1, 2, 3, 4, 5].includes(day.weekday)) {
    day = day.plus({ days: 1 });
  }
  return day.toISODate()!;
}

const doctorPassword = "Sup3rSecret!";

async function createDoctor(email: string, fullName: string) {
  const passwordHash = await hashPassword(doctorPassword);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: Role.DOCTOR,
      fullName,
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
  return user;
}

beforeAll(async () => {
  const doctorAUser = await createDoctor(doctorAEmail, "Dr. Clinical A");
  doctorAProfileId = doctorAUser.doctorProfile!.id;
  await createDoctor(doctorBEmail, "Dr. Clinical B");

  // Doctor accounts aren't self-registered; log in directly against the
  // password hashed into their fixture rows above.
  const [regA, regB, loginDoctorA, loginDoctorB] = await Promise.all([
    request(app).post("/api/v1/auth/register").send({ email: patientAEmail, password, fullName: "Clinical Patient A" }),
    request(app).post("/api/v1/auth/register").send({ email: patientBEmail, password, fullName: "Clinical Patient B" }),
    request(app).post("/api/v1/auth/login").send({ email: doctorAEmail, password: doctorPassword }),
    request(app).post("/api/v1/auth/login").send({ email: doctorBEmail, password: doctorPassword }),
  ]);
  patientAToken = regA.body.accessToken;
  patientAId = regA.body.user.id;
  patientBToken = regB.body.accessToken;
  doctorAToken = loginDoctorA.body.accessToken;
  doctorBToken = loginDoctorB.body.accessToken;

  // Past appointment: doctor clinical actions require the visit to have
  // already happened, which the booking API can never produce directly.
  const pastStart = new Date(Date.now() - 60 * 60 * 1000);
  const pastAppointment = await prisma.appointment.create({
    data: {
      doctorId: doctorAProfileId,
      patientId: patientAId,
      startsAt: pastStart,
      endsAt: new Date(pastStart.getTime() + 20 * 60 * 1000),
      status: AppointmentStatus.SCHEDULED,
    },
  });
  pastAppointmentId = pastAppointment.id;

  // Future appointment, booked through the real API.
  const date = nextWorkingDate(3);
  const availRes = await request(app)
    .get(`/api/v1/doctors/${doctorAProfileId}/availability?date=${date}`)
    .set("Authorization", `Bearer ${patientAToken}`);
  const bookRes = await request(app)
    .post("/api/v1/appointments")
    .set("Authorization", `Bearer ${patientAToken}`)
    .send({ doctorId: doctorAProfileId, startsAt: availRes.body.slots[0].startsAt });
  futureAppointmentId = bookRes.body.appointment.id;
});

afterAll(async () => {
  await prisma.emailOutbox.deleteMany({
    where: { toEmail: { in: [doctorAEmail, doctorBEmail, patientAEmail, patientBEmail] } },
  });
  await prisma.appointment.deleteMany({ where: { doctorId: doctorAProfileId } });
  await prisma.user.deleteMany({ where: { email: { in: [doctorAEmail, doctorBEmail, patientAEmail, patientBEmail] } } });
  await prisma.$disconnect();
});

describe("POST /api/v1/appointments/:id/symptom-intake", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).post(`/api/v1/appointments/${futureAppointmentId}/symptom-intake`).send({});
    expect(res.status).toBe(401);
  });

  it("rejects a doctor (wrong role)", async () => {
    const res = await request(app)
      .post(`/api/v1/appointments/${futureAppointmentId}/symptom-intake`)
      .set("Authorization", `Bearer ${doctorAToken}`)
      .send({ symptoms: "x" });
    expect(res.status).toBe(403);
  });

  it("rejects another patient's appointment", async () => {
    const res = await request(app)
      .post(`/api/v1/appointments/${futureAppointmentId}/symptom-intake`)
      .set("Authorization", `Bearer ${patientBToken}`)
      .send({ symptoms: "hijack attempt" });
    expect(res.status).toBe(403);
  });

  it("rejects submission for a past appointment", async () => {
    const res = await request(app)
      .post(`/api/v1/appointments/${pastAppointmentId}/symptom-intake`)
      .set("Authorization", `Bearer ${patientAToken}`)
      .send({ symptoms: "too late" });
    expect(res.status).toBe(409);
  });

  it("rejects an out-of-range severity", async () => {
    const res = await request(app)
      .post(`/api/v1/appointments/${futureAppointmentId}/symptom-intake`)
      .set("Authorization", `Bearer ${patientAToken}`)
      .send({ symptoms: "fever", severity: 99 });
    expect(res.status).toBe(400);
  });

  it("accepts submission for the patient's own future appointment, and upserts on resubmission", async () => {
    const first = await request(app)
      .post(`/api/v1/appointments/${futureAppointmentId}/symptom-intake`)
      .set("Authorization", `Bearer ${patientAToken}`)
      .send({ symptoms: "Headache", severity: 3 });
    expect(first.status).toBe(200);
    expect(first.body.symptomIntake.symptoms).toBe("Headache");

    const second = await request(app)
      .post(`/api/v1/appointments/${futureAppointmentId}/symptom-intake`)
      .set("Authorization", `Bearer ${patientAToken}`)
      .send({ symptoms: "Headache and fever", severity: 5 });
    expect(second.status).toBe(200);
    expect(second.body.symptomIntake.symptoms).toBe("Headache and fever");

    const count = await prisma.symptomIntake.count({ where: { appointmentId: futureAppointmentId } });
    expect(count).toBe(1);
  });
});

describe("POST /api/v1/appointments/:id/visit-note", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).post(`/api/v1/appointments/${pastAppointmentId}/visit-note`).send({});
    expect(res.status).toBe(401);
  });

  it("rejects a patient (wrong role)", async () => {
    const res = await request(app)
      .post(`/api/v1/appointments/${pastAppointmentId}/visit-note`)
      .set("Authorization", `Bearer ${patientAToken}`)
      .send({ diagnosis: "x", clinicalNotes: "y" });
    expect(res.status).toBe(403);
  });

  it("rejects a doctor who isn't assigned to the appointment", async () => {
    const res = await request(app)
      .post(`/api/v1/appointments/${pastAppointmentId}/visit-note`)
      .set("Authorization", `Bearer ${doctorBToken}`)
      .send({ diagnosis: "x", clinicalNotes: "y" });
    expect(res.status).toBe(403);
  });

  it("rejects a note for an appointment that hasn't happened yet", async () => {
    const res = await request(app)
      .post(`/api/v1/appointments/${futureAppointmentId}/visit-note`)
      .set("Authorization", `Bearer ${doctorAToken}`)
      .send({ diagnosis: "x", clinicalNotes: "y" });
    expect(res.status).toBe(409);
  });

  it("lets the assigned doctor record a visit note for a past appointment, and upserts on resubmission", async () => {
    const res = await request(app)
      .post(`/api/v1/appointments/${pastAppointmentId}/visit-note`)
      .set("Authorization", `Bearer ${doctorAToken}`)
      .send({ diagnosis: "Viral fever", clinicalNotes: "Rest and fluids." });
    expect(res.status).toBe(200);
    expect(res.body.visitNote.diagnosis).toBe("Viral fever");

    const again = await request(app)
      .post(`/api/v1/appointments/${pastAppointmentId}/visit-note`)
      .set("Authorization", `Bearer ${doctorAToken}`)
      .send({ diagnosis: "Viral fever (updated)", clinicalNotes: "Rest, fluids, and paracetamol." });
    expect(again.status).toBe(200);

    const count = await prisma.visitNote.count({ where: { appointmentId: pastAppointmentId } });
    expect(count).toBe(1);
  });
});

describe("POST /api/v1/appointments/:id/prescription", () => {
  it("rejects mismatched timesOfDay/frequencyPerDay", async () => {
    const res = await request(app)
      .post(`/api/v1/appointments/${pastAppointmentId}/prescription`)
      .set("Authorization", `Bearer ${doctorAToken}`)
      .send({
        items: [
          { medicationName: "Bad", dosage: "1", frequencyPerDay: 3, timesOfDay: ["09:00"], durationDays: 5, startDate: "2026-08-23" },
        ],
      });
    expect(res.status).toBe(400);
  });

  it("creates a prescription and replaces items on resubmission", async () => {
    const first = await request(app)
      .post(`/api/v1/appointments/${pastAppointmentId}/prescription`)
      .set("Authorization", `Bearer ${doctorAToken}`)
      .send({
        items: [
          {
            medicationName: "Paracetamol",
            dosage: "500mg",
            frequencyPerDay: 2,
            timesOfDay: ["09:00", "21:00"],
            durationDays: 5,
            startDate: "2026-08-23",
          },
        ],
      });
    expect(first.status).toBe(200);
    expect(first.body.prescription.items).toHaveLength(1);

    const second = await request(app)
      .post(`/api/v1/appointments/${pastAppointmentId}/prescription`)
      .set("Authorization", `Bearer ${doctorAToken}`)
      .send({
        items: [
          {
            medicationName: "Ibuprofen",
            dosage: "200mg",
            frequencyPerDay: 1,
            timesOfDay: ["09:00"],
            durationDays: 3,
            startDate: "2026-08-23",
          },
          {
            medicationName: "Cough Syrup",
            dosage: "10ml",
            frequencyPerDay: 3,
            timesOfDay: ["08:00", "14:00", "20:00"],
            durationDays: 3,
            startDate: "2026-08-23",
          },
        ],
      });
    expect(second.status).toBe(200);
    expect(second.body.prescription.items).toHaveLength(2);

    const itemCount = await prisma.prescriptionItem.count({
      where: { prescription: { appointmentId: pastAppointmentId } },
    });
    expect(itemCount).toBe(2);
  });
});

describe("POST /api/v1/appointments/:id/complete", () => {
  it("rejects completing an appointment that hasn't happened yet", async () => {
    const res = await request(app)
      .post(`/api/v1/appointments/${futureAppointmentId}/complete`)
      .set("Authorization", `Bearer ${doctorAToken}`);
    expect(res.status).toBe(409);
  });

  it("marks a past scheduled appointment completed, and rejects completing it again", async () => {
    const res = await request(app)
      .post(`/api/v1/appointments/${pastAppointmentId}/complete`)
      .set("Authorization", `Bearer ${doctorAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.appointment.status).toBe("COMPLETED");

    const again = await request(app)
      .post(`/api/v1/appointments/${pastAppointmentId}/complete`)
      .set("Authorization", `Bearer ${doctorAToken}`);
    expect(again.status).toBe(409);
  });
});

describe("GET /api/v1/appointments/:id role-based visibility", () => {
  it("hides the visit note from the patient but shows the prescription", async () => {
    const res = await request(app)
      .get(`/api/v1/appointments/${pastAppointmentId}`)
      .set("Authorization", `Bearer ${patientAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.appointment.visitNote).toBeUndefined();
    expect(res.body.appointment.prescription).toBeDefined();
  });

  it("shows the visit note to the assigned doctor", async () => {
    const res = await request(app)
      .get(`/api/v1/appointments/${pastAppointmentId}`)
      .set("Authorization", `Bearer ${doctorAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.appointment.visitNote).toBeDefined();
  });

  it("rejects a doctor who isn't assigned to the appointment", async () => {
    const res = await request(app)
      .get(`/api/v1/appointments/${pastAppointmentId}`)
      .set("Authorization", `Bearer ${doctorBToken}`);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/v1/appointments role-aware listing", () => {
  it("only returns the doctor's own appointments", async () => {
    const res = await request(app).get("/api/v1/appointments").set("Authorization", `Bearer ${doctorAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.appointments.every((a: { doctorId: string }) => a.doctorId === doctorAProfileId)).toBe(true);

    const asDoctorB = await request(app).get("/api/v1/appointments").set("Authorization", `Bearer ${doctorBToken}`);
    expect(asDoctorB.body.appointments).toEqual([]);
  });
});
