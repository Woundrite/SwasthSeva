export type Role = 'PATIENT' | 'DOCTOR' | 'ADMIN';
export type Status = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export interface User {
  id: string;
  email: string;
  role: Role;
  fullName: string;
  phone?: string;
  timezone?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Doctor {
  id: string;
  fullName: string;
  specialisation: string;
  qualifications?: string;
  bio?: string;
  consultationFee?: string | null;
  slotDurationMinutes: number;
  clinicTimezone: string;
  bufferMinutes?: number;
  isActive?: boolean;
  userId?: string;
  email?: string;
  accountEnabled?: boolean;
}

export interface Slot { startsAt: string; endsAt: string; }
export interface WorkingHour { id: string; dayOfWeek: number; startMinute: number; endMinute: number; }
export interface Leave { id: string; startsAt: string; endsAt: string; reason?: string; }
export interface SymptomIntake { symptoms: string; durationText?: string; severity?: number; existingConditions?: string; currentMedications?: string; additionalNotes?: string; }
export interface PreVisitSummary { status: 'PENDING' | 'SUCCESS' | 'FAILED'; source: 'MODEL' | 'FALLBACK'; urgency: 'LOW' | 'MEDIUM' | 'HIGH' | null; payload: { summary: string; keyPoints: string[]; suggestedQuestions: string[]; urgency: string } | null; }
export interface VisitNote { diagnosis: string; clinicalNotes: string; followUpDate?: string; }
export interface PrescriptionItem { medicationName: string; dosage: string; frequencyPerDay: number; timesOfDay: string[]; durationDays: number; startDate: string; instructions?: string; }
export interface Prescription { generalInstructions?: string; items: PrescriptionItem[]; }
export interface Appointment {
  id: string; startsAt: string; endsAt?: string; status: Status; reasonForVisit?: string;
  cancelledAt?: string | null;
  doctor?: { id: string; specialisation: string; user: { fullName: string } };
  patient?: { id: string; fullName: string };
  symptomIntake?: SymptomIntake | null; prescription?: Prescription | null;
  visitNote?: VisitNote | null; preVisitSummary?: PreVisitSummary | null;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';
let accessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

export class ApiError extends Error {
  code?: string;
  issues?: { path: string | string[]; message: string }[];
  status: number;
  constructor(message: string, status: number, code?: string, issues?: { path: string | string[]; message: string }[]) {
    super(message); this.status = status; this.code = code; this.issues = issues;
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.error?.message || 'Something went wrong.', response.status, data.error?.code, data.error?.issues);
  return data as T;
}

async function refresh(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_BASE_URL}/api/v1/auth/refresh`, { method: 'POST', credentials: 'include' })
      .then(async (response) => { if (!response.ok) return null; const data = await response.json(); return data.accessToken || null; })
      .catch(() => null)
      .finally(() => { refreshPromise = null; });
  }
  accessToken = await refreshPromise;
  return accessToken;
}

// Set by the app shell so a mid-session refresh failure (expired/reused
// refresh cookie) can clear user state and bounce back to the login screen,
// instead of leaving the UI stuck showing failed requests indefinitely.
let onAuthFailure: (() => void) | null = null;
export function setAuthFailureHandler(handler: (() => void) | null): void {
  onAuthFailure = handler;
}

export async function request<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers, credentials: 'include' });
  if (response.status === 401 && retry && !path.includes('/auth/refresh')) {
    const token = await refresh();
    if (token) return request<T>(path, options, false);
    accessToken = null;
    onAuthFailure?.();
  }
  return parseResponse<T>(response);
}

// Backend zod schemas model every optional text field as `.min(1).optional()`
// — meaning "omit it entirely, or give it real content," never an empty
// string. Form state naturally defaults empty fields to '', so every request
// body is run through this before serializing: a blank/whitespace-only
// string is dropped (matching "field was skipped"), never sent as ''.
function stripEmptyStrings(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripEmptyStrings);
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim() === '') continue;
      result[key] = stripEmptyStrings(v);
    }
    return result;
  }
  return value;
}

const body = (value: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(stripEmptyStrings(value)) });
export const api = {
  bootstrap: () => refresh().then((token) => token ? request<{ user: User }>('/api/v1/auth/me') : null),
  login: async (value: { email: string; password: string }) => { const data = await request<{ user: User; accessToken: string }>('/api/v1/auth/login', body(value)); accessToken = data.accessToken; return data.user; },
  register: async (value: Record<string, string>) => { const data = await request<{ user: User; accessToken: string }>('/api/v1/auth/register', body(value)); accessToken = data.accessToken; return data.user; },
  logout: async () => { await request<void>('/api/v1/auth/logout', { method: 'POST' }); accessToken = null; },
  doctors: () => request<{ doctors: Doctor[] }>('/api/v1/doctors'),
  doctorMe: () => request<{ doctor: Doctor }>('/api/v1/doctors/me'),
  availability: (id: string, date: string) => request<{ date: string; clinicTimezone: string; slotDurationMinutes: number; slots: Slot[] }>(`/api/v1/doctors/${id}/availability?date=${encodeURIComponent(date)}`),
  appointments: () => request<{ appointments: Appointment[] }>('/api/v1/appointments'),
  appointment: (id: string) => request<{ appointment: Appointment }>(`/api/v1/appointments/${id}`),
  book: (value: { doctorId: string; startsAt: string; reasonForVisit?: string }) => request<{ appointment: Appointment }>('/api/v1/appointments', body(value)),
  cancel: (id: string) => request<{ appointment: Appointment }>(`/api/v1/appointments/${id}/cancel`, body({})),
  symptomIntake: (id: string, value: SymptomIntake) => request<{ symptomIntake: SymptomIntake }>(`/api/v1/appointments/${id}/symptom-intake`, body(value)),
  visitNote: (id: string, value: VisitNote) => request<{ visitNote: VisitNote }>(`/api/v1/appointments/${id}/visit-note`, body(value)),
  prescription: (id: string, value: Prescription) => request<{ prescription: Prescription }>(`/api/v1/appointments/${id}/prescription`, body(value)),
  complete: (id: string) => request<{ appointment: Appointment }>(`/api/v1/appointments/${id}/complete`, body({})),
  workingHours: (id: string) => request<{ workingHours: WorkingHour[] }>(`/api/v1/doctors/${id}/working-hours`),
  saveWorkingHours: (id: string, workingHours: Omit<WorkingHour, 'id'>[]) => request<{ workingHours: WorkingHour[] }>(`/api/v1/doctors/${id}/working-hours`, { method: 'PUT', body: JSON.stringify(stripEmptyStrings({ workingHours })) }),
  leave: (id: string) => request<{ leave: Leave[] }>(`/api/v1/doctors/${id}/leave`),
  addLeave: (id: string, value: { startsAt: string; endsAt: string; reason?: string }) => request<{ leave: Leave }>(`/api/v1/doctors/${id}/leave`, body(value)),
  deleteLeave: (id: string, leaveId: string) => request<void>(`/api/v1/doctors/${id}/leave/${leaveId}`, { method: 'DELETE' }),
  adminDoctors: () => request<{ doctors: Doctor[] }>('/api/v1/admin/doctors'),
  adminDoctor: (id: string) => request<{ doctor: Doctor }>(`/api/v1/admin/doctors/${id}`),
  createDoctor: (value: Record<string, unknown>) => request<{ doctor: Doctor }>('/api/v1/admin/doctors', body(value)),
  updateDoctor: (id: string, value: Record<string, unknown>) => request<{ doctor: Doctor }>(`/api/v1/admin/doctors/${id}`, { method: 'PATCH', body: JSON.stringify(stripEmptyStrings(value)) }),
  googleStatus: () => request<{ connected: boolean; googleEmail?: string; connectedAt?: string }>('/api/v1/integrations/google/status'),
  googleConnect: () => request<{ url: string }>('/api/v1/integrations/google/connect'),
  googleDisconnect: () => request<void>('/api/v1/integrations/google', { method: 'DELETE' }),
};
