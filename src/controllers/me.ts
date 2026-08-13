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

type ProjectStatus = "not_started" | "in_progress" | "completed" | "overdue";

/**
 * Supports different auth middleware structures:
 *
 * req.user.id
 * req.user.userId
 * req.user.email
 * req.userId
 * req.email
 *
 * Your current token stores the email inside userId,
 * so this value may be either a UUID or an email.
 */
const getAuthenticatedIdentifier = (req: Request): string | undefined => {
  const authenticatedRequest = req as AuthenticatedRequest;

  const identifier =
    authenticatedRequest.user?.id ||
    authenticatedRequest.user?.userId ||
    authenticatedRequest.user?.email ||
    authenticatedRequest.userId ||
    authenticatedRequest.email;

  return typeof identifier === "string" ? identifier.trim() : undefined;
};

const calculateProgress = (completed: number, target: number) => {
  if (target <= 0) {
    return 0;
  }

  const percentage = Math.round((completed / target) * 100);

  return Math.min(Math.max(percentage, 0), 100);
};

const calculatePercentage = (score: number, maximumScore: number) => {
  if (maximumScore <= 0) {
    return 0;
  }

  const percentage = Math.round((score / maximumScore) * 100);

  return Math.min(Math.max(percentage, 0), 100);
};

const getStartOfToday = () => {
  const today = new Date();

  today.setHours(0, 0, 0, 0);

  return today;
};

const getDaysLeft = (deadlineValue: Date, today: Date) => {
  const deadline = new Date(deadlineValue);

  deadline.setHours(0, 0, 0, 0);

  const millisecondsPerDay = 1000 * 60 * 60 * 24;

  return Math.ceil((deadline.getTime() - today.getTime()) / millisecondsPerDay);
};

const getProjectStatus = (
  completed: number,
  target: number,
  daysLeft: number,
): ProjectStatus => {
  if (target > 0 && completed >= target) {
    return "completed";
  }

  if (daysLeft < 0) {
    return "overdue";
  }

  if (completed <= 0) {
    return "not_started";
  }

  return "in_progress";
};

