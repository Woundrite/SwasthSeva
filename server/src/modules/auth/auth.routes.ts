import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { loginHandler, logoutHandler, meHandler, refreshHandler, registerHandler } from "./auth.controller";

export const authRouter = Router();

authRouter.post("/register", registerHandler);
authRouter.post("/login", loginHandler);
authRouter.post("/refresh", refreshHandler);
authRouter.post("/logout", logoutHandler);
authRouter.get("/me", authenticate, meHandler);
