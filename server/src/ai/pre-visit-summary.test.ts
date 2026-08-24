import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppointmentStatus, Role, SummaryKind, SummaryStatus, type SymptomIntake } from "../generated/prisma/client";
import { hashPassword } from "../lib/password";
import { prisma } from "../lib/prisma";
import { buildFallbackPayload, generatePreVisitSummary, PRE_VISIT_PROMPT_VERSION } from "./pre-visit-summary";

function fakeIntake(overrides: Partial<SymptomIntake> = {}): SymptomIntake {
  return {
    appointmentId: randomUUID(),
    symptoms: "Headache",
    durationText: null,
    severity: null,
    existingConditions: null,
    currentMedications: null,
    additionalNotes: null,
    submittedAt: new Date(),
    ...overrides,
  };
}

describe("buildFallbackPayload", () => {
  it("derives HIGH urgency from a high self-rated severity", () => {
    expect(buildFallbackPayload(fakeIntake({ severity: 9 })).urgency).toBe("HIGH");
    expect(buildFallbackPayload(fakeIntake({ severity: 8 })).urgency).toBe("HIGH");
  });

  it("derives MEDIUM urgency from a mid self-rated severity", () => {
    expect(buildFallbackPayload(fakeIntake({ severity: 4 })).urgency).toBe("MEDIUM");
    expect(buildFallbackPayload(fakeIntake({ severity: 7 })).urgency).toBe("MEDIUM");
  });

  it("derives LOW urgency from a low self-rated severity", () => {
    expect(buildFallbackPayload(fakeIntake({ severity: 1 })).urgency).toBe("LOW");
    expect(buildFallbackPayload(fakeIntake({ severity: 3 })).urgency).toBe("LOW");
  });

  it("defaults to MEDIUM (not LOW) when no severity was reported, so nothing urgent is silently downplayed", () => {
    expect(buildFallbackPayload(fakeIntake({ severity: null })).urgency).toBe("MEDIUM");
  });

  it("includes only the fields the patient actually provided as key points", () => {
    const payload = buildFallbackPayload(fakeIntake({ durationText: "3 days", existingConditions: "Asthma" }));
    expect(payload.keyPoints).toContain("Duration: 3 days");
    expect(payload.keyPoints).toContain("Existing conditions: Asthma");
    expect(payload.keyPoints.some((p) => p.startsWith("Current medications"))).toBe(false);
  });
});

describe("generatePreVisitSummary", () => {
  const doctorEmail = `ai-doctor-${randomUUID()}@example.com`;
  const patientEmail = `ai-patient-${randomUUID()}@example.com`;
  let doctorProfileId: string;
  let patientId: string;

  beforeAll(async () => {
    const passwordHash = await hashPassword("irrelevant-not-used-for-login");
    const doctor = await prisma.user.create({
      data: {
        email: doctorEmail,
        passwordHash,
        role: Role.DOCTOR,
        fullName: "Dr. AI Fixture",
        doctorProfile: { create: { specialisation: "General Medicine" } },
      },
      include: { doctorProfile: true },
    });
    doctorProfileId = doctor.doctorProfile!.id;
    const patient = await prisma.user.create({
      data: { email: patientEmail, passwordHash, role: Role.PATIENT, fullName: "AI Fixture Patient" },
    });
    patientId = patient.id;
  });

  afterAll(async () => {
    await prisma.appointment.deleteMany({ where: { doctorId: doctorProfileId } });
    await prisma.user.deleteMany({ where: { email: { in: [doctorEmail, patientEmail] } } });
    await prisma.$disconnect();
  });

  let fixtureSlotOffset = 0;

  async function createAppointmentWithIntake(): Promise<string> {
    fixtureSlotOffset += 1;
    const startsAt = new Date(Date.now() + 86_400_000 + fixtureSlotOffset * 3_600_000);
    const appt = await prisma.appointment.create({
      data: {
        doctorId: doctorProfileId,
        patientId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 20 * 60_000),
      },
    });
    await prisma.symptomIntake.create({ data: { appointmentId: appt.id, symptoms: "Test symptoms", severity: 5 } });
    return appt.id;
  }

  it("no-ops when there is no symptom intake to summarize", async () => {
    const appt = await prisma.appointment.create({
      data: {
        doctorId: doctorProfileId,
        patientId,
        startsAt: new Date(Date.now() + 86_400_000),
        endsAt: new Date(Date.now() + 86_400_000 + 20 * 60_000),
      },
    });
    await expect(generatePreVisitSummary(appt.id)).resolves.toBeUndefined();
    const summary = await prisma.aiSummary.findUnique({
      where: { appointmentId_kind: { appointmentId: appt.id, kind: SummaryKind.PRE_VISIT } },
    });
    expect(summary).toBeNull();
  });

  it("no-ops (does not overwrite) when the summary is already SUCCESS", async () => {
    const appointmentId = await createAppointmentWithIntake();
    await prisma.aiSummary.create({
      data: {
        appointmentId,
        kind: SummaryKind.PRE_VISIT,
        status: SummaryStatus.SUCCESS,
        promptVersion: PRE_VISIT_PROMPT_VERSION,
        payload: { summary: "already done", keyPoints: [], suggestedQuestions: [], urgency: "LOW" },
        attempts: 1,
      },
    });

    await generatePreVisitSummary(appointmentId);

    const after = await prisma.aiSummary.findUniqueOrThrow({
      where: { appointmentId_kind: { appointmentId, kind: SummaryKind.PRE_VISIT } },
    });
    expect(after.attempts).toBe(1); // untouched
    expect((after.payload as { summary: string }).summary).toBe("already done");
  });

  it("generates a SUCCESS summary end-to-end, whether from the model or the fallback", async () => {
    const appointmentId = await createAppointmentWithIntake();
    await prisma.aiSummary.create({
      data: {
        appointmentId,
        kind: SummaryKind.PRE_VISIT,
        status: SummaryStatus.PENDING,
        promptVersion: PRE_VISIT_PROMPT_VERSION,
      },
    });

    await generatePreVisitSummary(appointmentId);

    const after = await prisma.aiSummary.findUniqueOrThrow({
      where: { appointmentId_kind: { appointmentId, kind: SummaryKind.PRE_VISIT } },
    });
    expect(after.status).toBe(SummaryStatus.SUCCESS);
    expect(["MODEL", "FALLBACK"]).toContain(after.source);
    expect(["LOW", "MEDIUM", "HIGH"]).toContain(after.urgency);
    expect(after.attempts).toBe(1);
    expect(after.generatedAt).not.toBeNull();
    const payload = after.payload as { summary: string };
    expect(typeof payload.summary).toBe("string");
    expect(payload.summary.length).toBeGreaterThan(0);
  }, 35_000); // headroom above LLM_TIMEOUT_MS so a real (slow but successful) model call isn't mistaken for a hang
});
