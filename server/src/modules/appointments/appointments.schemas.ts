import { z } from "zod";

export const bookAppointmentSchema = z.object({
  doctorId: z.string().uuid(),
  startsAt: z.iso.datetime({ offset: true }),
  reasonForVisit: z.string().trim().min(1).max(1000).optional(),
});
export type BookAppointmentInput = z.infer<typeof bookAppointmentSchema>;

export const appointmentIdParamSchema = z.object({
  id: z.string().uuid(),
});
export type AppointmentIdParam = z.infer<typeof appointmentIdParamSchema>;

export const symptomIntakeSchema = z.object({
  symptoms: z.string().trim().min(1).max(2000),
  durationText: z.string().trim().min(1).max(200).optional(),
  severity: z.number().int().min(1).max(10).optional(),
  existingConditions: z.string().trim().min(1).max(2000).optional(),
  currentMedications: z.string().trim().min(1).max(2000).optional(),
  additionalNotes: z.string().trim().min(1).max(2000).optional(),
});
export type SymptomIntakeInput = z.infer<typeof symptomIntakeSchema>;

export const visitNoteSchema = z.object({
  diagnosis: z.string().trim().min(1).max(500),
  clinicalNotes: z.string().trim().min(1).max(5000),
  followUpDate: z.iso.date().optional(),
});
export type VisitNoteInput = z.infer<typeof visitNoteSchema>;

const timeOfDayPattern = /^([01]\d|2[0-3]):[0-5]\d$/;

const prescriptionItemSchema = z
  .object({
    medicationName: z.string().trim().min(1).max(200),
    dosage: z.string().trim().min(1).max(100),
    frequencyPerDay: z.number().int().min(1).max(12),
    timesOfDay: z.array(z.string().regex(timeOfDayPattern, "must be in HH:MM 24-hour format")),
    durationDays: z.number().int().min(1).max(365),
    startDate: z.iso.date(),
    instructions: z.string().trim().min(1).max(500).optional(),
  })
  .refine((item) => item.timesOfDay.length === item.frequencyPerDay, {
    message: "timesOfDay must have exactly frequencyPerDay entries",
    path: ["timesOfDay"],
  });

export const prescriptionSchema = z.object({
  generalInstructions: z.string().trim().min(1).max(2000).optional(),
  items: z.array(prescriptionItemSchema).min(1).max(20),
});
export type PrescriptionInput = z.infer<typeof prescriptionSchema>;
