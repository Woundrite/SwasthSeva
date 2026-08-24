import { env } from "../src/config/env";
import { Role } from "../src/generated/prisma/client";
import { hashPassword } from "../src/lib/password";
import { prisma } from "../src/lib/prisma";

async function main() {
  if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD || !env.SEED_DEFAULT_PASSWORD) {
    throw new Error(
      "SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD and SEED_DEFAULT_PASSWORD must be set to run the seed script.",
    );
  }

  const adminEmail = env.SEED_ADMIN_EMAIL;
  const doctorEmail = "doctor@mediflow.test";
  const patientEmail = "patient@mediflow.test";

  const [adminPasswordHash, defaultPasswordHash] = await Promise.all([
    hashPassword(env.SEED_ADMIN_PASSWORD),
    hashPassword(env.SEED_DEFAULT_PASSWORD),
  ]);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      passwordHash: adminPasswordHash,
      role: Role.ADMIN,
      fullName: "MediFlow Admin",
    },
  });

  await prisma.user.upsert({
    where: { email: doctorEmail },
    update: {},
    create: {
      email: doctorEmail,
      passwordHash: defaultPasswordHash,
      role: Role.DOCTOR,
      fullName: "Dr. Asha Mehta",
      phone: "+91-98765-43210",
      doctorProfile: {
        create: {
          specialisation: "General Medicine",
          qualifications: "MBBS, MD",
          bio: "General physician with 10 years of outpatient experience.",
          consultationFee: 500,
          slotDurationMinutes: 20,
          bufferMinutes: 5,
          clinicTimezone: "Asia/Kolkata",
          workingHours: {
            createMany: {
              data: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
                dayOfWeek,
                startMinute: 9 * 60,
                endMinute: 17 * 60,
              })),
            },
          },
        },
      },
    },
  });

  await prisma.user.upsert({
    where: { email: patientEmail },
    update: {},
    create: {
      email: patientEmail,
      passwordHash: defaultPasswordHash,
      role: Role.PATIENT,
      fullName: "Rohan Kulkarni",
      phone: "+91-91234-56789",
      patientProfile: { create: {} },
    },
  });

  console.log("\nSeeded demo accounts:\n");
  console.log(`  Admin    ${adminEmail} / ${env.SEED_ADMIN_PASSWORD}`);
  console.log(`  Doctor   ${doctorEmail} / ${env.SEED_DEFAULT_PASSWORD}`);
  console.log(`  Patient  ${patientEmail} / ${env.SEED_DEFAULT_PASSWORD}\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
