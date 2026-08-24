import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { Role } from "../../generated/prisma/client";
import { createDoctorHandler, getDoctorHandler, listDoctorsHandler, updateDoctorHandler } from "./admin.controller";

export const adminRouter = Router();

adminRouter.use(authenticate, authorize(Role.ADMIN));

adminRouter.post("/doctors", createDoctorHandler);
adminRouter.get("/doctors", listDoctorsHandler);
adminRouter.get("/doctors/:doctorId", getDoctorHandler);
adminRouter.patch("/doctors/:doctorId", updateDoctorHandler);
