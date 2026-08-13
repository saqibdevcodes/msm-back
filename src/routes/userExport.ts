import { Router } from "express";

import { exportUsersExcel } from "../controllers/userExport.ts";
import { adminMiddleware, authMiddleware } from "../middlewares/auth.ts";

const router = Router();

/*
 * Mount this router at /users BEFORE a router containing /:id routes.
 * Final endpoint: GET /users/export/excel
 */
router.get("/export/excel", authMiddleware, adminMiddleware, exportUsersExcel);

export default router;
