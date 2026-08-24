import type { Request, Response } from "express";
import { env } from "../../config/env";
import * as googleAccountService from "../../calendar/google-account.service";
import { buildConsentUrl, isGoogleCalendarConfigured, verifyOAuthState } from "../../calendar/google-oauth";
import { AppError } from "../../lib/http-error";
import { logger } from "../../lib/logger";
import { callbackQuerySchema } from "./google.schemas";

function requireConfigured(): void {
  if (!isGoogleCalendarConfigured()) {
    throw new AppError(503, "Google Calendar integration is not configured");
  }
}

export async function connectHandler(req: Request, res: Response): Promise<void> {
  requireConfigured();
  const url = buildConsentUrl(req.user!.sub);
  res.status(200).json({ url });
}

export async function statusHandler(req: Request, res: Response): Promise<void> {
  const status = await googleAccountService.getGoogleAccountStatus(req.user!.sub);
  res.status(200).json(status);
}

export async function disconnectHandler(req: Request, res: Response): Promise<void> {
  await googleAccountService.disconnectGoogleAccount(req.user!.sub);
  res.status(204).send();
}

// This is a plain browser redirect from Google's consent screen, not an API
// call — there's no Authorization header and no JS on the other end to
// handle a JSON response, so the outcome is communicated by redirecting back
// to the frontend with a status query param instead.
export async function callbackHandler(req: Request, res: Response): Promise<void> {
  const query = callbackQuerySchema.parse(req.query);

  if ("error" in query) {
    res.redirect(`${env.WEB_APP_URL}/settings?google=denied`);
    return;
  }

  try {
    const userId = verifyOAuthState(query.state);
    await googleAccountService.connectGoogleAccount(userId, query.code);
    res.redirect(`${env.WEB_APP_URL}/settings?google=connected`);
  } catch (err) {
    // The redirect stays generic (no internal detail leaked to the browser
    // via a query param); the actual cause still needs to be visible somewhere.
    logger.error({ err }, "Google Calendar connection failed");
    res.redirect(`${env.WEB_APP_URL}/settings?google=error`);
  }
}
