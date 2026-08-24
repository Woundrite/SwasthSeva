import { google } from "googleapis";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AppError } from "../lib/http-error";

// googleapis bundles its own copy of google-auth-library internally, and
// google.calendar()'s `auth` option only accepts an instance built from that
// bundled copy — constructing one from the top-level google-auth-library
// package (a separate installed copy) fails type-checking despite being
// structurally identical, since TS treats OAuth2Client's private fields
// nominally. Using googleapis' own re-exported google.auth.OAuth2 avoids the
// mismatch entirely.
export type GoogleOAuth2Client = InstanceType<typeof google.auth.OAuth2>;

// Least-privilege: only calendar event management, plus openid/email so we
// can identify which Google account was connected.
export const CALENDAR_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events"];

const STATE_PURPOSE = "google-oauth-state";
const STATE_TTL = "10m";

export function isGoogleCalendarConfigured(): boolean {
  return env.GOOGLE_CALENDAR_ENABLED && env.GOOGLE_CLIENT_ID.length > 0 && env.GOOGLE_CLIENT_SECRET.length > 0;
}

export function createOAuthClient(): GoogleOAuth2Client {
  return new google.auth.OAuth2({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
  });
}

// The callback is a plain browser redirect from Google, not an API call, so
// there's no Authorization header to identify the user. A short-lived signed
// state token (minted only for an already-authenticated /connect call) both
// identifies the user and protects against CSRF, without needing server-side
// session storage.
export function signOAuthState(userId: string): string {
  return jwt.sign({ sub: userId, purpose: STATE_PURPOSE }, env.JWT_ACCESS_SECRET, { expiresIn: STATE_TTL });
}

export function verifyOAuthState(state: string): string {
  let payload: jwt.JwtPayload | string;
  try {
    payload = jwt.verify(state, env.JWT_ACCESS_SECRET);
  } catch {
    throw new AppError(400, "Invalid or expired Google connection request");
  }
  if (typeof payload === "string" || payload.purpose !== STATE_PURPOSE || typeof payload.sub !== "string") {
    throw new AppError(400, "Invalid or expired Google connection request");
  }
  return payload.sub;
}

export function buildConsentUrl(userId: string): string {
  return createOAuthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: CALENDAR_SCOPES,
    state: signOAuthState(userId),
  });
}

export interface ExchangedGoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiryDate: number | null;
  scope: string;
  googleSub: string;
  googleEmail: string;
}

export async function exchangeCodeForTokens(code: string): Promise<ExchangedGoogleTokens> {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);

  if (!tokens.access_token || !tokens.refresh_token || !tokens.id_token) {
    // Google omits refresh_token on repeat consents without prompt=consent;
    // buildConsentUrl always sets it, so this indicates something unexpected.
    throw new AppError(502, "Google did not return the expected tokens");
  }

  const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: env.GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) {
    throw new AppError(502, "Could not verify the connected Google account");
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiryDate: tokens.expiry_date ?? null,
    scope: tokens.scope ?? CALENDAR_SCOPES.join(" "),
    googleSub: payload.sub,
    googleEmail: payload.email,
  };
}
