import { AppError } from "../../lib/http-error";
import { hashPassword } from "../../lib/password";
import { prisma } from "../../lib/prisma";
import { Role, type DoctorProfile, type User } from "../../generated/prisma/client";
import type { CreateDoctorInput, UpdateDoctorInput } from "./admin.schemas";

type DoctorWithUser = DoctorProfile & { user: User };

export interface AdminDoctorView {
  id: string;
  userId: string;
  email: string;
  fullName: string;
  phone: string | null;
  accountEnabled: boolean;
  createdAt: Date;
  specialisation: string;
  qualifications: string | null;
  bio: string | null;
  consultationFee: string | null;
  slotDurationMinutes: number;
  bufferMinutes: number;
  clinicTimezone: string;
  isActive: boolean;
}

function toAdminDoctorView(doctor: DoctorWithUser): AdminDoctorView {
  return {
    id: doctor.id,
    userId: doctor.userId,
    email: doctor.user.email,
    fullName: doctor.user.fullName,
    phone: doctor.user.phone,
    accountEnabled: doctor.user.isActive,
    createdAt: doctor.user.createdAt,
    specialisation: doctor.specialisation,
    qualifications: doctor.qualifications,
    bio: doctor.bio,
    consultationFee: doctor.consultationFee?.toString() ?? null,
    slotDurationMinutes: doctor.slotDurationMinutes,
    bufferMinutes: doctor.bufferMinutes,
    clinicTimezone: doctor.clinicTimezone,
    isActive: doctor.isActive,
  };
}

export async function createDoctor(input: CreateDoctorInput): Promise<AdminDoctorView> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new AppError(409, "An account with this email already exists");
  }

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      role: Role.DOCTOR,
      fullName: input.fullName,
      phone: input.phone,
      timezone: input.timezone,
      doctorProfile: {
        create: {
          specialisation: input.specialisation,
          qualifications: input.qualifications,
          bio: input.bio,
          consultationFee: input.consultationFee,
          slotDurationMinutes: input.slotDurationMinutes,
          bufferMinutes: input.bufferMinutes,
          clinicTimezone: input.clinicTimezone,
        },
      },
    },
    include: { doctorProfile: true },
  });

  return toAdminDoctorView({ ...user.doctorProfile!, user });
}

export async function listDoctors(): Promise<AdminDoctorView[]> {
  const doctors = await prisma.doctorProfile.findMany({
    include: { user: true },
    orderBy: { createdAt: "desc" },
  });
  return doctors.map(toAdminDoctorView);
}

export async function getDoctor(doctorId: string): Promise<AdminDoctorView> {
  const doctor = await prisma.doctorProfile.findUnique({ where: { id: doctorId }, include: { user: true } });
  if (!doctor) {
    throw new AppError(404, "Doctor not found");
  }
  return toAdminDoctorView(doctor);
}

export async function updateDoctor(doctorId: string, input: UpdateDoctorInput): Promise<AdminDoctorView> {
  const doctor = await prisma.doctorProfile.findUnique({ where: { id: doctorId } });
  if (!doctor) {
    throw new AppError(404, "Doctor not found");
  }

  const { accountEnabled, isActive, ...profileFields } = input;

  const updated = await prisma.$transaction(async (tx) => {
    if (accountEnabled !== undefined) {
      await tx.user.update({ where: { id: doctor.userId }, data: { isActive: accountEnabled } });
    }
    return tx.doctorProfile.update({
      where: { id: doctorId },
      data: { ...profileFields, ...(isActive === undefined ? {} : { isActive }) },
      include: { user: true },
    });
  });

  return toAdminDoctorView(updated);
}
