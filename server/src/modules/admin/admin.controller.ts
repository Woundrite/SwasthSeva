import type { Request, Response } from "express";
import { doctorIdParamSchema } from "../doctors/doctors.schemas";
import * as adminService from "./admin.service";
import { createDoctorSchema, updateDoctorSchema } from "./admin.schemas";

export async function createDoctorHandler(req: Request, res: Response): Promise<void> {
  const input = createDoctorSchema.parse(req.body);
  const doctor = await adminService.createDoctor(input);
  res.status(201).json({ doctor });
}

export async function listDoctorsHandler(_req: Request, res: Response): Promise<void> {
  const doctors = await adminService.listDoctors();
  res.status(200).json({ doctors });
}

export async function getDoctorHandler(req: Request, res: Response): Promise<void> {
  const { doctorId } = doctorIdParamSchema.parse(req.params);
  const doctor = await adminService.getDoctor(doctorId);
  res.status(200).json({ doctor });
}

export async function updateDoctorHandler(req: Request, res: Response): Promise<void> {
  const { doctorId } = doctorIdParamSchema.parse(req.params);
  const input = updateDoctorSchema.parse(req.body);
  const doctor = await adminService.updateDoctor(doctorId, input);
  res.status(200).json({ doctor });
}
