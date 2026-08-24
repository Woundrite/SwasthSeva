import { z } from "zod";
import { emailSchema, ianaTimezoneSchema, passwordSchema } from "../../lib/common-schemas";

export const createDoctorSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(1).max(30).optional(),
  timezone: ianaTimezoneSchema.optional(),

  specialisation: z.string().trim().min(1).max(200),
  qualifications: z.string().trim().min(1).max(500).optional(),
  bio: z.string().trim().min(1).max(2000).optional(),
  consultationFee: z.number().nonnegative().max(1_000_000).optional(),
  slotDurationMinutes: z.number().int().min(5).max(240).default(30),
  bufferMinutes: z.number().int().min(0).max(120).default(0),
  clinicTimezone: ianaTimezoneSchema.default("Asia/Kolkata"),
});
export type CreateDoctorInput = z.infer<typeof createDoctorSchema>;

export const updateDoctorSchema = z
  .object({
    specialisation: z.string().trim().min(1).max(200).optional(),
    qualifications: z.string().trim().min(1).max(500).optional(),
    bio: z.string().trim().min(1).max(2000).optional(),
    consultationFee: z.number().nonnegative().max(1_000_000).optional(),
    slotDurationMinutes: z.number().int().min(5).max(240).optional(),
    bufferMinutes: z.number().int().min(0).max(120).optional(),
    clinicTimezone: ianaTimezoneSchema.optional(),
    // DoctorProfile.isActive: whether the doctor accepts new bookings.
    isActive: z.boolean().optional(),
    // User.isActive: whether the doctor's account can log in at all.
    accountEnabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "At least one field must be provided" });
export type UpdateDoctorInput = z.infer<typeof updateDoctorSchema>;
