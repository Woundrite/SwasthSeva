# SwasthSeva — Healthcare Appointment & Follow-up Manager

A clinic appointment platform with separate patient, doctor and admin portals. Patients book
slots and submit symptoms in advance; doctors get an AI pre-visit briefing and record notes and
prescriptions afterwards; both sides are kept informed through email and Google Calendar.

## Features

- **Patients** — register, browse doctors, book/cancel appointments against real-time availability,
  submit pre-visit symptom intake, view prescriptions.
- **Doctors** — manage working hours and leave, view their appointment queue, read an AI-generated
  pre-visit briefing, record visit notes and prescriptions, mark appointments complete.
- **Admins** — create and manage doctor accounts, enable/disable accounts, manage any doctor's
  schedule on their behalf.
- **Concurrency-safe booking** — a PostgreSQL GiST exclusion constraint plus an advisory lock make
  double-booking the same doctor slot impossible, not just unlikely.
- **AI pre-visit summaries** — Google Gemini turns a patient's symptom intake into a structured
  briefing (summary, key points, suggested questions, urgency) for the doctor, with a deterministic
  non-AI fallback if the model is unavailable.
- **Google Calendar sync** — either side can connect their calendar to have bookings/cancellations
  reflected automatically.
- **Email notifications** — booking/cancellation confirmations via a transactional outbox pattern.
- **JWT auth** with rotating refresh tokens and reuse detection.

## Technology stack

- **Backend**: Node.js, TypeScript, Express 5, Prisma 7 (driver-adapter architecture), PostgreSQL,
  Redis, BullMQ (background jobs), Zod (validation), Nodemailer, `@google/genai` (Gemini),
  `googleapis` (Google Calendar OAuth), Vitest + Supertest (tests).
- **Frontend**: React 19, TypeScript, Vite, React Router, TanStack Query, React Hook Form + Zod,
  Tailwind CSS.
- **Infrastructure**: Docker Compose (Postgres, Redis, Mailpit) for local development.

## Repository layout

```
server/        Express + TypeScript API and background worker
  prisma/      Data model, SQL migrations, seed data
  src/         Application code
client/        React + TypeScript frontend
  src/api/     One file per backend module, typed request/response wrappers
  src/pages/   One page per route, grouped by role where role-specific
docker-compose.yml   Postgres, Redis and a local SMTP sink for development
```

## Local setup

Requirements: Node.js 20+, Docker (or your own Postgres 14+ and Redis).

```bash
# 1. Start Postgres, Redis and the local mail sink
docker compose up -d

# 2. Configure the API
cd server
cp .env.example .env
#    Generate the two JWT secrets and the encryption key:
#      openssl rand -base64 48
#      openssl rand -base64 32

# 3. Install dependencies, apply migrations and seed demo accounts
npm install
npm run migrate:deploy
npm run db:seed
```

`npm install` also generates the Prisma client (via its `postinstall` script). `npm run db:seed`
prints the demo admin, doctor and patient credentials — these are **development-only** accounts
whose passwords come from `SEED_ADMIN_PASSWORD`/`SEED_DEFAULT_PASSWORD` in your own `.env`, not
fixed secrets in this repo.

Everything above works out of the box with placeholder AI/Calendar config — `GEMINI_API_KEY` and
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are both optional for local development (see below).

