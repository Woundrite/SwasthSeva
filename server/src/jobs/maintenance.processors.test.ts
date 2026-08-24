import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRE_VISIT_PROMPT_VERSION } from "../ai/pre-visit-summary";
import { AppointmentStatus, HoldStatus, OutboxStatus, Role, SummaryKind, SummaryStatus } from "../generated/prisma/client";
import { hashPassword } from "../lib/password";
import { prisma } from "../lib/prisma";
import {
  cleanupExpiredRefreshTokens,
  drainEmailOutbox,
  reconcileStaleAppointments,
  reconcileStuckAiSummaries,
  sweepExpiredSlotHolds,
} from "./maintenance.processors";

const doctorEmail = `jobs-doctor-${randomUUID()}@example.com`;
const patientEmail = `jobs-patient-${randomUUID()}@example.com`;

let doctorProfileId: string;
let patientId: string;

async function seedFixtures() {
  const passwordHash = await hashPassword("irrelevant-not-used-for-login");
  const doctor = await prisma.user.create({
    data: {
      email: doctorEmail,
      passwordHash,
      role: Role.DOCTOR,
      fullName: "Dr. Jobs Fixture",
      doctorProfile: { create: { specialisation: "General Medicine" } },
    },
    include: { doctorProfile: true },
  });
  doctorProfileId = doctor.doctorProfile!.id;

  const patient = await prisma.user.create({
    data: { email: patientEmail, passwordHash, role: Role.PATIENT, fullName: "Jobs Fixture Patient" },
  });
  patientId = patient.id;
}

beforeAll(seedFixtures);

afterAll(async () => {
  await prisma.emailOutbox.deleteMany({
    where: { toEmail: { in: ["outbox-test@example.com", "not-due@example.com", "nobody@example.com"] } },
  });
  await prisma.appointment.deleteMany({ where: { doctorId: doctorProfileId } });
  await prisma.slotHold.deleteMany({ where: { doctorId: doctorProfileId } });
  await prisma.refreshToken.deleteMany({ where: { userId: patientId } });
  await prisma.user.deleteMany({ where: { email: { in: [doctorEmail, patientEmail] } } });
  await prisma.$disconnect();
});

describe("sweepExpiredSlotHolds", () => {
  it("expires only ACTIVE holds whose TTL has passed, leaving others untouched", async () => {
    const expired = await prisma.slotHold.create({
      data: {
        doctorId: doctorProfileId,
        patientId,
        startsAt: new Date(Date.now() + 3_600_000),
        endsAt: new Date(Date.now() + 3_600_000 + 20 * 60_000),
        status: HoldStatus.ACTIVE,
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    const stillActive = await prisma.slotHold.create({
      data: {
        doctorId: doctorProfileId,
        patientId,
        startsAt: new Date(Date.now() + 7_200_000),
        endsAt: new Date(Date.now() + 7_200_000 + 20 * 60_000),
        status: HoldStatus.ACTIVE,
        expiresAt: new Date(Date.now() + 600_000),
      },
    });
    const alreadyReleased = await prisma.slotHold.create({
      data: {
        doctorId: doctorProfileId,
        patientId,
        startsAt: new Date(Date.now() + 10_800_000),
        endsAt: new Date(Date.now() + 10_800_000 + 20 * 60_000),
        status: HoldStatus.RELEASED,
        expiresAt: new Date(Date.now() - 60_000),
        releasedAt: new Date(),
      },
    });

    const count = await sweepExpiredSlotHolds();
    expect(count).toBeGreaterThanOrEqual(1);

    expect((await prisma.slotHold.findUniqueOrThrow({ where: { id: expired.id } })).status).toBe(HoldStatus.EXPIRED);
    expect((await prisma.slotHold.findUniqueOrThrow({ where: { id: stillActive.id } })).status).toBe(HoldStatus.ACTIVE);
    expect((await prisma.slotHold.findUniqueOrThrow({ where: { id: alreadyReleased.id } })).status).toBe(
      HoldStatus.RELEASED,
    );
  });
});

describe("cleanupExpiredRefreshTokens", () => {
  it("deletes only long-expired tokens, keeping tokens still within the retention window", async () => {
    const longExpired = await prisma.refreshToken.create({
      data: { userId: patientId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() - 10 * 86_400_000) },
    });
    const stillValid = await prisma.refreshToken.create({
      data: { userId: patientId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 86_400_000) },
    });

    await cleanupExpiredRefreshTokens();

    expect(await prisma.refreshToken.findUnique({ where: { id: longExpired.id } })).toBeNull();
    expect(await prisma.refreshToken.findUnique({ where: { id: stillValid.id } })).not.toBeNull();
  });
});

describe("reconcileStaleAppointments", () => {
  it("marks SCHEDULED appointments long past their end time as NO_SHOW, respecting the grace period", async () => {
    const stale = await prisma.appointment.create({
      data: {
        doctorId: doctorProfileId,
        patientId,
        startsAt: new Date(Date.now() - 60 * 3_600_000),
        endsAt: new Date(Date.now() - 60 * 3_600_000 + 20 * 60_000),
        status: AppointmentStatus.SCHEDULED,
      },
    });
    const withinGrace = await prisma.appointment.create({
      data: {
        doctorId: doctorProfileId,
        patientId,
        startsAt: new Date(Date.now() - 3 * 3_600_000),
        endsAt: new Date(Date.now() - 3 * 3_600_000 + 20 * 60_000),
        status: AppointmentStatus.SCHEDULED,
      },
    });
    const alreadyCompleted = await prisma.appointment.create({
      data: {
        doctorId: doctorProfileId,
        patientId,
        startsAt: new Date(Date.now() - 90 * 3_600_000),
        endsAt: new Date(Date.now() - 90 * 3_600_000 + 20 * 60_000),
        status: AppointmentStatus.COMPLETED,
      },
    });

    await reconcileStaleAppointments();

    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe(
      AppointmentStatus.NO_SHOW,
    );
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: withinGrace.id } })).status).toBe(
      AppointmentStatus.SCHEDULED,
    );
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: alreadyCompleted.id } })).status).toBe(
      AppointmentStatus.COMPLETED,
    );
  });
});

