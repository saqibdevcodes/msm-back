import { Router } from "express";

import { getAdminDashboard } from "../controllers/dashboard.ts";
import { adminMiddleware, authMiddleware } from "../middlewares/auth.ts";

const router = Router();

router.get("/admin", authMiddleware, adminMiddleware, getAdminDashboard);

export default router;
