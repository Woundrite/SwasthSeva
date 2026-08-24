import type { Request, Response } from "express";
import * as appointmentsService from "./appointments.service";
import {
  appointmentIdParamSchema,
  bookAppointmentSchema,
  prescriptionSchema,
  symptomIntakeSchema,
  visitNoteSchema,
} from "./appointments.schemas";

export async function bookHandler(req: Request, res: Response): Promise<void> {
  const input = bookAppointmentSchema.parse(req.body);
  const appointment = await appointmentsService.book(req.user!.sub, input);
  res.status(201).json({ appointment });
}

export async function listHandler(req: Request, res: Response): Promise<void> {
  const appointments = await appointmentsService.list(req.user!);
  res.status(200).json({ appointments });
}

export async function getDetailHandler(req: Request, res: Response): Promise<void> {
  const { id } = appointmentIdParamSchema.parse(req.params);
  const appointment = await appointmentsService.getDetail(req.user!, id);
  res.status(200).json({ appointment });
}

export async function cancelHandler(req: Request, res: Response): Promise<void> {
  const { id } = appointmentIdParamSchema.parse(req.params);
  const appointment = await appointmentsService.cancel(req.user!.sub, id);
  res.status(200).json({ appointment });
}

export async function submitSymptomIntakeHandler(req: Request, res: Response): Promise<void> {
  const { id } = appointmentIdParamSchema.parse(req.params);
  const input = symptomIntakeSchema.parse(req.body);
  const symptomIntake = await appointmentsService.submitSymptomIntake(req.user!.sub, id, input);
  res.status(200).json({ symptomIntake });
}

export async function submitVisitNoteHandler(req: Request, res: Response): Promise<void> {
  const { id } = appointmentIdParamSchema.parse(req.params);
  const input = visitNoteSchema.parse(req.body);
  const visitNote = await appointmentsService.submitVisitNote(req.user!.sub, id, input);
  res.status(200).json({ visitNote });
}

export async function submitPrescriptionHandler(req: Request, res: Response): Promise<void> {
  const { id } = appointmentIdParamSchema.parse(req.params);
  const input = prescriptionSchema.parse(req.body);
  const prescription = await appointmentsService.submitPrescription(req.user!.sub, id, input);
  res.status(200).json({ prescription });
}

export async function completeHandler(req: Request, res: Response): Promise<void> {
  const { id } = appointmentIdParamSchema.parse(req.params);
  const appointment = await appointmentsService.complete(req.user!.sub, id);
  res.status(200).json({ appointment });
}
