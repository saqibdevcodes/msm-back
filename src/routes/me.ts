import { Router } from "express";
import { getMyWorkspace } from "../controllers/me.ts";
import { authMiddleware } from "../middlewares/auth.ts";

const router = Router();

router.get("/workspace", authMiddleware, getMyWorkspace);

export default router;
