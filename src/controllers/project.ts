import type { Request, Response } from "express";
import { prisma } from "../lib/prisma.ts";
import { assignUsersToProjects as syncProjectAssignments } from "../services/projectAssignment.ts";

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

type SortOrder = "asc" | "desc";
type ProgressStatus = "not_started" | "in_progress" | "completed";

const projectInclude = {
  users: {
    orderBy: {
      assignedAt: "asc" as const,
    },
    select: {
      id: true,
      assignedAt: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          status: true,
        },
      },
    },
  },
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

const parseBooleanFilter = (value: unknown): boolean | undefined => {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }

  const normalizedValue = value.trim().toLowerCase();

  if (normalizedValue === "true") {
    return true;
  }

  if (normalizedValue === "false") {
    return false;
  }

  return undefined;
};

const parseProgressStatus = (value: unknown): ProgressStatus | undefined => {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const normalizedValue = value.trim().toLowerCase();

  if (
    normalizedValue === "not_started" ||
    normalizedValue === "in_progress" ||
    normalizedValue === "completed"
  ) {
    return normalizedValue;
  }

  return undefined;
};

const parseBodyBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }

  return fallback;
};

const parseDate = (value: unknown, endOfDay = false): Date | undefined => {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const date = new Date(
    endOfDay
      ? `${value.trim()}T23:59:59.999Z`
      : `${value.trim()}T00:00:00.000Z`,
  );

  return Number.isNaN(date.getTime()) ? undefined : date;
};

const normalizeIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      ),
    ),
  ];
};

const parseNonNegativeInteger = (
  value: unknown,
  fieldName: string,
): { value?: number; error?: string } => {
  const parsedValue = Number(value ?? 0);

  if (
    !Number.isFinite(parsedValue) ||
    parsedValue < 0 ||
    !Number.isInteger(parsedValue)
  ) {
    return {
      error: `${fieldName} must be a non-negative integer.`,
    };
  }

  return {
    value: parsedValue,
  };
};

const validateAssignableUsers = async (
  userIds: string[],
): Promise<{ valid: boolean; invalidUserIds: string[] }> => {
  if (userIds.length === 0) {
    return {
      valid: true,
      invalidUserIds: [],
    };
  }

  const users = await prisma.user.findMany({
    where: {
      id: {
        in: userIds,
      },
      status: "active",
    },
    select: {
      id: true,
    },
  });

  const existingIds = new Set(users.map((user) => user.id));

  return {
    valid: existingIds.size === userIds.length,
    invalidUserIds: userIds.filter((id) => !existingIds.has(id)),
  };
};

