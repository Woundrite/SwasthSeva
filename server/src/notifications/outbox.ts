import type { Prisma } from "../generated/prisma/client";
import type { EmailTemplateName } from "./email-templates";

export interface EnqueueEmailInput {
  toEmail: string;
  toName?: string | null;
  template: EmailTemplateName;
  payload: object;
  // Unique per logical event so retried business transactions never double-send.
  dedupeKey: string;
}

// Writes the outbox row on the same transaction client as the business
// change that triggered it, so a rolled-back transaction never leaves a
// dangling email behind. The dedupe key's uniqueness is what makes an
// at-least-once background drain effectively exactly-once from the user's
// perspective, without this call needing to know that.
export async function enqueueEmail(tx: Prisma.TransactionClient, input: EnqueueEmailInput): Promise<void> {
  await tx.emailOutbox.upsert({
    where: { dedupeKey: input.dedupeKey },
    update: {},
    create: {
      toEmail: input.toEmail,
      toName: input.toName,
      template: input.template,
      payload: input.payload,
      dedupeKey: input.dedupeKey,
    },
  });
}