Mail sent in development is captured by Mailpit at [http://localhost:8025](http://localhost:8025) rather than delivered.

Then start the API with `npm run dev` (from `server/`). It listens on `PORT` (4000 by default) and
exposes a health check at `GET /api/v1/health`. With the default `RUN_WORKER_INLINE=true`, the same
process also runs the background job worker — no second terminal needed for local dev.

In a second terminal, start the frontend:

```bash
cd client
cp .env.example .env
npm install
npm run dev
```

It's served at [http://localhost:5173](http://localhost:5173) — log in with one of the seeded accounts printed by
`db:seed`. The API's CORS is locked to a single origin (`WEB_APP_URL`), so the frontend must run on
that exact origin; both sides default to port 5173 for this reason.

## Background jobs

BullMQ + Redis run a handful of periodic maintenance jobs: expiring abandoned slot holds, deleting
long-expired refresh tokens, marking appointments that were never closed out as `NO_SHOW` (only
after a 48-hour grace period, since the system can't actually know a patient didn't show up — this
just stops appointments from staying `SCHEDULED` forever when nobody follows up), draining the
email outbox, and syncing Google Calendar events (both below). See `src/jobs/maintenance.processors.ts`
and `src/calendar/calendar-sync.ts` for the specifics.

`RUN_WORKER_INLINE=true` (the default) runs these inside the API process. For a deployment that
runs the API and worker as separate services, set it to `false` and run the worker on its own:

```bash
npm run dev:worker      # development
npm run start:worker    # production (after npm run build)
```

## Email notifications

Booking and cancellation each write email rows to `email_outbox` on the same database transaction
as the appointment change — writing them anywhere else risks sending mail for a change that then
rolls back. A background job drains due `PENDING` rows every 15 seconds, sends them over SMTP via
Nodemailer, and retries failed sends with exponential backoff (capped at 30 minutes) up to
`max_attempts` before marking a row `DEAD`. Both the patient and the doctor are notified for both
events. Templates live in `src/notifications/email-templates.ts`.

In development, mail goes to Mailpit — nothing leaves your machine. View it at
[http://localhost:8025](http://localhost:8025).

## AI pre-visit summary

When a patient submits symptom intake for an upcoming appointment, a `PENDING` row is written to
`ai_summaries` on the same transaction as the intake, and an immediate background job generates a
structured briefing (summary, key points, suggested questions, an urgency rating) for the doctor —
visible only to the assigned doctor via `GET /api/v1/appointments/:id`, the same way visit notes are.
Gemini is called through a provider adapter (`src/ai/llm-provider.ts`) using structured JSON output,
so a different model provider could be swapped in without touching the summary logic itself.

If `GEMINI_API_KEY` is unset, `LLM_ENABLED=false`, or the model call fails or times out for any
reason, generation falls back to a deterministic, non-AI summary built directly from the intake
fields (`source: "FALLBACK"` on the row) — the doctor always gets _something_ rather than nothing.
A repeatable job every 5 minutes catches any row stuck `PENDING` (the immediate job was lost, e.g. a
crash) and retries it, giving up (`FAILED`) only once `LLM_MAX_ATTEMPTS` is exceeded.

Resubmitting intake regenerates the summary. The prompt explicitly instructs the model to judge
urgency only from the reported symptoms and to disregard any instructions embedded in the patient's
own free-text fields.

**Setup**: get an API key at [https://aistudio.google.com/apikey](https://aistudio.google.com/apikey) and set `GEMINI_API_KEY` in
`server/.env`. `GEMINI_MODEL` should match a currently-available model name — check
[https://ai.google.dev/gemini-api/docs/models](https://ai.google.dev/gemini-api/docs/models), since Google periodically retires older ones (this
project hit exactly that: `gemini-2.5-flash` stopped being available to new API keys partway through
development). No key at all is a fully supported configuration — you'll just always get the
deterministic fallback summary instead of a model-generated one.

## Google Calendar sync

Either side can connect their Google account to have booked appointments appear on their own
calendar, kept in sync on cancellation. OAuth tokens are encrypted at rest (AES-256-GCM, via
`ENCRYPTION_KEY`) and scoped to the minimum needed — `calendar.events` plus `openid`/`email` to
identify the connected account, nothing broader.

```
GET    /api/v1/integrations/google/connect    returns a Google consent URL to redirect the browser to
GET    /api/v1/integrations/google/callback   Google redirects here; not an API call, so identifies
                                               the user via a short-lived signed state token instead
                                               of a bearer token, then redirects back to the frontend
GET    /api/v1/integrations/google/status     { connected, googleEmail?, connectedAt? }
DELETE /api/v1/integrations/google            disconnects (local only — doesn't call Google's revoke
                                               endpoint; the user can always do that from their
                                               Google Account settings)
```

Booking writes a `calendar_events` row (transactionally, same pattern as the email outbox) for each
party that has connected Google; cancelling resets it so the sync job removes the event instead of
creating one. The Google API calls themselves sit behind a small provider interface
(`src/calendar/calendar-client.ts`) so the sync orchestration is testable without real Google
credentials — which this environment doesn't have; what's verified here is everything up to that
boundary: real requests reaching Google's actual OAuth/Calendar endpoints and being rejected because
the configured `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are placeholders, not because anything in
the integration itself is wrong.

**Setup**: in the [Google Cloud Console](https://console.cloud.google.com/), create a project (or
use an existing one), enable the **Google Calendar API**, then create an **OAuth 2.0 Client ID**
(Application type: Web application) under _APIs & Services → Credentials_. Add
`http://localhost:4000/api/v1/integrations/google/callback` as an authorized redirect URI (matching
`GOOGLE_OAUTH_REDIRECT_URI`), and copy the generated Client ID/Secret into `GOOGLE_CLIENT_ID`/
`GOOGLE_CLIENT_SECRET` in `server/.env`. Leaving these as placeholders (or `GOOGLE_CALENDAR_ENABLED= false`) is fully supported — the rest of the app works without it, "Connect Google Calendar" just
fails at Google's end instead of succeeding.

## Frontend

React + TypeScript (Vite), TanStack Query for server state, React Hook Form + Zod for forms — the
same validation library the API uses, so client-side rules mirror the server's `zod` schemas rather
than duplicating them in a different shape. Routing is role-gated: `RequireAuth` redirects to
`/login` when signed out and away from routes the signed-in user's role can't reach (a patient
can't land on `/admin/doctors`, a doctor can't land on `/doctors/:id/book`, etc.) — this mirrors,
but does not replace, the server's own `authorize()` checks, which remain the actual authorization
boundary.

Access tokens are short-lived and kept in memory only (a React context), never in `localStorage` —
consistent with the refresh token being an httpOnly cookie the client can't read. On load, and on
any `401` from an authenticated request, the client calls `POST /auth/refresh` (`credentials: "include"`) to mint a new one; concurrent refresh attempts share a single in-flight request, since
the refresh token rotates on every use and firing two at once would be racing the server's own reuse
detection unnecessarily. A refresh that genuinely fails (expired or already-used cookie) logs the
user out.

Two thin backend additions were made to support pages that need them, discovered while wiring the
frontend to the real API rather than invented speculatively: `GET /api/v1/doctors/me` (a doctor
managing their own schedule needs their own `DoctorProfile.id`, which nothing previously exposed to
them) and `GET /api/v1/doctors/:doctorId/working-hours` (the working-hours editor needs to load the
current schedule before offering to replace it; only the `PUT` existed). Both reuse the existing
`scheduleManagers` authorization (self or admin) and are covered in `schedule.routes.test.ts`.

## Database

PostgreSQL, accessed through Prisma. `prisma/schema.prisma` is the source of truth for the data
model; constraints Prisma cannot express live in the SQL migration
`20260801000001_booking_integrity` and are applied by `prisma migrate deploy` like any other
migration. The `btree_gist` extension is required — it backs the exclusion constraints that make
overlapping appointments impossible at the storage layer.

Useful commands, run from `server/`:

```bash
npm run migrate:dev      # create a new migration during development
npm run migrate:deploy   # apply pending migrations (used in CI and on deploy)
npm run migrate:status   # check that the database matches the migration history
npm run db:reset         # drop, re-migrate and re-seed the local database
```

## Authentication

Access tokens are short-lived JWTs (`Authorization: Bearer <token>`); refresh tokens are opaque
to the client, delivered as an httpOnly cookie scoped to `/api/v1/auth`, and rotated on every use.
A refresh token presented after it's already been rotated (or logged out) is treated as leaked and
revokes every other active session for that account. Access and refresh tokens are signed with
separate secrets so a leaked access-token secret alone can't be used to mint refresh tokens.

```
POST /api/v1/auth/register   patient self-registration; returns a user + access token, sets the cookie
POST /api/v1/auth/login      returns a user + access token, sets the cookie
POST /api/v1/auth/refresh    rotates the refresh cookie, returns a new access token
POST /api/v1/auth/logout     revokes the current refresh token, clears the cookie
GET  /api/v1/auth/me         current user; requires a bearer access token
```

Doctor and admin accounts are provisioned by an admin, not self-registration; the seed script
creates one of each for local development.

## Development notes

- **Editing `.env` doesn't hot-reload.** `npm run dev` uses `tsx watch`, which restarts on
  _source-file_ changes but does not watch `.env`. If you change a value in `.env`, fully stop
  (`Ctrl+C`) and restart the process — otherwise it keeps running with whatever it had in memory at
  its last actual start.
- **Avoid leaving more than one `npm run dev` running.** With the default `RUN_WORKER_INLINE=true`,
  every running instance starts its own BullMQ worker against the same Redis queue, and they'll all
  race for the same jobs — an orphaned instance from an earlier session can silently process a job
  with stale config instead of the one you're currently watching logs from. If background jobs
  (email, AI summaries, calendar sync) behave inconsistently, check for more than one Node process
  bound to the server before suspecting the code.
- **`queue.integration.test.ts` can fail if a `dev`/`dev:worker` process is running** at the same
  time as the test suite, for the same reason — it's racing a real worker on the same shared Redis
  queue for its own test job. This is called out in the test itself; stop any running dev server
  before `npm run test` for a deterministic result.
