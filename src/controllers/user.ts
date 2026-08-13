import type { Request, Response } from "express";
import { prisma } from "../lib/prisma.ts";
import { transporter } from "../utils/mail.ts";
import {
  deleteUserEmail,
  updateUserEmail,
  updateUserStatusEmail,
} from "../services/user.ts";

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

const ALLOWED_ROLES = ["admin", "user", "field"] as const;

type UserRole = (typeof ALLOWED_ROLES)[number];
type UserStatus = "active" | "inactive";
type SortOrder = "asc" | "desc";

const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
};

const parsePositiveInteger = (
  value: unknown,
  fallback: number,
  maximum?: number,
) => {
  const parsedValue = Number.parseInt(String(value), 10);

  if (!Number.isFinite(parsedValue) || parsedValue < 1) {
    return fallback;
  }

  return maximum ? Math.min(parsedValue, maximum) : parsedValue;
};

const normalizeRole = (value: unknown): UserRole | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalizedValue = value.trim().toLowerCase();

  return ALLOWED_ROLES.find((role) => role === normalizedValue);
};

const parseStatus = (value: unknown): UserStatus | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalizedValue = value.trim().toLowerCase();

  if (normalizedValue === "active") {
    return "active";
  }

  if (normalizedValue === "inactive") {
    return "inactive";
  }

  return undefined;
};

const isPrismaNotFoundError = (error: unknown): boolean => {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2025"
  );
};
export const getUsers = async (req: Request, res: Response) => {
  try {
    const page = parsePositiveInteger(req.query.page, DEFAULT_PAGE);

    const limit = parsePositiveInteger(
      req.query.limit,
      DEFAULT_LIMIT,
      MAX_LIMIT,
    );

    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";

    const name =
      typeof req.query.name === "string" ? req.query.name.trim() : "";

    const email =
      typeof req.query.email === "string" ? req.query.email.trim() : "";

    const status =
      typeof req.query.status === "string"
        ? req.query.status.trim().toLowerCase()
        : "";

    const role =
      typeof req.query.role === "string"
        ? req.query.role.trim().toLowerCase()
        : "";

    const requestedSortBy =
      typeof req.query.sortBy === "string" ? req.query.sortBy : "id";

    const sortOrder: SortOrder = req.query.sortOrder === "asc" ? "asc" : "desc";

    const sortableFields: Record<string, string> = {
      id: "id",
      name: "name",
      email: "email",
      role: "role",
      status: "status",
    };

    const sortBy = sortableFields[requestedSortBy] ?? "id";
    const skip = (page - 1) * limit;

    const andConditions: any[] = [];

    /**
     * Global search:
     * Searches name, email, status and role.
     */
    if (search) {
      const globalSearchConditions: any[] = [
        {
          name: {
            contains: search,
          },
        },
        {
          email: {
            contains: search,
          },
        },
      ];

      const searchedStatus = parseStatus(search);

      if (searchedStatus !== undefined) {
        globalSearchConditions.push({
          status: searchedStatus,
        });
      }

      const searchedRole = normalizeRole(search);

      if (searchedRole) {
        globalSearchConditions.push({
          role: searchedRole,
        });
      }

      andConditions.push({
        OR: globalSearchConditions,
      });
    }

    /**
     * Separate name filter.
     */
    if (name) {
      andConditions.push({
        name: {
          contains: name,
        },
      });
    }

    /**
     * Separate email filter.
     */
    if (email) {
      andConditions.push({
        email: {
          contains: email,
        },
      });
    }

    /**
     * Separate status filter.
     */
    if (status) {
      const parsedStatus = parseStatus(status);

      if (parsedStatus === undefined) {
        return res.status(400).json({
          success: false,
          error: 'Invalid status. Use "active" or "inactive".',
        });
      }

      andConditions.push({
        status: parsedStatus,
      });
    }

    /**
     * Separate role filter.
     */
    if (role) {
      const parsedRole = normalizeRole(role);

      if (!parsedRole) {
        return res.status(400).json({
          success: false,
          error: `Invalid role. Allowed roles: ${ALLOWED_ROLES.join(", ")}.`,
        });
      }

      andConditions.push({
        role: parsedRole,
      });
    }

    const where: any =
      andConditions.length > 0
        ? {
            AND: andConditions,
          }
        : {};

    const orderBy: any = {
      [sortBy]: sortOrder,
    };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: publicUserSelect,
      }),

      prisma.user.count({
        where,
      }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return res.status(200).json({
      success: true,
      message: "Users retrieved successfully",
      data: {
        users,
        pagination: {
          total,
          page,
          limit,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      },
    });
  } catch (error) {
    console.error("Error retrieving users:", error);

    return res.status(500).json({
      success: false,
      error: "Failed to retrieve users",
    });
  }
};

export const getUserById = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };

  try {
    const user = await prisma.user.findUnique({
      where: { id },
      select: publicUserSelect,
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "User retrieved successfully",
      data: user,
    });
  } catch (error) {
    console.error("Error retrieving user:", error);

    return res.status(500).json({
      success: false,
      error: "Failed to retrieve user",
    });
  }
};

export const deleteUser = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };

  try {
    const user = await prisma.user.delete({
      where: { id },
      select: publicUserSelect,
    });

    const name = user.name || "User";

    void transporter
      .sendMail(deleteUserEmail(name, user.email))
      .catch((emailError) => {
        console.error("Delete user email failed:", emailError);
      });

    return res.status(200).json({
      success: true,
      message: "User deleted successfully",
      data: user,
    });
  } catch (error) {
    console.error("Error deleting user:", error);

    if (isPrismaNotFoundError(error)) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    return res.status(500).json({
      success: false,
      error: "Failed to delete user",
    });
  }
};

