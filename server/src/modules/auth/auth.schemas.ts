import { z } from "zod";
import { emailSchema, ianaTimezoneSchema, passwordSchema } from "../../lib/common-schemas";

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(1).max(30).optional(),
  timezone: ianaTimezoneSchema.optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;
