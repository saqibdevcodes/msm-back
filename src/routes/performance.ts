import { Router } from "express";

import {
  createPerformanceEvaluation,
  createPerformanceQuestion,
  getPerformanceEvaluationsByProject,
  getPerformanceEvaluationsByUser,
  getPerformanceQuestions,
} from "../controllers/performance.ts";

import { exportPerformanceExcel } from "../controllers/performanceExport.ts";

import { adminMiddleware, authMiddleware } from "../middlewares/auth.ts";

const router = Router();

router.get(
  "/export/excel",
  authMiddleware,
  adminMiddleware,
  exportPerformanceExcel,
);

router.get("/questions", authMiddleware, getPerformanceQuestions);

router.post(
  "/questions",
  authMiddleware,
  adminMiddleware,
  createPerformanceQuestion,
);

router.post(
  "/evaluations",
  authMiddleware,
  adminMiddleware,
  createPerformanceEvaluation,
);

router.get(
  "/evaluations/project/:projectId",
  authMiddleware,
  getPerformanceEvaluationsByProject,
);

router.get(
  "/evaluations/user/:userId",
  authMiddleware,
  getPerformanceEvaluationsByUser,
);

export default router;
