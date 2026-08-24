import { createApp } from "./app";
import { env } from "./config/env";
import { startJobSystem, stopJobSystem } from "./jobs";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";

async function main() {
  await prisma.$connect();

  if (env.RUN_WORKER_INLINE) {
    await startJobSystem();
  }

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`MediFlow API listening on port ${env.PORT}`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    server.close();
    if (env.RUN_WORKER_INLINE) {
      await stopJobSystem();
    }
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "failed to start server");
  process.exit(1);
});
