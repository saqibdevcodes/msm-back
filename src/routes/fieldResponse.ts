import { Router } from "express";

import {
  createFieldResponse,
  deleteFieldResponse,
  getFieldResponseById,
  getFieldResponsesByProjectId,
  updateFieldResponse,
} from "../controllers/fieldResponse.ts";

import { exportFieldResponsesExcel } from "../controllers/fieldResponseExport.ts";
import { adminMiddleware, authMiddleware } from "../middlewares/auth.ts";

const router = Router();

/*
 * Static export route must remain above /:id.
 */
router.get(
  "/export/excel",
  authMiddleware,
  adminMiddleware,
  exportFieldResponsesExcel,
);

router.get("/project/:projectId", authMiddleware, getFieldResponsesByProjectId);

router.get("/:id", authMiddleware, getFieldResponseById);

router.post(
  "/project/:projectId",
  authMiddleware,
  adminMiddleware,
  createFieldResponse,
);

router.put("/:id", authMiddleware, adminMiddleware, updateFieldResponse);

router.delete("/:id", authMiddleware, adminMiddleware, deleteFieldResponse);

export default router;
