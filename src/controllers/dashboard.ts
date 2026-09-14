import type { Request, Response } from "express";

import { prisma } from "../lib/prisma.ts";

type ProjectStatus = "not_started" | "in_progress" | "completed" | "overdue";

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const calculateProgress = (completed: number, target: number) => {
  if (target <= 0) {
    return 0;
  }

  return Math.min(Math.round((completed / target) * 100), 100);
};

const getStartOfToday = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return today;
};

const getProjectStatus = (
  project: {
    deadline: Date;
    target: number;
    completed: number;
  },
  today: Date,
): ProjectStatus => {
  if (project.target > 0 && project.completed >= project.target) {
    return "completed";
  }

  const deadline = new Date(project.deadline);
  deadline.setHours(0, 0, 0, 0);

  if (deadline.getTime() < today.getTime()) {
    return "overdue";
  }

  if (project.completed <= 0) {
    return "not_started";
  }

  return "in_progress";
};

export const getAdminDashboard = async (_req: Request, res: Response) => {
  try {
    const [totalUsers, activeUsers, projects, evaluations] = await Promise.all([
      prisma.user.count(),

      prisma.user.count({
        where: {
          status: "active",
        },
      }),

      prisma.project.findMany({
        select: {
          id: true,
          name: true,
          deadline: true,
          target: true,
          received: true,
          completed: true,
          competition: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              users: true,
            },
          },
        },
        orderBy: {
          updatedAt: "desc",
        },
      }),

      prisma.performanceEvaluation.findMany({
        select: {
          totalScore: true,
          answers: {
            select: {
              question: {
                select: {
                  maxScore: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const today = getStartOfToday();
    const year = today.getFullYear();

    const projectsWithStatus = projects.map((project) => {
      const status = getProjectStatus(project, today);

      return {
        ...project,
        status,
        progress: calculateProgress(project.completed, project.target),
      };
    });

    const completedProjects = projectsWithStatus.filter(
      (project) => project.status === "completed",
    ).length;

    const overdueProjects = projectsWithStatus.filter(
      (project) => project.status === "overdue",
    ).length;

    const notStartedProjects = projectsWithStatus.filter(
      (project) => project.status === "not_started",
    ).length;

    const inProgressProjects = projectsWithStatus.filter(
      (project) => project.status === "in_progress",
    ).length;

    const totalTarget = projectsWithStatus.reduce(
      (sum, project) => sum + project.target,
      0,
    );

    const totalReceived = projectsWithStatus.reduce(
      (sum, project) => sum + project.received,
      0,
    );

    const totalCompleted = projectsWithStatus.reduce(
      (sum, project) => sum + project.completed,
      0,
    );

    const monthlyProjects = MONTH_LABELS.map((month) => ({
      month,
      projects: 0,
      completed: 0,
    }));

    const monthlyReports = MONTH_LABELS.map((month) => ({
      month,
      target: 0,
      received: 0,
      completed: 0,
    }));

    projectsWithStatus.forEach((project) => {
      const deadline = new Date(project.deadline);

      if (deadline.getFullYear() !== year) {
        return;
      }

      const monthIndex = deadline.getMonth();
      const monthlyProject = monthlyProjects[monthIndex];
      const monthlyReport = monthlyReports[monthIndex];

      if (!monthlyProject || !monthlyReport) {
        return;
      }

      monthlyProject.projects += 1;

      if (project.status === "completed") {
        monthlyProject.completed += 1;
      }

      monthlyReport.target += project.target;

      monthlyReport.received += project.received;

      monthlyReport.completed += project.completed;
    });

    const statusCounts: Record<ProjectStatus, number> = {
      completed: completedProjects,
      in_progress: inProgressProjects,
      not_started: notStartedProjects,
      overdue: overdueProjects,
    };

    const statusLabels: Record<ProjectStatus, string> = {
      completed: "Completed",
      in_progress: "In progress",
      not_started: "Not started",
      overdue: "Overdue",
    };

    const statusOrder: ProjectStatus[] = [
      "completed",
      "in_progress",
      "not_started",
      "overdue",
    ];

    const totalProjects = projectsWithStatus.length;

    const projectStatus = statusOrder.map((status) => {
      const count = statusCounts[status];

      return {
        status,
        label: statusLabels[status],
        count,
        percentage:
          totalProjects > 0
            ? Number(((count / totalProjects) * 100).toFixed(1))
            : 0,
      };
    });

    const evaluationPercentages = evaluations.map((evaluation) => {
      const maximumScore = evaluation.answers.reduce(
        (sum, answer) => sum + answer.question.maxScore,
        0,
      );

      if (maximumScore <= 0) {
        return 0;
      }

      return (evaluation.totalScore / maximumScore) * 100;
    });

    const averagePerformance =
      evaluationPercentages.length > 0
        ? Math.round(
            evaluationPercentages.reduce(
              (sum, percentage) => sum + percentage,
              0,
            ) / evaluationPercentages.length,
          )
        : 0;

    const recentProjects = projectsWithStatus.slice(0, 6).map((project) => ({
      id: project.id,
      name: project.name,
      deadline: project.deadline,
      target: project.target,
      received: project.received,
      completed: project.completed,
      progress: project.progress,
      status: project.status,
      assignedUsers: project._count.users,
      competition: project.competition,
      updatedAt: project.updatedAt,
    }));

    return res.status(200).json({
      success: true,
      message: "Admin dashboard retrieved successfully",
      data: {
        year,
        generatedAt: new Date(),
        summary: {
          totalUsers,
          activeUsers,
          totalProjects,
          activeProjects: totalProjects - completedProjects,
          completedProjects,
          inProgressProjects,
          notStartedProjects,
          overdueProjects,
          totalEvaluations: evaluations.length,
          averagePerformance,
          totalTarget,
          totalReceived,
          totalCompleted,
          overallProgress: calculateProgress(totalCompleted, totalTarget),
        },
        monthlyProjects,
        monthlyReports,
        projectStatus,
        recentProjects,
      },
    });
  } catch (error) {
    console.error("Error retrieving admin dashboard:", error);

    return res.status(500).json({
      success: false,
      error: "Failed to retrieve admin dashboard.",
    });
  }
};
