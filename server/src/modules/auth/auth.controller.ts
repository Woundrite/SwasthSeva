import type { Request, Response } from "express";
import { clearRefreshCookie, REFRESH_COOKIE_NAME, setRefreshCookie } from "../../lib/cookies";
import { AppError } from "../../lib/http-error";
import * as authService from "./auth.service";
import { loginSchema, registerSchema } from "./auth.schemas";

export async function registerHandler(req: Request, res: Response): Promise<void> {
  const input = registerSchema.parse(req.body);
  const result = await authService.register(input, req.headers["user-agent"]);
  setRefreshCookie(res, result.refreshToken);
  res.status(201).json({ user: result.user, accessToken: result.accessToken });
}

export async function loginHandler(req: Request, res: Response): Promise<void> {
  const input = loginSchema.parse(req.body);
  const result = await authService.login(input, req.headers["user-agent"]);
  setRefreshCookie(res, result.refreshToken);
  res.status(200).json({ user: result.user, accessToken: result.accessToken });
}

export async function refreshHandler(req: Request, res: Response): Promise<void> {
  const rawToken: unknown = req.cookies?.[REFRESH_COOKIE_NAME];
  if (typeof rawToken !== "string") {
    throw new AppError(401, "No refresh token provided");
  }

  const result = await authService.refresh(rawToken, req.headers["user-agent"]);
  setRefreshCookie(res, result.refreshToken);
  res.status(200).json({ accessToken: result.accessToken });
}

export async function logoutHandler(req: Request, res: Response): Promise<void> {
  const rawToken: unknown = req.cookies?.[REFRESH_COOKIE_NAME];
  if (typeof rawToken === "string") {
    await authService.logout(rawToken);
  }
  clearRefreshCookie(res);
  res.status(204).send();
}

export async function meHandler(req: Request, res: Response): Promise<void> {
  const user = await authService.getCurrentUser(req.user!.sub);
  res.status(200).json({ user });
}
