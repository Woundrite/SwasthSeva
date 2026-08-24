import { Prisma } from "../generated/prisma/client";

// Prisma 7's driver-adapter layer doesn't map every Postgres error onto one of
// its own P-codes (e.g. GiST exclusion violations surface as generic P2039);
// the original Postgres SQLSTATE is nested inside the driver adapter error.
export function getPostgresErrorCode(err: unknown): string | undefined {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) {
    return undefined;
  }
  const meta = err.meta as { driverAdapterError?: { cause?: { originalCode?: string } } } | undefined;
  return meta?.driverAdapterError?.cause?.originalCode;
}

export const PG_EXCLUSION_VIOLATION = "23P01";
