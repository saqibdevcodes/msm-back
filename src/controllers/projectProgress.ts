import type { Request, Response } from "express";

import { prisma } from "../lib/prisma.ts";

type AuthenticatedRequest = Request & {
  user?: {
    id?: string;
    userId?: string;
    email?: string;
  };
  userId?: string;
  email?: string;
};

type ProgressCategory = "PROJECT" | "COMPETITION";

const getAuthenticatedIdentifier = (req: Request) => {
  const authenticatedRequest = req as AuthenticatedRequest;

  const identifier =
    authenticatedRequest.user?.id ||
    authenticatedRequest.user?.userId ||
    authenticatedRequest.user?.email ||
    authenticatedRequest.userId ||
    authenticatedRequest.email;

  return typeof identifier === "string" ? identifier.trim() : undefined;
};

const findAuthenticatedUser = async (req: Request) => {
  const identifier = getAuthenticatedIdentifier(req);

  if (!identifier) {
    return null;
  }

  return prisma.user.findFirst({
    where: {
      OR: [
        {
          id: identifier,
        },
        {
          email: {
            equals: identifier,
            mode: "insensitive",
          },
        },
      ],
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
    },
  });
};

const parseCategory = (value: unknown): ProgressCategory | null => {
  if (value === undefined || value === null || value === "") {
    return "PROJECT";
  }

  const category = String(value).trim().toUpperCase();

  if (category === "PROJECT" || category === "COMPETITION") {
    return category;
  }

  return null;
};

const parseWorkDate = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }

  const date = new Date(`${normalized}T00:00:00.000Z`);

  return Number.isNaN(date.getTime()) ? null : date;
};

const getRequestIp = (req: Request) => {
  const forwarded = req.headers["x-forwarded-for"];

  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }

  return req.ip || null;
};

