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

  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== normalized
    ? null
    : date;
};

const getRequestIp = (req: Request) => {
  const forwarded = req.headers["x-forwarded-for"];

  if (typeof forwarded === "string") {
    return forwarded.split(",")[0]?.trim() || null;
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

    const { projectId } = req.params as { projectId: string };

    const {
      quantity,
      workDate,
      note,
      category: rawCategory,
      clientRequestId,
    } = req.body;

    const parsedQuantity = Number(quantity);

    if (
      (typeof quantity !== "number" && typeof quantity !== "string") ||
      !Number.isSafeInteger(parsedQuantity) ||
      parsedQuantity <= 0 ||
      parsedQuantity > 2147483647
    ) {
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

    const result = await prisma.$transaction(async (tx) => {
      // Serialize updates for a project so two workers cannot complete the same
      // remaining balance. The lock is held until both the entry and total commit.
      await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`;
      const requestId =
        typeof clientRequestId === "string" ? clientRequestId.trim() : "";
      if (requestId) {
        const existingEntry = await tx.projectProgressEntry.findUnique({
          where: { clientRequestId: requestId },
        });
        if (existingEntry) {
          if (
            existingEntry.projectId !== projectId ||
            existingEntry.userId !== user.id ||
            existingEntry.quantity !== parsedQuantity ||
            existingEntry.category !== category ||
            existingEntry.workDate.getTime() !== parsedWorkDate.getTime() ||
            existingEntry.note !==
              (typeof note === "string" && note.trim() ? note.trim() : null)
          ) {
            throw new Error("REQUEST_ID_CONFLICT");
          }
          return {
            entry: existingEntry,
            project: await tx.project.findUnique({ where: { id: projectId } }),
            alreadySubmitted: true,
          };
        }
      }
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

    return res.status("alreadySubmitted" in result ? 200 : 201).json({
      success: true,
      message: "alreadySubmitted" in result
        ? "Progress was already submitted."
        : "Project progress submitted successfully.",
      data: result,
    });
  } catch (error) {
    console.error("Error adding project progress:", error);

    if ((error instanceof Error && error.message === "REQUEST_ID_CONFLICT") ||
        (typeof error === "object" && error !== null && "code" in error && error.code === "P2002")) {
      return res.status(409).json({ success: false, error: "This submission ID has already been used for different work. Refresh and try again." });
    }

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
export const getMyProjectProgress = async (req: Request, res: Response) => getProjectProgress(req, res, false);
export const getAdminProjectProgress = async (req: Request, res: Response) => getProjectProgress(req, res, true);

const getProjectProgress = async (req: Request, res: Response, adminOnly: boolean) => {
  try {
    const user = await findAuthenticatedUser(req);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: "Authenticated user was not found.",
      });
    }

    if (user.status !== "active" || (adminOnly && user.role !== "admin")) {
      return res.status(403).json({ success: false, error: "Access denied." });
    }

    const { projectId } = req.params as { projectId: string };

    const assignment = await prisma.projectUser.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId: user.id,
        },
      },
    });

    if (!adminOnly && !assignment) {
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
        users: { select: { user: { select: { id: true, name: true, email: true } } } },
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        error: "Project not found.",
      });
    }

    const { users: assignedUsers, ...projectTotals } = project;
    const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
    const limit = Math.min(200, Math.max(1, Math.floor(Number(req.query.limit) || 200)));
    if (!Number.isSafeInteger(page) || !Number.isSafeInteger((page - 1) * limit)) {
      return res.status(400).json({ success: false, error: "Invalid page." });
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
          createdAt: "desc",
        },
        {
          id: "desc",
        },
      ],
      take: limit,
      skip: (page - 1) * limit,
    });

    // Totals must cover all history, including entries outside the current page.
    const grouped = await prisma.projectProgressEntry.groupBy({
      by: ["userId", "category"],
      where: { projectId, status: "ACTIVE" },
      _sum: { quantity: true },
      _count: { _all: true },
    });
    const contributors = await prisma.user.findMany({
      where: { id: { in: grouped.flatMap((entry) => entry.userId ? [entry.userId] : []) } },
      select: { id: true, name: true, email: true },
    });

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

    assignedUsers.forEach(({ user: member }) => {
      teamMap.set(member.id, { userId: member.id, name: member.name || member.email,
        email: member.email, projectCompleted: 0, competitionCompleted: 0, entries: 0 });
    });

    grouped.forEach((entry) => {
      const key = entry.userId || "system";
      const contributor = contributors.find((member) => member.id === entry.userId);

      const current = teamMap.get(key) ?? {
        userId: entry.userId,
        name: contributor?.name || contributor?.email || "Unattributed / deleted user",
        email: contributor?.email || null,
        projectCompleted: 0,
        competitionCompleted: 0,
        entries: 0,
      };

      if (entry.category === "PROJECT") {
        current.projectCompleted += entry._sum.quantity ?? 0;
      } else {
        current.competitionCompleted += entry._sum.quantity ?? 0;
      }

      current.entries += entry._count._all;

      teamMap.set(key, current);
    });

    return res.status(200).json({
      success: true,
      message: "Project progress history retrieved successfully.",
      data: {
        project: projectTotals,

        mySummary: {
          projectCompleted: teamMap.get(user.id)?.projectCompleted ?? 0,
          competitionCompleted: teamMap.get(user.id)?.competitionCompleted ?? 0,
          totalEntries: teamMap.get(user.id)?.entries ?? 0,
        },

        teamSummary: Array.from(teamMap.values()),

        entries,
        pagination: { page, limit, total: await prisma.projectProgressEntry.count({ where: { projectId } }) },
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

    if (!admin || admin.role !== "admin" || admin.status !== "active") {
      return res.status(403).json({
        success: false,
        error: "Only administrators can void progress entries.",
      });
    }

    const { entryId } = req.params as { entryId: string };
    const { reason } = req.body;

    if (typeof reason !== "string" || !reason.trim()) {
      return res.status(400).json({
        success: false,
        error: "A void reason is required.",
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Lock the project first, using the same lock order as new submissions.
      await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = (SELECT "projectId" FROM "ProjectProgressEntry" WHERE "id" = ${entryId}) FOR UPDATE`;
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

      const currentProject = await tx.project.findUniqueOrThrow({ where: { id: entry.projectId } });
      const completed = entry.category === "PROJECT" ? currentProject.completed : currentProject.competitionCompleted;
      if (entry.quantity > completed) throw new Error("INVALID_BALANCE");

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

    if (error instanceof Error && error.message === "INVALID_BALANCE") {
      return res.status(409).json({ success: false, error: "This entry exceeds the current completed balance and cannot be voided." });
    }

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
