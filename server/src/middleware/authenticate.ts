import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/http-error";
import { verifyAccessToken } from "../lib/tokens";

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

  if (!token) {
    throw new AppError(401, "Authentication required");
  }

  try {
    req.user = verifyAccessToken(token);
  } catch {
    throw new AppError(401, "Invalid or expired access token");
  }

  next();
}
