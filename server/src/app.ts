import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import path from "node:path";
import pinoHttp from "pino-http";
import { ZodError } from "zod";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { AppError } from "./lib/http-error";
import { authRouter } from "./modules/auth/auth.routes";
import { doctorsRouter } from "./modules/doctors/doctors.routes";
import { appointmentsRouter } from "./modules/appointments/appointments.routes";
import { adminRouter } from "./modules/admin/admin.routes";
import { googleRouter } from "./modules/google/google.routes";

export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin: env.WEB_APP_URL,
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(cookieParser());
  app.use(pinoHttp({ logger }));

  app.get("/api/v1/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/doctors", doctorsRouter);
  app.use("/api/v1/appointments", appointmentsRouter);
  app.use("/api/v1/admin", adminRouter);
  app.use("/api/v1/integrations/google", googleRouter);

  const clientDistPath = path.join(__dirname, "..", "..", "client", "dist");

  app.use(express.static(clientDistPath));

  app.get(/^\/(?!api\/).*/, (_req: Request, res: Response) => {
    res.sendFile(path.join(clientDistPath, "index.html"));
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: { message: "Not found" } });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ error: { message: err.message, code: err.code } });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({ error: { message: "Validation failed", issues: err.issues } });
      return;
    }
    logger.error({ err }, "unhandled error");
    res.status(500).json({ error: { message: "Internal server error" } });
  });

  return app;
}