export const getMyWorkspace = async (req: Request, res: Response) => {
  try {
    const identifier = getAuthenticatedIdentifier(req);

    if (!identifier) {
      return res.status(401).json({
        success: false,
        error: "Authenticated user information was not found.",
      });
    }

    /**
     * The JWT identifier may currently be:
     *
     * 1. The user's database UUID
     * 2. The user's email address
     *
     * Support both until the JWT payload is updated.
     */
    const user = await prisma.user.findFirst({
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

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found.",
      });
    }

    if (user.status !== "active") {
      return res.status(403).json({
        success: false,
        error: "This user account is inactive.",
      });
    }

    /**
     * Important:
     *
     * Use user.id here, not identifier.
     * ProjectUser.userId and
     * PerformanceEvaluation.userId contain UUIDs.
     */
    const [projectAssignments, evaluations] = await Promise.all([
      prisma.projectUser.findMany({
        where: {
          userId: user.id,
        },
        select: {
          id: true,
          assignedAt: true,

          project: {
            select: {
              id: true,
              name: true,
              description: true,
              deadline: true,

              target: true,
              received: true,
              completed: true,

              competition: true,
              competitionTarget: true,
              competitionReceived: true,
              competitionCompleted: true,

              createdAt: true,
              updatedAt: true,
            },
          },
        },
        orderBy: {
          assignedAt: "desc",
        },
      }),

      prisma.performanceEvaluation.findMany({
        where: {
          userId: user.id,
        },
        select: {
          id: true,
          userId: true,
          projectId: true,

          totalScore: true,
          remarks: true,

          evaluatedAt: true,
          createdAt: true,
          updatedAt: true,

          project: {
            select: {
              id: true,
              name: true,
            },
          },

          answers: {
            select: {
              id: true,
              score: true,
              remark: true,

              question: {
                select: {
                  id: true,
                  question: true,
                  maxScore: true,
                },
              },
            },
            orderBy: {
              createdAt: "asc",
            },
          },
        },
        orderBy: {
          evaluatedAt: "desc",
        },
      }),
    ]);

    const today = getStartOfToday();

    const projects = projectAssignments
      .map((assignment) => {
        const project = assignment.project;

        const daysLeft = getDaysLeft(project.deadline, today);

        const status = getProjectStatus(
          project.completed,
          project.target,
          daysLeft,
        );

        return {
          ...project,

          assignmentId: assignment.id,
          assignedAt: assignment.assignedAt,

          daysLeft,
          status,

          progress: calculateProgress(project.completed, project.target),

          competitionProgress: project.competition
            ? calculateProgress(
                project.competitionCompleted,
                project.competitionTarget,
              )
            : 0,
        };
      })
      .sort((first, second) => {
        const statusPriority: Record<ProjectStatus, number> = {
          overdue: 0,
          in_progress: 1,
          not_started: 2,
          completed: 3,
        };

        const priorityDifference =
          statusPriority[first.status] - statusPriority[second.status];

        if (priorityDifference !== 0) {
          return priorityDifference;
        }

        return (
          new Date(first.deadline).getTime() -
          new Date(second.deadline).getTime()
        );
      });

    const performanceReviews = evaluations.map((evaluation) => {
      const maximumScore = evaluation.answers.reduce(
        (total, answer) => total + answer.question.maxScore,
        0,
      );

      return {
        id: evaluation.id,

        userId: evaluation.userId,
        projectId: evaluation.projectId,

        totalScore: evaluation.totalScore,

        maximumScore,

        percentage: calculatePercentage(evaluation.totalScore, maximumScore),

        remarks: evaluation.remarks,

        evaluatedAt: evaluation.evaluatedAt,

        createdAt: evaluation.createdAt,

        updatedAt: evaluation.updatedAt,

        project: evaluation.project,

        answers: evaluation.answers,
      };
    });

    const completedProjects = projects.filter(
      (project) => project.status === "completed",
    ).length;

    const overdueProjects = projects.filter(
      (project) => project.status === "overdue",
    ).length;

    const notStartedProjects = projects.filter(
      (project) => project.status === "not_started",
    ).length;

    const activeInProgressProjects = projects.filter(
      (project) => project.status === "in_progress",
    ).length;

    /**
     * Keeps compatibility with your current frontend:
     * inProgressProjects includes not-started projects.
     */
    const inProgressProjects = activeInProgressProjects + notStartedProjects;

    const dueSoonProjects = projects.filter(
      (project) =>
        project.status !== "completed" &&
        project.daysLeft >= 0 &&
        project.daysLeft <= 7,
    ).length;

    const totalTargetReports = projects.reduce(
      (total, project) => total + project.target,
      0,
    );

    const totalReceivedReports = projects.reduce(
      (total, project) => total + project.received,
      0,
    );

    const totalCompletedReports = projects.reduce(
      (total, project) => total + project.completed,
      0,
    );

    const totalCompetitionTarget = projects.reduce(
      (total, project) =>
        total + (project.competition ? project.competitionTarget : 0),
      0,
    );

    const totalCompetitionReceived = projects.reduce(
      (total, project) =>
        total + (project.competition ? project.competitionReceived : 0),
      0,
    );

    const totalCompetitionCompleted = projects.reduce(
      (total, project) =>
        total + (project.competition ? project.competitionCompleted : 0),
      0,
    );

    const averagePerformance =
      performanceReviews.length > 0
        ? Math.round(
            performanceReviews.reduce(
              (total, review) => total + review.percentage,
              0,
            ) / performanceReviews.length,
          )
        : 0;

    return res.status(200).json({
      success: true,
      message: "User workspace retrieved successfully",

      data: {
        user,

        summary: {
          assignedProjects: projects.length,

          completedProjects,

          inProgressProjects,

          activeInProgressProjects,

          notStartedProjects,

          overdueProjects,

          dueSoonProjects,

          totalTargetReports,

          totalReceivedReports,

          totalCompletedReports,

          overallProgress: calculateProgress(
            totalCompletedReports,
            totalTargetReports,
          ),

          competitionProjects: projects.filter((project) => project.competition)
            .length,

          totalCompetitionTarget,

          totalCompetitionReceived,

          totalCompetitionCompleted,

          competitionProgress: calculateProgress(
            totalCompetitionCompleted,
            totalCompetitionTarget,
          ),

          performanceReviews: performanceReviews.length,

          averagePerformance,
        },

        projects,

        performanceReviews,
      },
    });
  } catch (error) {
    console.error("Error retrieving user workspace:", error);

    return res.status(500).json({
      success: false,
      error: "Failed to retrieve user workspace.",
    });
  }
};
