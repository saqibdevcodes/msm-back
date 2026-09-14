import type { Request, Response } from "express";
import { prisma } from "../lib/prisma.ts";

const DEFAULT_QUESTIONS = [
  "User speed (task completion rate)",
  "User accuracy (error-free work)",
  "Work quality and completeness",
  "Communication and coordination",
  "Ownership and problem-solving",
];

const ensureDefaultQuestions = async () => {
  const count = await prisma.performanceQuestion.count();
  if (count > 0) return;

  await prisma.performanceQuestion.createMany({
    data: DEFAULT_QUESTIONS.map((question) => ({
      question,
      maxScore: 5,
    })),
  });
};

export const getPerformanceQuestions = async (_req: Request, res: Response) => {
  try {
    await ensureDefaultQuestions();

    const questions = await prisma.performanceQuestion.findMany({
      orderBy: { createdAt: "asc" },
    });

    return res.status(200).json({
      message: "Performance questions retrieved successfully",
      data: questions,
    });
  } catch (error) {
    console.error("Error retrieving performance questions:", error);
    return res
      .status(500)
      .json({ error: "Failed to retrieve performance questions" });
  }
};

export const createPerformanceQuestion = async (
  req: Request,
  res: Response,
) => {
  try {
    const { question, maxScore } = req.body as {
      question?: string;
      maxScore?: number;
    };

    if (!question || !question.trim()) {
      return res.status(400).json({ error: "question is required" });
    }

    const normalizedMaxScore =
      typeof maxScore === "number" && maxScore > 0 ? maxScore : 5;

    const created = await prisma.performanceQuestion.create({
      data: { question: question.trim(), maxScore: normalizedMaxScore },
    });

    return res.status(201).json({
      message: "Performance question created successfully",
      data: created,
    });
  } catch (error) {
    console.error("Error creating performance question:", error);
    return res
      .status(500)
      .json({ error: "Failed to create performance question" });
  }
};

export const createPerformanceEvaluation = async (
  req: Request,
  res: Response,
) => {
  try {
    const { userId, projectId, remarks, answers } = req.body as {
      userId?: string;
      projectId?: string;
      remarks?: string;
      answers?: Array<{ questionId?: string; score?: number; remark?: string }>;
    };

    if (
      !userId ||
      !projectId ||
      !Array.isArray(answers) ||
      answers.length === 0
    ) {
      return res
        .status(400)
        .json({ error: "userId, projectId and answers are required" });
    }

    const [project, assigned, questions] = await Promise.all([
      prisma.project.findUnique({ where: { id: projectId } }),
      prisma.projectUser.findUnique({
        where: { projectId_userId: { projectId, userId } },
      }),
      prisma.performanceQuestion.findMany(),
    ]);

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (!assigned) {
      return res
        .status(400)
        .json({ error: "User is not assigned to this project" });
    }

    if (!project.completed) {
      return res
        .status(400)
        .json({ error: "Project must be completed before evaluation" });
    }

    const questionMap = new Map(questions.map((q) => [q.id, q]));

    for (const answer of answers) {
      if (!answer.questionId || typeof answer.score !== "number") {
        return res.status(400).json({
          error: "Each answer must include questionId and numeric score",
        });
      }

      const question = questionMap.get(answer.questionId);
      if (!question) {
        return res
          .status(400)
          .json({ error: `Invalid questionId: ${answer.questionId}` });
      }

      if (answer.score < 1 || answer.score > question.maxScore) {
        return res.status(400).json({
          error: `${question.question} score must be between 1 and ${question.maxScore}`,
        });
      }
    }

    const totalScore = answers.reduce(
      (sum, answer) => sum + (answer.score ?? 0),
      0,
    );

    const evaluation = await prisma.performanceEvaluation.create({
      data: {
        userId,
        projectId,
        totalScore,
        ...(remarks !== undefined ? { remarks } : {}),
        answers: {
          create: answers.map((answer) => ({
            questionId: answer.questionId as string,
            score: answer.score as number,
            ...(answer.remark !== undefined ? { remark: answer.remark } : {}),
          })),
        },
      },
      include: {
        answers: {
          include: { question: true },
        },
        user: { select: { id: true, name: true, email: true } },
        project: { select: { id: true, name: true } },
      },
    });

    return res.status(201).json({
      message: "Performance evaluation saved successfully",
      data: evaluation,
    });
  } catch (error) {
    console.error("Error creating performance evaluation:", error);
    return res
      .status(500)
      .json({ error: "Failed to create performance evaluation" });
  }
};

export const getPerformanceEvaluationsByProject = async (
  req: Request,
  res: Response,
) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const evaluations = await prisma.performanceEvaluation.findMany({
      where: { projectId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        answers: { include: { question: true } },
      },
      orderBy: { evaluatedAt: "desc" },
    });

    return res.status(200).json({
      message: "Project performance evaluations retrieved successfully",
      data: evaluations,
    });
  } catch (error) {
    console.error("Error retrieving project performance evaluations:", error);
    return res.status(500).json({
      error: "Failed to retrieve project performance evaluations",
    });
  }
};

export const getPerformanceEvaluationsByUser = async (
  req: Request,
  res: Response,
) => {
  try {
    const { userId } = req.params as { userId: string };
    const evaluations = await prisma.performanceEvaluation.findMany({
      where: { userId },
      include: {
        project: { select: { id: true, name: true } },
        answers: { include: { question: true } },
      },
      orderBy: { evaluatedAt: "desc" },
    });

    return res.status(200).json({
      message: "User performance evaluations retrieved successfully",
      data: evaluations,
    });
  } catch (error) {
    console.error("Error retrieving user performance evaluations:", error);
    return res.status(500).json({
      error: "Failed to retrieve user performance evaluations",
    });
  }
};