export const addMyProjectProgress = async (req: Request, res: Response) => {
  try {
    const user = await findAuthenticatedUser(req);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: "Authenticated user was not found.",
      });
    }

    if (user.status !== "active") {
      return res.status(403).json({
        success: false,
        error: "Your account is inactive.",
      });
    }

    const { projectId } = req.params;

    const {
      quantity,
      workDate,
      note,
      category: rawCategory,
      clientRequestId,
    } = req.body;

    const parsedQuantity = Number(quantity);

    if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
      return res.status(400).json({
        success: false,
        error: "Quantity must be a positive whole number.",
      });
    }

    const category = parseCategory(rawCategory);

    if (!category) {
      return res.status(400).json({
        success: false,
        error: "Category must be PROJECT or COMPETITION.",
      });
    }

    const parsedWorkDate = parseWorkDate(workDate);

    if (!parsedWorkDate) {
      return res.status(400).json({
        success: false,
        error: "A valid work date is required.",
      });
    }

    const today = new Date();

    today.setUTCHours(0, 0, 0, 0);

    if (parsedWorkDate.getTime() > today.getTime()) {
      return res.status(400).json({
        success: false,
        error: "Progress cannot be submitted for a future date.",
      });
    }

    const earliestAllowed = new Date(today);

    earliestAllowed.setUTCDate(earliestAllowed.getUTCDate() - 30);

    if (parsedWorkDate.getTime() < earliestAllowed.getTime()) {
      return res.status(400).json({
        success: false,
        error: "Users can only submit progress for the previous 30 days.",
      });
    }

    const assignment = await prisma.projectUser.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId: user.id,
        },
      },
      select: {
        id: true,
      },
    });

    if (!assignment) {
      return res.status(403).json({
        success: false,
        error: "You are not assigned to this project.",
      });
    }

    if (clientRequestId && typeof clientRequestId === "string") {
      const existingEntry = await prisma.projectProgressEntry.findUnique({
        where: {
          clientRequestId,
        },
      });

      if (existingEntry) {
        return res.status(200).json({
          success: true,
          message: "Progress was already submitted.",
          data: existingEntry,
        });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const project = await tx.project.findUnique({
        where: {
          id: projectId,
        },
        select: {
          id: true,
          name: true,
          target: true,
          received: true,
          completed: true,
          competition: true,
          competitionTarget: true,
          competitionReceived: true,
          competitionCompleted: true,
        },
      });

      if (!project) {
        throw new Error("PROJECT_NOT_FOUND");
      }

      if (category === "COMPETITION" && !project.competition) {
        throw new Error("COMPETITION_NOT_ENABLED");
      }

      const target =
        category === "PROJECT" ? project.target : project.competitionTarget;

      const received =
        category === "PROJECT" ? project.received : project.competitionReceived;

      const completedBefore =
        category === "PROJECT"
          ? project.completed
          : project.competitionCompleted;

      const completedAfter = completedBefore + parsedQuantity;

      if (completedAfter > received) {
        throw new Error("COMPLETED_EXCEEDS_RECEIVED");
      }

      const entry = await tx.projectProgressEntry.create({
        data: {
          projectId,
          userId: user.id,
          createdById: user.id,
          category,
          quantity: parsedQuantity,
          workDate: parsedWorkDate,
          note: typeof note === "string" && note.trim() ? note.trim() : null,
          source: "USER",
          status: "ACTIVE",
          clientRequestId:
            typeof clientRequestId === "string" && clientRequestId.trim()
              ? clientRequestId.trim()
              : null,
          targetSnapshot: target,
          receivedSnapshot: received,
          completedBefore,
          completedAfter,
          submittedIp: getRequestIp(req),
          submittedUserAgent: req.headers["user-agent"] || null,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      const updatedProject = await tx.project.update({
        where: {
          id: projectId,
        },
        data:
          category === "PROJECT"
            ? {
                completed: {
                  increment: parsedQuantity,
                },
              }
            : {
                competitionCompleted: {
                  increment: parsedQuantity,
                },
              },
        select: {
          id: true,
          name: true,
          target: true,
          received: true,
          completed: true,
          competition: true,
          competitionTarget: true,
          competitionReceived: true,
          competitionCompleted: true,
        },
      });

      return {
        entry,
        project: updatedProject,
      };
    });

    return res.status(201).json({
      success: true,
      message: "Project progress submitted successfully.",
      data: result,
    });
  } catch (error) {
    console.error("Error adding project progress:", error);

    if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        error: "Project not found.",
      });
    }

    if (error instanceof Error && error.message === "COMPETITION_NOT_ENABLED") {
      return res.status(400).json({
        success: false,
        error: "Competition is not enabled for this project.",
      });
    }

    if (
      error instanceof Error &&
      error.message === "COMPLETED_EXCEEDS_RECEIVED"
    ) {
      return res.status(400).json({
        success: false,
        error:
          "The completed quantity cannot be greater than reports received from the field.",
      });
    }

    return res.status(500).json({
      success: false,
      error: "Failed to submit project progress.",
    });
  }
};
export const getMyProjectProgress = async (req: Request, res: Response) => {
  try {
    const user = await findAuthenticatedUser(req);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: "Authenticated user was not found.",
      });
    }

    const { projectId } = req.params;

    const assignment = await prisma.projectUser.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId: user.id,
        },
      },
    });

    if (!assignment) {
      return res.status(403).json({
        success: false,
        error: "You are not assigned to this project.",
      });
    }

    const project = await prisma.project.findUnique({
      where: {
        id: projectId,
      },
      select: {
        id: true,
        name: true,
        target: true,
        received: true,
        completed: true,
        competition: true,
        competitionTarget: true,
        competitionReceived: true,
        competitionCompleted: true,
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        error: "Project not found.",
      });
    }

    const entries = await prisma.projectProgressEntry.findMany({
      where: {
        projectId,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        voidedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: [
        {
          workDate: "desc",
        },
        {
          createdAt: "desc",
        },
      ],
      take: 200,
    });

    const activeEntries = entries.filter((entry) => entry.status === "ACTIVE");

    const myProjectCompleted = activeEntries
      .filter(
        (entry) => entry.userId === user.id && entry.category === "PROJECT",
      )
      .reduce((total, entry) => total + entry.quantity, 0);

    const myCompetitionCompleted = activeEntries
      .filter(
        (entry) => entry.userId === user.id && entry.category === "COMPETITION",
      )
      .reduce((total, entry) => total + entry.quantity, 0);

    const teamMap = new Map<
      string,
      {
        userId: string | null;
        name: string;
        email: string | null;
        projectCompleted: number;
        competitionCompleted: number;
        entries: number;
      }
    >();

    activeEntries.forEach((entry) => {
      const key = entry.userId || "system";

      const current = teamMap.get(key) ?? {
        userId: entry.userId,
        name: entry.user?.name || "System opening balance",
        email: entry.user?.email || null,
        projectCompleted: 0,
        competitionCompleted: 0,
        entries: 0,
      };

      if (entry.category === "PROJECT") {
        current.projectCompleted += entry.quantity;
      } else {
        current.competitionCompleted += entry.quantity;
      }

      current.entries += 1;

      teamMap.set(key, current);
    });

    return res.status(200).json({
      success: true,
      message: "Project progress history retrieved successfully.",
      data: {
        project,

        mySummary: {
          projectCompleted: myProjectCompleted,
          competitionCompleted: myCompetitionCompleted,
          totalEntries: activeEntries.filter(
            (entry) => entry.userId === user.id,
          ).length,
        },

        teamSummary: Array.from(teamMap.values()),

        entries,
      },
    });
  } catch (error) {
    console.error("Error retrieving progress history:", error);

    return res.status(500).json({
      success: false,
      error: "Failed to retrieve project progress history.",
    });
  }
};
export const voidProjectProgressEntry = async (req: Request, res: Response) => {
  try {
    const admin = await findAuthenticatedUser(req);

    if (!admin || admin.role !== "admin") {
      return res.status(403).json({
        success: false,
        error: "Only administrators can void progress entries.",
      });
    }

    const { entryId } = req.params;
    const { reason } = req.body;

    if (typeof reason !== "string" || !reason.trim()) {
      return res.status(400).json({
        success: false,
        error: "A void reason is required.",
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const entry = await tx.projectProgressEntry.findUnique({
        where: {
          id: entryId,
        },
      });

      if (!entry) {
        throw new Error("ENTRY_NOT_FOUND");
      }

      if (entry.status === "VOIDED") {
        throw new Error("ENTRY_ALREADY_VOIDED");
      }

      const project = await tx.project.update({
        where: {
          id: entry.projectId,
        },
        data:
          entry.category === "PROJECT"
            ? {
                completed: {
                  decrement: entry.quantity,
                },
              }
            : {
                competitionCompleted: {
                  decrement: entry.quantity,
                },
              },
      });

      const voidedEntry = await tx.projectProgressEntry.update({
        where: {
          id: entryId,
        },
        data: {
          status: "VOIDED",
          voidedAt: new Date(),
          voidedById: admin.id,
          voidReason: reason.trim(),
        },
      });

      return {
        entry: voidedEntry,
        project,
      };
    });

    return res.status(200).json({
      success: true,
      message: "Progress entry voided successfully.",
      data: result,
    });
  } catch (error) {
    console.error("Error voiding progress entry:", error);

    if (error instanceof Error && error.message === "ENTRY_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        error: "Progress entry not found.",
      });
    }

    if (error instanceof Error && error.message === "ENTRY_ALREADY_VOIDED") {
      return res.status(400).json({
        success: false,
        error: "This progress entry is already voided.",
      });
    }

    return res.status(500).json({
      success: false,
      error: "Failed to void progress entry.",
    });
  }
};
