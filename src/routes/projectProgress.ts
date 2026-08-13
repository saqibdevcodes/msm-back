import { Router } from "express";

import {
  addMyProjectProgress,
  getMyProjectProgress,
  voidProjectProgressEntry,
} from "../controllers/projectProgress.ts";

import { adminMiddleware, authMiddleware } from "../middlewares/auth.ts";

const router = Router();

router.post(
  "/me/projects/:projectId/progress",
  authMiddleware,
  addMyProjectProgress,
);

router.get(
  "/me/projects/:projectId/progress",
  authMiddleware,
  getMyProjectProgress,
);

router.patch(
  "/progress/:entryId/void",
  authMiddleware,
  adminMiddleware,
  voidProjectProgressEntry,
);

export default router;
