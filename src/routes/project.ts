import { Router } from "express";
import {
  getProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
  assignUsersToProjects,
} from "../controllers/project.ts";

import { authMiddleware, adminMiddleware } from "../middlewares/auth.ts";
import {
  assignUsersToProjectsController,
  removeUserFromProjectController,
} from "../controllers/projectAssignment.ts";

const router = Router();

router.get("/", authMiddleware, getProjects);

/*
 * Keep this static route before "/:id".
 */
router.post(
  "/assign-users",
  authMiddleware,
  adminMiddleware,
  assignUsersToProjects,
);

router.post(
  "/assign-users",
  authMiddleware,
  adminMiddleware,
  assignUsersToProjectsController,
);

router.delete(
  "/:projectId/users/:userId",
  authMiddleware,
  adminMiddleware,
  removeUserFromProjectController,
);

router.get("/:id", authMiddleware, getProjectById);
router.post("/", authMiddleware, adminMiddleware, createProject);
router.put("/:id", authMiddleware, adminMiddleware, updateProject);
router.delete("/:id", authMiddleware, adminMiddleware, deleteProject);

export default router;
