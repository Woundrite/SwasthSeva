import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { Role } from "../../generated/prisma/client";
import {
  bookHandler,
  cancelHandler,
  completeHandler,
  getDetailHandler,
  listHandler,
  submitPrescriptionHandler,
  submitSymptomIntakeHandler,
  submitVisitNoteHandler,
} from "./appointments.controller";

export const appointmentsRouter = Router();

appointmentsRouter.use(authenticate);

appointmentsRouter.post("/", authorize(Role.PATIENT), bookHandler);
appointmentsRouter.get("/", authorize(Role.PATIENT, Role.DOCTOR), listHandler);
appointmentsRouter.get("/:id", authorize(Role.PATIENT, Role.DOCTOR), getDetailHandler);
appointmentsRouter.post("/:id/cancel", authorize(Role.PATIENT), cancelHandler);
appointmentsRouter.post("/:id/symptom-intake", authorize(Role.PATIENT), submitSymptomIntakeHandler);
appointmentsRouter.post("/:id/visit-note", authorize(Role.DOCTOR), submitVisitNoteHandler);
appointmentsRouter.post("/:id/prescription", authorize(Role.DOCTOR), submitPrescriptionHandler);
appointmentsRouter.post("/:id/complete", authorize(Role.DOCTOR), completeHandler);
