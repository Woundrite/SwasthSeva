import { DateTime } from "luxon";

export const EmailTemplate = {
  APPOINTMENT_BOOKED_PATIENT: "appointment-booked-patient",
  APPOINTMENT_BOOKED_DOCTOR: "appointment-booked-doctor",
  APPOINTMENT_CANCELLED_PATIENT: "appointment-cancelled-patient",
  APPOINTMENT_CANCELLED_DOCTOR: "appointment-cancelled-doctor",
} as const;

export type EmailTemplateName = (typeof EmailTemplate)[keyof typeof EmailTemplate];

export interface AppointmentBookedPayload {
  recipientName: string;
  counterpartName: string;
  specialisation: string;
  startsAtIso: string;
  timezone: string;
  reasonForVisit?: string;
}

export interface AppointmentCancelledPayload {
  recipientName: string;
  counterpartName: string;
  specialisation: string;
  startsAtIso: string;
  timezone: string;
  cancellationReason: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatWhen(startsAtIso: string, timezone: string): string {
  return DateTime.fromISO(startsAtIso, { zone: timezone }).toFormat("cccc, d LLLL yyyy 'at' h:mm a (ZZZZ)");
}

function paragraphsToHtml(lines: string[]): string {
  return lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("\n");
}

function renderAppointmentBooked(payload: AppointmentBookedPayload): RenderedEmail {
  const when = formatWhen(payload.startsAtIso, payload.timezone);
  const lines = [
    `Hi ${payload.recipientName},`,
    `An appointment with ${payload.counterpartName} (${payload.specialisation}) is confirmed for ${when}.`,
    ...(payload.reasonForVisit ? [`Reason for visit: ${payload.reasonForVisit}`] : []),
  ];
  return {
    subject: "Appointment confirmed",
    text: lines.join("\n\n"),
    html: paragraphsToHtml(lines),
  };
}

function renderAppointmentCancelled(payload: AppointmentCancelledPayload): RenderedEmail {
  const when = formatWhen(payload.startsAtIso, payload.timezone);
  const lines = [
    `Hi ${payload.recipientName},`,
    `The appointment with ${payload.counterpartName} (${payload.specialisation}) scheduled for ${when} has been cancelled.`,
    `Reason: ${payload.cancellationReason}`,
  ];
  return {
    subject: "Appointment cancelled",
    text: lines.join("\n\n"),
    html: paragraphsToHtml(lines),
  };
}

export function renderEmail(template: string, payload: unknown): RenderedEmail {
  switch (template) {
    case EmailTemplate.APPOINTMENT_BOOKED_PATIENT:
    case EmailTemplate.APPOINTMENT_BOOKED_DOCTOR:
      return renderAppointmentBooked(payload as AppointmentBookedPayload);
    case EmailTemplate.APPOINTMENT_CANCELLED_PATIENT:
    case EmailTemplate.APPOINTMENT_CANCELLED_DOCTOR:
      return renderAppointmentCancelled(payload as AppointmentCancelledPayload);
    default:
      throw new Error(`Unknown email template: ${template}`);
  }
}