export const updateUser = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };

  const { name, email, role, status } = req.body as {
    name?: string;
    email?: string;
    role?: UserRole;
    status?: UserStatus;
  };

  try {
    const updateData: any = {};

    if (typeof name === "string" && name.trim()) {
      updateData.name = name.trim();
    }

    if (typeof email === "string" && email.trim()) {
      updateData.email = email.trim().toLowerCase();
    }

    if (role !== undefined) {
      const parsedRole = normalizeRole(role);

      if (!parsedRole) {
        return res.status(400).json({
          success: false,
          error: `Invalid role. Allowed roles: ${ALLOWED_ROLES.join(", ")}.`,
        });
      }

      updateData.role = parsedRole;
    }

    if (status !== undefined) {
      const parsedStatus = parseStatus(status);

      if (parsedStatus === undefined) {
        return res.status(400).json({
          success: false,
          error: 'Invalid status. Use "active" or "inactive".',
        });
      }

      updateData.status = parsedStatus;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        error: "No valid fields were provided for update.",
      });
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: publicUserSelect,
    });

    const userName = user.name || "User";

    void transporter
      .sendMail(updateUserEmail(userName, user.email))
      .catch((emailError) => {
        console.error("Update user email failed:", emailError);
      });

    return res.status(200).json({
      success: true,
      message: "User updated successfully",
      data: user,
    });
  } catch (error) {
    console.error("Error updating user:", error);

    if (isPrismaNotFoundError(error)) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    return res.status(500).json({
      success: false,
      error: "Failed to update user",
    });
  }
};

export const changeUserStatus = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const { status } = req.body as {
    status?: "active" | "inactive";
  };

  if (status !== "active" && status !== "inactive") {
    return res.status(400).json({
      success: false,
      error: 'Status must be either "active" or "inactive".',
    });
  }

  try {
    const user = await prisma.user.update({
      where: { id },
      data: { status },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: "User status updated successfully",
      data: user,
    });
  } catch (error) {
    console.error("Error updating user status:", error);

    return res.status(500).json({
      success: false,
      error: "Failed to update user status",
    });
  }
};

export const assignProjectsToUsers = async (req: Request, res: Response) => {
  try {
    const {
      userIds,
      projectIds,
      replaceExisting = false,
    } = req.body as {
      userIds?: string[];
      projectIds?: string[];
      replaceExisting?: boolean;
    };

    const normalizedUserIds = Array.from(
      new Set(
        Array.isArray(userIds)
          ? userIds.filter(
              (id): id is string =>
                typeof id === "string" && Boolean(id.trim()),
            )
          : [],
      ),
    );

    const normalizedProjectIds = Array.from(
      new Set(
        Array.isArray(projectIds)
          ? projectIds.filter(
              (id): id is string =>
                typeof id === "string" && Boolean(id.trim()),
            )
          : [],
      ),
    );

    if (normalizedUserIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Select at least one user.",
      });
    }

    /*
     * An empty projectIds array is permitted only when
     * replaceExisting=true. This allows removing every
     * project from the selected users.
     */
    if (normalizedProjectIds.length === 0 && !replaceExisting) {
      return res.status(400).json({
        success: false,
        error: "Select at least one project.",
      });
    }

    const [users, projects] = await Promise.all([
      prisma.user.findMany({
        where: {
          id: {
            in: normalizedUserIds,
          },
          status: "active",
        },
        select: {
          id: true,
          name: true,
          email: true,
        },
      }),

      prisma.project.findMany({
        where: {
          id: {
            in: normalizedProjectIds,
          },
        },
        select: {
          id: true,
          name: true,
        },
      }),
    ]);

    if (users.length !== normalizedUserIds.length) {
      return res.status(400).json({
        success: false,
        error: "One or more selected users do not exist or are inactive.",
      });
    }

    if (projects.length !== normalizedProjectIds.length) {
      return res.status(400).json({
        success: false,
        error: "One or more selected projects do not exist.",
      });
    }

    await prisma.$transaction(async (tx) => {
      if (replaceExisting) {
        /*
         * Only remove assignments belonging to the
         * selected users. Other users assigned to these
         * projects remain unchanged.
         */
        await tx.projectUser.deleteMany({
          where: {
            userId: {
              in: normalizedUserIds,
            },
          },
        });
      }

      if (normalizedProjectIds.length > 0) {
        await tx.projectUser.createMany({
          data: normalizedUserIds.flatMap((userId) =>
            normalizedProjectIds.map((projectId) => ({
              userId,
              projectId,
            })),
          ),
          skipDuplicates: true,
        });
      }
    });

    const updatedUsers = await prisma.user.findMany({
      where: {
        id: {
          in: normalizedUserIds,
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        projects: {
          select: {
            id: true,
            assignedAt: true,
            project: {
              select: {
                id: true,
                name: true,
                deadline: true,
                target: true,
                received: true,
                completed: true,
              },
            },
          },
          orderBy: {
            assignedAt: "desc",
          },
        },
      },
    });

    return res.status(200).json({
      success: true,
      message: replaceExisting
        ? "User project assignments replaced successfully"
        : "Projects assigned successfully",
      data: updatedUsers,
    });
  } catch (error) {
    console.error("Error assigning projects to users:", error);

    return res.status(500).json({
      success: false,
      error: "Failed to assign projects to users.",
    });
  }
};
