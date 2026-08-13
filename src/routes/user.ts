import {
  assignProjectsToUsers,
  deleteUser,
  getUserById,
  getUsers,
  updateUser,
} from "../controllers/user.ts";

import { authMiddleware, adminMiddleware } from "../middlewares/auth.ts";

import { Router } from "express";
import {
  assignProjectsToUsersController,
  removeUserFromProjectController,
} from "../controllers/projectAssignment.ts";

const router = Router();

router.get("/", authMiddleware, getUsers);

router.post(
  "/assign-projects",
  authMiddleware,
  adminMiddleware,
  assignProjectsToUsers,
);

router.post(
  "/assign-projects",
  authMiddleware,
  adminMiddleware,
  assignProjectsToUsersController,
);

router.delete(
  "/:userId/projects/:projectId",
  authMiddleware,
  adminMiddleware,
  removeUserFromProjectController,
);

router.get("/:id", authMiddleware, getUserById);

router.put("/:id", authMiddleware, adminMiddleware, updateUser);

router.delete("/:id", authMiddleware, adminMiddleware, deleteUser);

export default router;