export const getProjects = async (req: Request, res: Response) => {
  try {
    const page = parsePositiveInteger(req.query.page, DEFAULT_PAGE);

    const limit = parsePositiveInteger(
      req.query.limit,
      DEFAULT_LIMIT,
      MAX_LIMIT,
    );

    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";

    const progressStatusQuery =
      typeof req.query.progressStatus === "string"
        ? req.query.progressStatus.trim()
        : "";

    const competitionQuery =
      typeof req.query.competition === "string"
        ? req.query.competition.trim()
        : "";

    const assignedUserId =
      typeof req.query.assignedUserId === "string"
        ? req.query.assignedUserId.trim()
        : "";

    const deadlineFromQuery =
      typeof req.query.deadlineFrom === "string"
        ? req.query.deadlineFrom.trim()
        : "";

    const deadlineToQuery =
      typeof req.query.deadlineTo === "string"
        ? req.query.deadlineTo.trim()
        : "";

    const requestedSortBy =
      typeof req.query.sortBy === "string" ? req.query.sortBy : "id";

    const sortOrder: SortOrder = req.query.sortOrder === "asc" ? "asc" : "desc";

    const exportAll = req.query.all === "true";

    const sortableFields: Record<string, string> = {
      id: "id",
      name: "name",
      deadline: "deadline",
      target: "target",
      received: "received",
      completed: "completed",
      competition: "competition",
      competitionTarget: "competitionTarget",
      competitionReceived: "competitionReceived",
      competitionCompleted: "competitionCompleted",
      createdAt: "createdAt",
      updatedAt: "updatedAt",
    };

    const sortBy = sortableFields[requestedSortBy] ?? "id";
    const skip = (page - 1) * limit;

    const andConditions: any[] = [];

    /*
     * PostgreSQL search is made explicitly case-insensitive.
     * It searches project fields and assigned-user fields.
     */
    if (search) {
      andConditions.push({
        OR: [
          {
            name: {
              contains: search,
              mode: "insensitive",
            },
          },
          {
            description: {
              contains: search,
              mode: "insensitive",
            },
          },
          {
            users: {
              some: {
                user: {
                  OR: [
                    {
                      name: {
                        contains: search,
                        mode: "insensitive",
                      },
                    },
                    {
                      email: {
                        contains: search,
                        mode: "insensitive",
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      });
    }

    if (progressStatusQuery !== "") {
      const progressStatus = parseProgressStatus(progressStatusQuery);

      if (!progressStatus) {
        return res.status(400).json({
          success: false,
          error:
            'Invalid progressStatus. Use "not_started", "in_progress", or "completed".',
        });
      }

      if (progressStatus === "not_started") {
        andConditions.push({
          completed: 0,
        });
      }

      if (progressStatus === "in_progress") {
        andConditions.push({
          completed: {
            gt: 0,
            lt: prisma.project.fields.target,
          },
        });
      }

      if (progressStatus === "completed") {
        andConditions.push({
          target: {
            gt: 0,
          },
          completed: {
            gte: prisma.project.fields.target,
          },
        });
      }
    }

    if (competitionQuery !== "") {
      const competition = parseBooleanFilter(competitionQuery);

      if (competition === undefined) {
        return res.status(400).json({
          success: false,
          error: 'Invalid competition filter. Use "true" or "false".',
        });
      }

      andConditions.push({
        competition,
      });
    }

    if (assignedUserId) {
      andConditions.push({
        users: {
          some: {
            userId: assignedUserId,
          },
        },
      });
    }

    const deadlineFrom = parseDate(deadlineFromQuery);
    const deadlineTo = parseDate(deadlineToQuery, true);

    if (deadlineFromQuery && !deadlineFrom) {
      return res.status(400).json({
        success: false,
        error: "Invalid deadlineFrom date.",
      });
    }

    if (deadlineToQuery && !deadlineTo) {
      return res.status(400).json({
        success: false,
        error: "Invalid deadlineTo date.",
      });
    }

    if (
      deadlineFrom &&
      deadlineTo &&
      deadlineFrom.getTime() > deadlineTo.getTime()
    ) {
      return res.status(400).json({
        success: false,
        error: "deadlineFrom cannot be later than deadlineTo.",
      });
    }

    if (deadlineFrom || deadlineTo) {
      andConditions.push({
        deadline: {
          ...(deadlineFrom ? { gte: deadlineFrom } : {}),
          ...(deadlineTo ? { lte: deadlineTo } : {}),
        },
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

    const [projects, total] = await Promise.all([
      prisma.project.findMany({
        where,
        orderBy,
        include: projectInclude,
        ...(exportAll
          ? {}
          : {
              skip,
              take: limit,
            }),
      }),

      prisma.project.count({
        where,
      }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return res.status(200).json({
      success: true,
      message: "Projects retrieved successfully",
      data: projects,
      meta: {
        total,
        page: exportAll ? 1 : page,
        limit: exportAll ? projects.length : limit,
        totalPages: exportAll ? (total > 0 ? 1 : 0) : totalPages,
        hasNextPage: exportAll ? false : page < totalPages,
        hasPreviousPage: exportAll ? false : page > 1,
      },
    });
  } catch (error) {
    console.error("Error retrieving projects:", error);

    return res.status(500).json({
      success: false,
      error: "Failed to retrieve projects",
    });
  }
};

export const getProjectById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };

    const project = await prisma.project.findUnique({
      where: { id },
      include: projectInclude,
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        error: "Project not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Project retrieved successfully",
      data: project,
    });
  } catch (error) {
    console.error("Error retrieving project:", error);

    return res.status(500).json({
      success: false,
      error: "Failed to retrieve project",
    });
  }
};

export const createProject = async (req: Request, res: Response) => {
  try {
    const {
      name,
      deadline,
      description,
      target,
      received,
      completed,
      competition,
      competitionTarget,
      competitionReceived,
      competitionCompleted,
      userIds,
    } = req.body;

    if (typeof name !== "string" || !name.trim() || !deadline) {
      return res.status(400).json({
        success: false,
        error: "Name and deadline are required.",
      });
    }

    const parsedDeadline = new Date(deadline);

    if (Number.isNaN(parsedDeadline.getTime())) {
      return res.status(400).json({
        success: false,
        error: "A valid deadline is required.",
      });
    }

    const targetResult = parseNonNegativeInteger(target, "Target");

    const receivedResult = parseNonNegativeInteger(received, "Received");

    const completedResult = parseNonNegativeInteger(completed, "Completed");

    if (targetResult.error || receivedResult.error || completedResult.error) {
      return res.status(400).json({
        success: false,
        error:
          targetResult.error || receivedResult.error || completedResult.error,
      });
    }

    if ((completedResult.value ?? 0) > (receivedResult.value ?? 0)) {
      return res.status(400).json({
        success: false,
        error: "Completed reports cannot be greater than received reports.",
      });
    }

    const hasCompetition = parseBodyBoolean(competition);
    const competitionTargetResult = parseNonNegativeInteger(
      hasCompetition ? competitionTarget : 0,
      "Competition target",
    );

    const competitionReceivedResult = parseNonNegativeInteger(
      hasCompetition ? competitionReceived : 0,
      "Competition received",
    );

    const competitionCompletedResult = parseNonNegativeInteger(
      hasCompetition ? competitionCompleted : 0,
      "Competition completed",
    );

    if (
      competitionTargetResult.error ||
      competitionReceivedResult.error ||
      competitionCompletedResult.error
    ) {
      return res.status(400).json({
        success: false,
        error:
          competitionTargetResult.error ||
          competitionReceivedResult.error ||
          competitionCompletedResult.error,
      });
    }

    if (
      hasCompetition &&
      (competitionCompletedResult.value ?? 0) >
        (competitionReceivedResult.value ?? 0)
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Competition completed reports cannot be greater than competition received reports.",
      });
    }

    const normalizedUserIds = normalizeIds(userIds);
    const userValidation = await validateAssignableUsers(normalizedUserIds);

    if (!userValidation.valid) {
      return res.status(400).json({
        success: false,
        error: "One or more selected users do not exist or are inactive.",
        invalidUserIds: userValidation.invalidUserIds,
      });
    }

    const existingProject = await prisma.project.findUnique({
      where: {
        name: name.trim(),
      },
      select: {
        id: true,
      },
    });

    if (existingProject) {
      return res.status(409).json({
        success: false,
        error: "Project already exists.",
      });
    }

    const project = await prisma.project.create({
      data: {
        name: name.trim(),
        deadline: parsedDeadline,
        description:
          typeof description === "string" && description.trim()
            ? description.trim()
            : null,
        target: targetResult.value ?? 0,
        received: receivedResult.value ?? 0,
        completed: completedResult.value ?? 0,
        competition: hasCompetition,
        competitionTarget: hasCompetition
          ? (competitionTargetResult.value ?? 0)
          : 0,
        competitionReceived: hasCompetition
          ? (competitionReceivedResult.value ?? 0)
          : 0,
        competitionCompleted: hasCompetition
          ? (competitionCompletedResult.value ?? 0)
          : 0,
        users:
          normalizedUserIds.length > 0
            ? {
                createMany: {
                  data: normalizedUserIds.map((userId) => ({
                    userId,
                  })),
                  skipDuplicates: true,
                },
              }
            : undefined,
      },
      include: projectInclude,
    });

    return res.status(201).json({
      success: true,
      message: "Project created successfully",
      data: project,
    });
  } catch (error) {
    console.error("Error creating project:", error);

    return res.status(500).json({
      success: false,
      error: "Failed to create project",
    });
  }
};

export const updateProject = async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };

    const {
      name,
      deadline,
      description,
      target,
      received,
      completed,
      competition,
      competitionTarget,
      competitionReceived,
      competitionCompleted,
      userIds,
    } = req.body;

    const existingProject = await prisma.project.findUnique({
      where: { id },
      select: {
        id: true,
      },
    });

    if (!existingProject) {
      return res.status(404).json({
        success: false,
        error: "Project not found.",
      });
    }

    if (typeof name !== "string" || !name.trim() || !deadline) {
      return res.status(400).json({
        success: false,
        error: "Name and deadline are required.",
      });
    }

    const parsedDeadline = new Date(deadline);

    if (Number.isNaN(parsedDeadline.getTime())) {
      return res.status(400).json({
        success: false,
        error: "A valid deadline is required.",
      });
    }

    const targetResult = parseNonNegativeInteger(target, "Target");

    const receivedResult = parseNonNegativeInteger(received, "Received");

    const completedResult = parseNonNegativeInteger(completed, "Completed");

    if (targetResult.error || receivedResult.error || completedResult.error) {
      return res.status(400).json({
        success: false,
        error:
          targetResult.error || receivedResult.error || completedResult.error,
      });
    }

    if ((completedResult.value ?? 0) > (receivedResult.value ?? 0)) {
      return res.status(400).json({
        success: false,
        error: "Completed reports cannot be greater than received reports.",
      });
    }

    const hasCompetition = parseBodyBoolean(competition);

    const competitionTargetResult = parseNonNegativeInteger(
      hasCompetition ? competitionTarget : 0,
      "Competition target",
    );

    const competitionReceivedResult = parseNonNegativeInteger(
      hasCompetition ? competitionReceived : 0,
      "Competition received",
    );

    const competitionCompletedResult = parseNonNegativeInteger(
      hasCompetition ? competitionCompleted : 0,
      "Competition completed",
    );

    if (
      competitionTargetResult.error ||
      competitionReceivedResult.error ||
      competitionCompletedResult.error
    ) {
      return res.status(400).json({
        success: false,
        error:
          competitionTargetResult.error ||
          competitionReceivedResult.error ||
          competitionCompletedResult.error,
      });
    }

    if (
      hasCompetition &&
      (competitionCompletedResult.value ?? 0) >
        (competitionReceivedResult.value ?? 0)
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Competition completed reports cannot be greater than competition received reports.",
      });
    }

    const userIdsWereProvided = Array.isArray(userIds);
    const normalizedUserIds = normalizeIds(userIds);

    if (userIdsWereProvided) {
      const userValidation = await validateAssignableUsers(normalizedUserIds);

      if (!userValidation.valid) {
        return res.status(400).json({
          success: false,
          error: "One or more selected users do not exist or are inactive.",
          invalidUserIds: userValidation.invalidUserIds,
        });
      }
    }

    await prisma.project.update({
      where: {
        id,
      },

      data: {
        name: name.trim(),
        deadline: parsedDeadline,

        description:
          typeof description === "string" && description.trim()
            ? description.trim()
            : null,

        target: targetResult.value ?? 0,

        received: receivedResult.value ?? 0,

        completed: completedResult.value ?? 0,

        competition: hasCompetition,

        competitionTarget: hasCompetition
          ? (competitionTargetResult.value ?? 0)
          : 0,

        competitionReceived: hasCompetition
          ? (competitionReceivedResult.value ?? 0)
          : 0,

        competitionCompleted: hasCompetition
          ? (competitionCompletedResult.value ?? 0)
          : 0,
      },
    });

    let assignmentResult: Awaited<
      ReturnType<typeof syncProjectAssignments>
    > | null = null;

    /*
     * userIdsWereProvided tells us that the
     * frontend sent the project assignment list.
     */
    if (userIdsWereProvided) {
      assignmentResult = await syncProjectAssignments({
        rawProjectIds: [id],

        rawUserIds: normalizedUserIds,

        /*
         * The selected user list becomes the
         * complete assignment list for this project.
         */
        replaceExisting: true,
      });
    }

    /*
     * Load the latest project after assignments
     * have been updated.
     */
    const project = await prisma.project.findUnique({
      where: {
        id,
      },

      include: projectInclude,
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        error: "Project was updated but could not be retrieved.",
      });
    }

    return res.status(200).json({
      success: true,

      message: "Project updated successfully",

      data: project,

      assignment: assignmentResult,
    });
  } catch (error) {
    console.error("Error updating project:", error);

    return res.status(500).json({
      success: false,
      error: "Failed to update project",
    });
  }
};

export const assignUsersToProjects = async (req: Request, res: Response) => {
  try {
    const projectIds = normalizeIds(req.body.projectIds);
    const userIds = normalizeIds(req.body.userIds);
    const replaceExisting = parseBodyBoolean(req.body.replaceExisting);

    if (projectIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Select at least one project.",
      });
    }

    if (userIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Select at least one user.",
      });
    }

    const [projects, userValidation] = await Promise.all([
      prisma.project.findMany({
        where: {
          id: {
            in: projectIds,
          },
        },
        select: {
          id: true,
        },
      }),

      validateAssignableUsers(userIds),
    ]);

    const existingProjectIds = new Set(projects.map((project) => project.id));

    const invalidProjectIds = projectIds.filter(
      (id) => !existingProjectIds.has(id),
    );

    if (invalidProjectIds.length > 0) {
      return res.status(400).json({
        success: false,
        error: "One or more selected projects do not exist.",
        invalidProjectIds,
      });
    }

    if (!userValidation.valid) {
      return res.status(400).json({
        success: false,
        error: "One or more selected users do not exist or are inactive.",
        invalidUserIds: userValidation.invalidUserIds,
      });
    }

    await prisma.$transaction(async (transaction) => {
      if (replaceExisting) {
        await transaction.projectUser.deleteMany({
          where: {
            projectId: {
              in: projectIds,
            },
          },
        });
      }

      await transaction.projectUser.createMany({
        data: projectIds.flatMap((projectId) =>
          userIds.map((userId) => ({
            projectId,
            userId,
          })),
        ),
        skipDuplicates: true,
      });
    });

    const updatedProjects = await prisma.project.findMany({
      where: {
        id: {
          in: projectIds,
        },
      },
      include: projectInclude,
      orderBy: {
        name: "asc",
      },
    });

    return res.status(200).json({
      success: true,
      message: `${userIds.length} user(s) assigned to ${projectIds.length} project(s) successfully.`,
      data: updatedProjects,
    });
  } catch (error) {
    console.error("Error assigning users to projects:", error);

    return res.status(500).json({
      success: false,
      error: "Failed to assign users to projects.",
    });
  }
};

export const deleteProject = async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };

    const project = await prisma.project.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        error: "Project not found.",
      });
    }

    await prisma.$transaction(async (transaction) => {
      await transaction.projectUser.deleteMany({
        where: {
          projectId: id,
        },
      });

      await transaction.project.delete({
        where: { id },
      });
    });

    return res.status(200).json({
      success: true,
      message: "Project deleted successfully",
      data: project,
    });
  } catch (error) {
    console.error("Error deleting project:", error);

    return res.status(500).json({
      success: false,
      error:
        "Failed to delete project. Related responses or evaluations may still exist.",
    });
  }
};
