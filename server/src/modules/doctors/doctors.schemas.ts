import { z } from "zod";

export const doctorIdParamSchema = z.object({
  doctorId: z.string().uuid(),
});
export type DoctorIdParam = z.infer<typeof doctorIdParamSchema>;

export const availabilityQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be in YYYY-MM-DD format"),
});
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

const workingHourBlockSchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(1440),
    endMinute: z.number().int().min(0).max(1440),
  })
  .refine((block) => block.startMinute < block.endMinute, {
    message: "startMinute must be before endMinute",
    path: ["endMinute"],
  });

export const replaceWorkingHoursSchema = z.object({
  workingHours: z.array(workingHourBlockSchema).max(21), // generous cap: a handful of blocks per day, 7 days
});
export type ReplaceWorkingHoursInput = z.infer<typeof replaceWorkingHoursSchema>;

export const leaveSchema = z
  .object({
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), {
    message: "endsAt must be after startsAt",
    path: ["endsAt"],
  });
export type LeaveInput = z.infer<typeof leaveSchema>;

export const leaveIdParamSchema = z.object({
  doctorId: z.string().uuid(),
  leaveId: z.string().uuid(),
});
export type LeaveIdParam = z.infer<typeof leaveIdParamSchema>;
