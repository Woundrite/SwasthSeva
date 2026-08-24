import { z } from "zod";

export const callbackQuerySchema = z.union([
  z.object({ code: z.string().min(1), state: z.string().min(1) }),
  z.object({ error: z.string().min(1), state: z.string().optional() }),
]);
export type CallbackQuery = z.infer<typeof callbackQuerySchema>;
