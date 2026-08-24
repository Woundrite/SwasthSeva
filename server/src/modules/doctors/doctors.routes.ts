import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { Role } from "../../generated/prisma/client";
import {
  createLeaveHandler,
  deleteLeaveHandler,
  getAvailabilityHandler,
  getOwnDoctorProfileHandler,
  listDoctorsHandler,
  listLeaveHandler,
  listWorkingHoursHandler,
  replaceWorkingHoursHandler,
} from "./doctors.controller";

export const doctorsRouter = Router();

doctorsRouter.use(authenticate);

doctorsRouter.get("/", listDoctorsHandler);
doctorsRouter.get("/me", authorize(Role.DOCTOR), getOwnDoctorProfileHandler);
doctorsRouter.get("/:doctorId/availability", getAvailabilityHandler);

// Schedule management: an admin, or the doctor themselves. Object-level
// ownership (does this doctor profile belong to the caller?) is enforced in
// the service layer, not just the role check here.
const scheduleManagers = authorize(Role.ADMIN, Role.DOCTOR);
doctorsRouter.get("/:doctorId/working-hours", scheduleManagers, listWorkingHoursHandler);
doctorsRouter.put("/:doctorId/working-hours", scheduleManagers, replaceWorkingHoursHandler);
doctorsRouter.get("/:doctorId/leave", scheduleManagers, listLeaveHandler);
doctorsRouter.post("/:doctorId/leave", scheduleManagers, createLeaveHandler);
doctorsRouter.delete("/:doctorId/leave/:leaveId", scheduleManagers, deleteLeaveHandler);
