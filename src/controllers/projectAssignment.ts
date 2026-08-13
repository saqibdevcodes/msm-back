import type { Request, Response } from "express";

import {
  AssignmentServiceError,
  assignProjectsToUsers,
  assignUsersToProjects,
  removeUserFromProject,
} from "../services/projectAssignment.ts";

const parseBoolean = (value: unknown) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value.trim().toLowerCase() === "true";
  }

  return false;
};

const handleAssignmentError = (error: unknown, res: Response) => {
  console.error("Project assignment error:", error);

  if (error instanceof AssignmentServiceError) {
    return res.status(error.statusCode).json({
      success: false,
      error: error.message,
    });
  }

  return res.status(500).json({
    success: false,
    error: "Failed to update project assignments.",
  });
};

export const assignUsersToProjectsController = async (
  req: Request,
  res: Response,
) => {
  try {
    const result = await assignUsersToProjects({
      rawProjectIds: req.body.projectIds,

      rawUserIds: req.body.userIds,

      replaceExisting: parseBoolean(req.body.replaceExisting),
    });

    return res.status(200).json({
      success: true,

      message: "Project assignments updated successfully.",

      data: result,
    });
  } catch (error) {
    return handleAssignmentError(error, res);
  }
};

export const assignProjectsToUsersController = async (
  req: Request,
  res: Response,
) => {
  try {
    const result = await assignProjectsToUsers({
      rawUserIds: req.body.userIds,

      rawProjectIds: req.body.projectIds,

      replaceExisting: parseBoolean(req.body.replaceExisting),
    });

    return res.status(200).json({
      success: true,

      message: "User project assignments updated successfully.",

      data: result,
    });
  } catch (error) {
    return handleAssignmentError(error, res);
  }
};

export const removeUserFromProjectController = async (
  req: Request,
  res: Response,
) => {
  try {
    const { projectId, userId } = req.params as {
      projectId: string;
      userId: string;
    };

    const result = await removeUserFromProject({
      projectId,
      userId,
    });

    return res.status(200).json({
      success: true,

      message: "User removed from project successfully.",

      data: result,
    });
  } catch (error) {
    return handleAssignmentError(error, res);
  }
};
