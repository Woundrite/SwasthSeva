import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { callbackHandler, connectHandler, disconnectHandler, statusHandler } from "./google.controller";

export const googleRouter = Router();

// Hit by a full browser navigation from Google, before we can know who's
// making the request — no Authorization header will be present.
googleRouter.get("/callback", callbackHandler);

googleRouter.use(authenticate);
googleRouter.get("/connect", connectHandler);
googleRouter.get("/status", statusHandler);
googleRouter.delete("/", disconnectHandler);
