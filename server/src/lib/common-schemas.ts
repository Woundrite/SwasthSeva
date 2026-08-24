import { IANAZone } from "luxon";
import { z } from "zod";

export const emailSchema = z
  .string()
  .email()
  .transform((value) => value.toLowerCase());

export const passwordSchema = z.string().min(8).max(128);

export const ianaTimezoneSchema = z
  .string()
  .refine((value) => IANAZone.isValidZone(value), { message: "Invalid IANA timezone" });
