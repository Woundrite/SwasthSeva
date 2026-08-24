import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { HoldStatus, Role } from "../generated/prisma/client";
import { hashPassword } from "../lib/password";
import { prisma } from "../lib/prisma";
import { MaintenanceJob, maintenanceQueue } from "./maintenance.queue";
import { createMaintenanceWorker } from "./maintenance.worker";

const doctorEmail = `queue-doctor-${randomUUID()}@example.com`;
const patientEmail = `queue-patient-${randomUUID()}@example.com`;

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: [doctorEmail, patientEmail] } } });
  await maintenanceQueue.close();
  await prisma.$disconnect();
});

describe("BullMQ queue + worker wiring", () => {
  it("processes an enqueued job end-to-end and applies its effect to the database", async () => {
    const passwordHash = await hashPassword("irrelevant-not-used-for-login");
    const doctor = await prisma.user.create({
      data: {
        email: doctorEmail,
        passwordHash,
        role: Role.DOCTOR,
        fullName: "Dr. Queue Fixture",
        doctorProfile: { create: { specialisation: "General Medicine" } },
      },
      include: { doctorProfile: true },
    });
    const patient = await prisma.user.create({
      data: { email: patientEmail, passwordHash, role: Role.PATIENT, fullName: "Queue Fixture Patient" },
    });

    const expiredHold = await prisma.slotHold.create({
      data: {
        doctorId: doctor.doctorProfile!.id,
        patientId: patient.id,
        startsAt: new Date(Date.now() + 3_600_000),
        endsAt: new Date(Date.now() + 3_600_000 + 20 * 60_000),
        status: HoldStatus.ACTIVE,
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const worker = createMaintenanceWorker();
    try {
      const job = await maintenanceQueue.add(MaintenanceJob.SWEEP_EXPIRED_SLOT_HOLDS, {});

      // Wait for this specific job to finish (proves the queue+worker wiring
      // itself works), but assert success on the DB effect rather than this
      // job's own reported count — a real environment can have other
      // schedulers on the same shared queue (e.g. a `dev`/`dev:worker`
      // process left running) racing to sweep the same row first, which is
      // still a correct outcome, just not attributed to this job's return value.
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("job did not complete in time")), 10_000);
        worker.on("completed", (completedJob) => {
          if (completedJob.id === job.id) {
            clearTimeout(timeout);
            resolve();
          }
        });
        worker.on("failed", (failedJob, err) => {
          if (failedJob?.id === job.id) {
            clearTimeout(timeout);
            reject(err);
          }
        });
      });

      const holdAfter = await prisma.slotHold.findUniqueOrThrow({ where: { id: expiredHold.id } });
      expect(holdAfter.status).toBe(HoldStatus.EXPIRED);
    } finally {
      await worker.close();
    }
  }, 15_000);
});
