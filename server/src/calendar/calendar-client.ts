import { GaxiosError } from "gaxios";
import { google, type calendar_v3 } from "googleapis";
import { createOAuthClient } from "./google-oauth";

export interface GoogleAccountCredentials {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiryDate: number | null;
}

export interface CalendarEventInput {
  calendarId: string;
  googleEventId?: string | null;
  summary: string;
  description?: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
}

export type TokenRefreshHandler = (
  userId: string,
  tokens: { accessToken: string; expiryDate: number | null },
) => Promise<void>;

// Provider adapter: the sync orchestration in calendar-sync.ts depends only
// on this interface, both so the Google specifics stay isolated and so tests
// can inject a fake client without real Google credentials.
export interface CalendarClient {
  createEvent(account: GoogleAccountCredentials, input: CalendarEventInput): Promise<string>;
  updateEvent(account: GoogleAccountCredentials, input: CalendarEventInput): Promise<void>;
  deleteEvent(account: GoogleAccountCredentials, calendarId: string, googleEventId: string): Promise<void>;
}

function toGoogleEvent(input: CalendarEventInput): calendar_v3.Schema$Event {
  return {
    summary: input.summary,
    description: input.description,
    start: { dateTime: input.startsAt.toISOString(), timeZone: input.timezone },
    end: { dateTime: input.endsAt.toISOString(), timeZone: input.timezone },
  };
}

function isAlreadyGone(err: unknown): boolean {
  return err instanceof GaxiosError && (err.response?.status === 404 || err.response?.status === 410);
}

export class GoogleCalendarClient implements CalendarClient {
  // Persisting a refreshed access token isn't required for correctness (the
  // refresh token lets every future call re-refresh anyway) but avoids an
  // avoidable refresh round-trip on every subsequent sync.
  constructor(private readonly onTokensRefreshed: TokenRefreshHandler) {}

  private getCalendar(account: GoogleAccountCredentials): calendar_v3.Calendar {
    const client = createOAuthClient();
    client.setCredentials({
      access_token: account.accessToken,
      refresh_token: account.refreshToken,
      expiry_date: account.expiryDate,
    });
    client.on("tokens", (tokens) => {
      if (tokens.access_token) {
        this.onTokensRefreshed(account.userId, {
          accessToken: tokens.access_token,
          expiryDate: tokens.expiry_date ?? null,
        }).catch(() => undefined);
      }
    });
    return google.calendar({ version: "v3", auth: client });
  }

  async createEvent(account: GoogleAccountCredentials, input: CalendarEventInput): Promise<string> {
    const calendar = this.getCalendar(account);
    const res = await calendar.events.insert({ calendarId: input.calendarId, requestBody: toGoogleEvent(input) });
    if (!res.data.id) {
      throw new Error("Google did not return an event id");
    }
    return res.data.id;
  }

  async updateEvent(account: GoogleAccountCredentials, input: CalendarEventInput): Promise<void> {
    if (!input.googleEventId) {
      throw new Error("updateEvent requires an existing googleEventId");
    }
    const calendar = this.getCalendar(account);
    await calendar.events.update({
      calendarId: input.calendarId,
      eventId: input.googleEventId,
      requestBody: toGoogleEvent(input),
    });
  }

  async deleteEvent(account: GoogleAccountCredentials, calendarId: string, googleEventId: string): Promise<void> {
    const calendar = this.getCalendar(account);
    try {
      await calendar.events.delete({ calendarId, eventId: googleEventId });
    } catch (err) {
      if (isAlreadyGone(err)) {
        return;
      }
      throw err;
    }
  }
}
