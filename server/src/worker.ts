import { startJobSystem, stopJobSystem } from "./jobs";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";

async function main() {
  await prisma.$connect();
  await startJobSystem();
  logger.info("MediFlow worker process ready");

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    await stopJobSystem();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "failed to start worker");
  process.exit(1);
});
