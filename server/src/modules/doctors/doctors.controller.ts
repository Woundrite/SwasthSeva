import type { Request, Response } from "express";
import * as doctorsService from "./doctors.service";
import {
  availabilityQuerySchema,
  doctorIdParamSchema,
  leaveIdParamSchema,
  leaveSchema,
  replaceWorkingHoursSchema,
} from "./doctors.schemas";

export async function listDoctorsHandler(_req: Request, res: Response): Promise<void> {
  const doctors = await doctorsService.listActiveDoctors();
  res.status(200).json({ doctors });
}

export async function getOwnDoctorProfileHandler(req: Request, res: Response): Promise<void> {
  const doctor = await doctorsService.getOwnDoctorProfile(req.user!.sub);
  res.status(200).json({ doctor });
}

export async function getAvailabilityHandler(req: Request, res: Response): Promise<void> {
  const { doctorId } = doctorIdParamSchema.parse(req.params);
  const { date } = availabilityQuerySchema.parse(req.query);

  const availability = await doctorsService.getDoctorAvailability(doctorId, date);
  res.status(200).json(availability);
}

export async function listWorkingHoursHandler(req: Request, res: Response): Promise<void> {
  const { doctorId } = doctorIdParamSchema.parse(req.params);
  const workingHours = await doctorsService.listWorkingHours(req.user!, doctorId);
  res.status(200).json({ workingHours });
}

export async function replaceWorkingHoursHandler(req: Request, res: Response): Promise<void> {
  const { doctorId } = doctorIdParamSchema.parse(req.params);
  const input = replaceWorkingHoursSchema.parse(req.body);
  const workingHours = await doctorsService.replaceWorkingHours(req.user!, doctorId, input);
  res.status(200).json({ workingHours });
}

export async function listLeaveHandler(req: Request, res: Response): Promise<void> {
  const { doctorId } = doctorIdParamSchema.parse(req.params);
  const leave = await doctorsService.listLeave(req.user!, doctorId);
  res.status(200).json({ leave });
}

export async function createLeaveHandler(req: Request, res: Response): Promise<void> {
  const { doctorId } = doctorIdParamSchema.parse(req.params);
  const input = leaveSchema.parse(req.body);
  const leave = await doctorsService.createLeave(req.user!, doctorId, input);
  res.status(201).json({ leave });
}

export async function deleteLeaveHandler(req: Request, res: Response): Promise<void> {
  const { doctorId, leaveId } = leaveIdParamSchema.parse(req.params);
  await doctorsService.deleteLeave(req.user!, doctorId, leaveId);
  res.status(204).send();
}