describe("drainEmailOutbox", () => {
  it("sends a due PENDING row and marks it SENT with a provider message id", async () => {
    const row = await prisma.emailOutbox.create({
      data: {
        toEmail: "outbox-test@example.com",
        toName: "Outbox Test",
        template: "appointment-booked-patient",
        payload: {
          recipientName: "Outbox Test",
          counterpartName: "Dr. Test",
          specialisation: "General Medicine",
          startsAtIso: new Date(Date.now() + 86_400_000).toISOString(),
          timezone: "Asia/Kolkata",
        },
        dedupeKey: `test-outbox-sent-${randomUUID()}`,
      },
    });

    const sentCount = await drainEmailOutbox();
    expect(sentCount).toBeGreaterThanOrEqual(1);

    const after = await prisma.emailOutbox.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe(OutboxStatus.SENT);
    expect(after.sentAt).not.toBeNull();
    expect(after.providerMessageId).not.toBeNull();
  });

  it("ignores rows that aren't due yet", async () => {
    const row = await prisma.emailOutbox.create({
      data: {
        toEmail: "not-due@example.com",
        template: "appointment-booked-patient",
        payload: {},
        dedupeKey: `test-outbox-not-due-${randomUUID()}`,
        nextAttemptAt: new Date(Date.now() + 3_600_000),
      },
    });

    await drainEmailOutbox();

    const after = await prisma.emailOutbox.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe(OutboxStatus.PENDING);
  });

  it("retries with backoff on failure, then dead-letters once maxAttempts is reached", async () => {
    const row = await prisma.emailOutbox.create({
      data: {
        toEmail: "nobody@example.com",
        template: "this-template-does-not-exist",
        payload: {},
        dedupeKey: `test-outbox-retry-${randomUUID()}`,
        maxAttempts: 2,
      },
    });

    await drainEmailOutbox();
    const afterFirst = await prisma.emailOutbox.findUniqueOrThrow({ where: { id: row.id } });
    expect(afterFirst.status).toBe(OutboxStatus.PENDING);
    expect(afterFirst.attempts).toBe(1);
    expect(afterFirst.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(afterFirst.lastError).toContain("Unknown email template");

    // Force the retry to be due now instead of waiting out the real backoff.
    await prisma.emailOutbox.update({ where: { id: row.id }, data: { nextAttemptAt: new Date() } });
    await drainEmailOutbox();

    const afterSecond = await prisma.emailOutbox.findUniqueOrThrow({ where: { id: row.id } });
    expect(afterSecond.status).toBe(OutboxStatus.DEAD);
    expect(afterSecond.attempts).toBe(2);
  });
});

describe("reconcileStuckAiSummaries", () => {
  let stuckFixtureSlotOffset = 0;

  async function createStuckAppointment() {
    stuckFixtureSlotOffset += 1;
    const startsAt = new Date(Date.now() + 200 * 3_600_000 + stuckFixtureSlotOffset * 3_600_000);
    const appt = await prisma.appointment.create({
      data: {
        doctorId: doctorProfileId,
        patientId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 20 * 60_000),
      },
    });
    await prisma.symptomIntake.create({ data: { appointmentId: appt.id, symptoms: "Stuck row test" } });
    return appt.id;
  }

  it("gives up (FAILED) on a stuck row that has already exhausted its attempts, without retrying it", async () => {
    const appointmentId = await createStuckAppointment();
    const summary = await prisma.aiSummary.create({
      data: {
        appointmentId,
        kind: SummaryKind.PRE_VISIT,
        status: SummaryStatus.PENDING,
        promptVersion: PRE_VISIT_PROMPT_VERSION,
        attempts: 3,
      },
    });
    await prisma.$executeRaw`UPDATE ai_summaries SET updated_at = ${new Date(Date.now() - 10 * 60_000)} WHERE id = ${summary.id}::uuid`;

    const processed = await reconcileStuckAiSummaries();
    expect(processed).toBeGreaterThanOrEqual(1);

    const after = await prisma.aiSummary.findUniqueOrThrow({ where: { id: summary.id } });
    expect(after.status).toBe(SummaryStatus.FAILED);
    expect(after.error).not.toBeNull();
  });

  it("ignores a PENDING row that isn't stuck yet (recently updated)", async () => {
    const appointmentId = await createStuckAppointment();
    const summary = await prisma.aiSummary.create({
      data: {
        appointmentId,
        kind: SummaryKind.PRE_VISIT,
        status: SummaryStatus.PENDING,
        promptVersion: PRE_VISIT_PROMPT_VERSION,
      },
    });

    await reconcileStuckAiSummaries();

    const after = await prisma.aiSummary.findUniqueOrThrow({ where: { id: summary.id } });
    expect(after.status).toBe(SummaryStatus.PENDING);
  });
});
