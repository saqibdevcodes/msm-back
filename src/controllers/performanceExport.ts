import type { Request, Response } from "express";
import ExcelJS from "exceljs";

import { prisma } from "../lib/prisma.ts";

interface ExportQuery {
  projectId?: string;
  userId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  ids?: string;
}

type EvaluationWithRelations = Awaited<
  ReturnType<typeof prisma.performanceEvaluation.findMany>
>[number];

const TITLE_FILL = "1F4E78";
const HEADER_FILL = "4472C4";
const LABEL_FILL = "D9EAF7";
const BORDER_COLOR = "D0D5DD";

const A4_PAPER_SIZE = 9;

const parseStartDate = (value?: string): Date | undefined => {
  if (!value) {
    return undefined;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return Number.isNaN(date.getTime()) ? undefined : date;
};

const parseEndDate = (value?: string): Date | undefined => {
  if (!value) {
    return undefined;
  }

  const date = new Date(`${value}T23:59:59.999Z`);

  return Number.isNaN(date.getTime()) ? undefined : date;
};

const formatDateTime = (value?: Date | string | null) => {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const calculatePercentage = (score: number, maximumScore: number) => {
  if (maximumScore <= 0) {
    return 0;
  }

  return Number(((score / maximumScore) * 100).toFixed(2));
};

const getPerformanceBand = (percentage: number) => {
  if (percentage >= 80) {
    return "Excellent";
  }

  if (percentage >= 60) {
    return "Good";
  }

  if (percentage >= 40) {
    return "Needs Improvement";
  }

  return "Poor";
};

const sanitizeFilename = (value: string) =>
  value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

const getAuthenticatedIdentifier = (req: Request) => {
  const authenticatedRequest = req as Request & {
    user?: {
      id?: string;
      userId?: string;
      email?: string;
    };
    userId?: string;
  };

  return (
    authenticatedRequest.user?.id ||
    authenticatedRequest.user?.userId ||
    authenticatedRequest.user?.email ||
    authenticatedRequest.userId ||
    "Administrator"
  );
};

const styleTitle = (
  sheet: ExcelJS.Worksheet,
  title: string,
  lastColumn: number,
) => {
  sheet.mergeCells(1, 1, 1, lastColumn);

  const cell = sheet.getCell(1, 1);

  cell.value = title;

  cell.font = {
    bold: true,
    size: 16,
    color: {
      argb: "FFFFFFFF",
    },
  };

  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: {
      argb: `FF${TITLE_FILL}`,
    },
  };

  cell.alignment = {
    horizontal: "center",
    vertical: "middle",
  };

  sheet.getRow(1).height = 28;
};

const styleHeaderRow = (row: ExcelJS.Row) => {
  row.height = 25;

  row.eachCell((cell) => {
    cell.font = {
      bold: true,
      color: {
        argb: "FFFFFFFF",
      },
    };

    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: {
        argb: `FF${HEADER_FILL}`,
      },
    };

    cell.alignment = {
      horizontal: "center",
      vertical: "middle",
      wrapText: true,
    };

    cell.border = {
      top: {
        style: "thin",
        color: {
          argb: `FF${BORDER_COLOR}`,
        },
      },
      left: {
        style: "thin",
        color: {
          argb: `FF${BORDER_COLOR}`,
        },
      },
      bottom: {
        style: "thin",
        color: {
          argb: `FF${BORDER_COLOR}`,
        },
      },
      right: {
        style: "thin",
        color: {
          argb: `FF${BORDER_COLOR}`,
        },
      },
    };
  });
};

const styleDataRows = (sheet: ExcelJS.Worksheet, startRow: number) => {
  for (let rowNumber = startRow; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);

    row.eachCell((cell) => {
      cell.alignment = {
        vertical: "top",
        wrapText: true,
      };

      cell.border = {
        top: {
          style: "thin",
          color: {
            argb: `FF${BORDER_COLOR}`,
          },
        },
        left: {
          style: "thin",
          color: {
            argb: `FF${BORDER_COLOR}`,
          },
        },
        bottom: {
          style: "thin",
          color: {
            argb: `FF${BORDER_COLOR}`,
          },
        },
        right: {
          style: "thin",
          color: {
            argb: `FF${BORDER_COLOR}`,
          },
        },
      };
    });

    if (rowNumber % 2 === 0) {
      row.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: {
            argb: "FFF7F9FC",
          },
        };
      });
    }
  }
};

const configureWorksheet = (
  sheet: ExcelJS.Worksheet,
  headerRow: number,
  lastColumn: number,
) => {
  sheet.autoFilter = {
    from: {
      row: headerRow,
      column: 1,
    },
    to: {
      row: headerRow,
      column: lastColumn,
    },
  };

  sheet.views = [
    {
      state: "frozen",
      ySplit: headerRow,
    },
  ];

  sheet.pageSetup = {
    orientation: "landscape",
    paperSize: A4_PAPER_SIZE,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,

    margins: {
      left: 0.25,
      right: 0.25,
      top: 0.5,
      bottom: 0.5,
      header: 0.2,
      footer: 0.2,
    },
  };

  sheet.headerFooter.oddFooter =
    "&LPerformance Management&CPage &P of &N&R&D &T";
};

export const exportPerformanceExcel = async (req: Request, res: Response) => {
  try {
    const { projectId, userId, search, dateFrom, dateTo, ids } =
      req.query as ExportQuery;

    const normalizedSearch = search?.trim();

    const selectedIds = ids
      ? ids
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)
      : [];

    const startDate = parseStartDate(dateFrom);

    const endDate = parseEndDate(dateTo);

    const [evaluations, performanceQuestions] = await Promise.all([
      prisma.performanceEvaluation.findMany({
        where: {
          ...(projectId
            ? {
                projectId,
              }
            : {}),

          ...(userId
            ? {
                userId,
              }
            : {}),

          ...(selectedIds.length > 0
            ? {
                id: {
                  in: selectedIds,
                },
              }
            : {}),

          ...(startDate || endDate
            ? {
                evaluatedAt: {
                  ...(startDate
                    ? {
                        gte: startDate,
                      }
                    : {}),

                  ...(endDate
                    ? {
                        lte: endDate,
                      }
                    : {}),
                },
              }
            : {}),

          ...(normalizedSearch
            ? {
                OR: [
                  {
                    user: {
                      is: {
                        name: {
                          contains: normalizedSearch,
                          mode: "insensitive",
                        },
                      },
                    },
                  },
                  {
                    user: {
                      is: {
                        email: {
                          contains: normalizedSearch,
                          mode: "insensitive",
                        },
                      },
                    },
                  },
                  {
                    project: {
                      is: {
                        name: {
                          contains: normalizedSearch,
                          mode: "insensitive",
                        },
                      },
                    },
                  },
                  {
                    remarks: {
                      contains: normalizedSearch,
                      mode: "insensitive",
                    },
                  },
                ],
              }
            : {}),
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

          user: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              status: true,
              createdAt: true,
              updatedAt: true,
            },
          },

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

          answers: {
            select: {
              id: true,
              questionId: true,
              score: true,
              remark: true,
              createdAt: true,
              updatedAt: true,

              question: {
                select: {
                  id: true,
                  question: true,
                  maxScore: true,
                  createdAt: true,
                },
              },
            },

            orderBy: {
              createdAt: "asc",
            },
          },
        },

        orderBy: [
          {
            evaluatedAt: "desc",
          },
          {
            createdAt: "desc",
          },
        ],
      }),

      prisma.performanceQuestion.findMany({
        select: {
          id: true,
          question: true,
          maxScore: true,
          createdAt: true,
          updatedAt: true,
        },

        orderBy: {
          createdAt: "asc",
        },
      }),
    ]);

    if (evaluations.length === 0) {
      return res.status(404).json({
        success: false,
        error: "No performance evaluations match the selected filters.",
      });
    }

    const preparedEvaluations = evaluations.map((evaluation) => {
      const maximumScore = evaluation.answers.reduce(
        (total, answer) => total + answer.question.maxScore,
        0,
      );

      const percentage = calculatePercentage(
        evaluation.totalScore,
        maximumScore,
      );

      return {
        ...evaluation,
        maximumScore,
        percentage,
        performanceBand: getPerformanceBand(percentage),
      };
    });

    const workbook = new ExcelJS.Workbook();

    workbook.creator = "Project Management System";

    workbook.lastModifiedBy = String(getAuthenticatedIdentifier(req));

    workbook.created = new Date();
    workbook.modified = new Date();

    /*
     * Sheet 1: Export Information
     */
    const informationSheet = workbook.addWorksheet("Export Information", {
      properties: {
        tabColor: {
          argb: "FF1F4E78",
        },
      },
    });

    styleTitle(informationSheet, "PERFORMANCE EVALUATIONS EXPORT", 4);

    informationSheet.columns = [
      {
        width: 28,
      },
      {
        width: 55,
      },
      {
        width: 28,
      },
      {
        width: 45,
      },
    ];

    const averagePercentage =
      preparedEvaluations.reduce(
        (total, evaluation) => total + evaluation.percentage,
        0,
      ) / preparedEvaluations.length;

    const informationRows = [
      [
        "Generated At",
        formatDateTime(new Date()),
        "Generated By",
        String(getAuthenticatedIdentifier(req)),
      ],
      [
        "Project Filter",
        projectId || "All projects",
        "User Filter",
        userId || "All users",
      ],
      [
        "Search",
        normalizedSearch || "None",
        "Selected Evaluation IDs",
        selectedIds.length ? selectedIds.join(", ") : "None",
      ],
      [
        "Date From",
        dateFrom || "Not applied",
        "Date To",
        dateTo || "Not applied",
      ],
      [
        "Evaluations",
        preparedEvaluations.length,
        "Average Performance",
        `${averagePercentage.toFixed(2)}%`,
      ],
    ];

    informationRows.forEach((values) => {
      const row = informationSheet.addRow(values);

      row.height = 24;

      row.eachCell((cell, columnNumber) => {
        cell.alignment = {
          vertical: "middle",
          wrapText: true,
        };

        cell.border = {
          top: {
            style: "thin",
            color: {
              argb: `FF${BORDER_COLOR}`,
            },
          },
          left: {
            style: "thin",
            color: {
              argb: `FF${BORDER_COLOR}`,
            },
          },
          bottom: {
            style: "thin",
            color: {
              argb: `FF${BORDER_COLOR}`,
            },
          },
          right: {
            style: "thin",
            color: {
              argb: `FF${BORDER_COLOR}`,
            },
          },
        };

        if (columnNumber === 1 || columnNumber === 3) {
          cell.font = {
            bold: true,
          };

          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: {
              argb: `FF${LABEL_FILL}`,
            },
          };
        }
      });
    });

    /*
     * Sheet 2: Evaluations
     */
    const evaluationSheet = workbook.addWorksheet("Evaluations", {
      properties: {
        tabColor: {
          argb: "FF4472C4",
        },
      },
    });

    const evaluationHeaders = [
      "Sr.",
      "Evaluation ID",
      "User ID",
      "User",
      "Email",
      "Role",
      "User Status",
      "Project ID",
      "Project",
      "Project Target",
      "Project Received",
      "Project Completed",
      "Total Score",
      "Maximum Score",
      "Percentage",
      "Performance Band",
      "Question Count",
      "Overall Remarks",
      "Evaluated At",
      "Created At",
      "Updated At",
    ];

    styleTitle(
      evaluationSheet,
      "PERFORMANCE EVALUATION SUMMARY",
      evaluationHeaders.length,
    );

    evaluationSheet.addRow([]);

    const evaluationHeaderRow = evaluationSheet.addRow(evaluationHeaders);

    styleHeaderRow(evaluationHeaderRow);

    preparedEvaluations.forEach((evaluation, index) => {
      evaluationSheet.addRow([
        index + 1,
        evaluation.id,

        evaluation.user.id,
        evaluation.user.name || "Unnamed user",
        evaluation.user.email,
        evaluation.user.role,
        evaluation.user.status,

        evaluation.project.id,
        evaluation.project.name,

        evaluation.project.target,
        evaluation.project.received,
        evaluation.project.completed,

        evaluation.totalScore,
        evaluation.maximumScore,
        evaluation.percentage,
        evaluation.performanceBand,

        evaluation.answers.length,

        evaluation.remarks || "",

        formatDateTime(evaluation.evaluatedAt),

        formatDateTime(evaluation.createdAt),

        formatDateTime(evaluation.updatedAt),
      ]);
    });

    evaluationSheet.columns = evaluationHeaders.map((header) => ({
      width: header.includes("Remarks")
        ? 48
        : header.includes("ID")
          ? 36
          : header.includes("At")
            ? 23
            : header === "Email"
              ? 34
              : header === "Project" || header === "User"
                ? 28
                : 18,
    }));

    evaluationSheet.getColumn(15).numFmt = '0.00"%"';

    styleDataRows(evaluationSheet, 4);

    configureWorksheet(evaluationSheet, 3, evaluationHeaders.length);

    /*
     * Sheet 3: Evaluation Answers
     */
    const answerSheet = workbook.addWorksheet("Evaluation Answers", {
      properties: {
        tabColor: {
          argb: "FF70AD47",
        },
      },
    });

    const answerHeaders = [
      "Sr.",
      "Answer ID",
      "Evaluation ID",
      "User ID",
      "User",
      "Email",
      "Project ID",
      "Project",
      "Question ID",
      "Question",
      "Score",
      "Maximum Score",
      "Question Percentage",
      "Answer Remark",
      "Evaluation Remarks",
      "Evaluated At",
      "Answer Created At",
      "Answer Updated At",
    ];

    styleTitle(
      answerSheet,
      "PERFORMANCE EVALUATION ANSWERS",
      answerHeaders.length,
    );

    answerSheet.addRow([]);

    const answerHeaderRow = answerSheet.addRow(answerHeaders);

    styleHeaderRow(answerHeaderRow);

    let answerNumber = 1;

    preparedEvaluations.forEach((evaluation) => {
      evaluation.answers.forEach((answer) => {
        answerSheet.addRow([
          answerNumber,
          answer.id,
          evaluation.id,

          evaluation.user.id,
          evaluation.user.name || "Unnamed user",
          evaluation.user.email,

          evaluation.project.id,
          evaluation.project.name,

          answer.question.id,
          answer.question.question,

          answer.score,
          answer.question.maxScore,

          calculatePercentage(answer.score, answer.question.maxScore),

          answer.remark || "",
          evaluation.remarks || "",

          formatDateTime(evaluation.evaluatedAt),

          formatDateTime(answer.createdAt),

          formatDateTime(answer.updatedAt),
        ]);

        answerNumber += 1;
      });
    });

    answerSheet.columns = answerHeaders.map((header) => ({
      width:
        header === "Question"
          ? 55
          : header.includes("Remark")
            ? 45
            : header.includes("ID")
              ? 35
              : header.includes("At")
                ? 23
                : header === "Email"
                  ? 34
                  : 20,
    }));

    answerSheet.getColumn(13).numFmt = '0.00"%"';

    styleDataRows(answerSheet, 4);

    configureWorksheet(answerSheet, 3, answerHeaders.length);

    /*
     * Sheet 4: User Summary
     */
    const userMap = new Map<
      string,
      {
        id: string;
        name: string;
        email: string;
        role: string;
        status: string;
        evaluations: number;
        projectIds: Set<string>;
        totalScore: number;
        totalMaximumScore: number;
        percentages: number[];
        latestEvaluation: Date;
      }
    >();

    preparedEvaluations.forEach((evaluation) => {
      const current = userMap.get(evaluation.user.id) ?? {
        id: evaluation.user.id,
        name: evaluation.user.name || "Unnamed user",
        email: evaluation.user.email,
        role: evaluation.user.role,
        status: evaluation.user.status,
        evaluations: 0,
        projectIds: new Set<string>(),
        totalScore: 0,
        totalMaximumScore: 0,
        percentages: [],
        latestEvaluation: evaluation.evaluatedAt,
      };

      current.evaluations += 1;

      current.projectIds.add(evaluation.project.id);

      current.totalScore += evaluation.totalScore;

      current.totalMaximumScore += evaluation.maximumScore;

      current.percentages.push(evaluation.percentage);

      if (evaluation.evaluatedAt > current.latestEvaluation) {
        current.latestEvaluation = evaluation.evaluatedAt;
      }

      userMap.set(evaluation.user.id, current);
    });

    const userSheet = workbook.addWorksheet("User Summary");

    const userHeaders = [
      "Sr.",
      "User ID",
      "User",
      "Email",
      "Role",
      "Status",
      "Evaluations",
      "Evaluated Projects",
      "Total Score",
      "Total Maximum Score",
      "Overall Percentage",
      "Average Evaluation",
      "Best Evaluation",
      "Lowest Evaluation",
      "Performance Band",
      "Latest Evaluation",
    ];

    styleTitle(userSheet, "USER PERFORMANCE SUMMARY", userHeaders.length);

    userSheet.addRow([]);

    const userHeaderRow = userSheet.addRow(userHeaders);

    styleHeaderRow(userHeaderRow);

    Array.from(userMap.values())
      .sort((first, second) => first.name.localeCompare(second.name))
      .forEach((user, index) => {
        const overallPercentage = calculatePercentage(
          user.totalScore,
          user.totalMaximumScore,
        );

        const average =
          user.percentages.reduce(
            (total, percentage) => total + percentage,
            0,
          ) / user.percentages.length;

        userSheet.addRow([
          index + 1,
          user.id,
          user.name,
          user.email,
          user.role,
          user.status,
          user.evaluations,
          user.projectIds.size,
          user.totalScore,
          user.totalMaximumScore,
          overallPercentage,
          Number(average.toFixed(2)),
          Math.max(...user.percentages),
          Math.min(...user.percentages),
          getPerformanceBand(overallPercentage),
          formatDateTime(user.latestEvaluation),
        ]);
      });

    userSheet.columns = userHeaders.map((header) => ({
      width: header.includes("ID")
        ? 36
        : header === "Email"
          ? 34
          : header === "User"
            ? 28
            : header.includes("Evaluation")
              ? 22
              : 18,
    }));

    [11, 12, 13, 14].forEach((column) => {
      userSheet.getColumn(column).numFmt = '0.00"%"';
    });

    styleDataRows(userSheet, 4);

    configureWorksheet(userSheet, 3, userHeaders.length);

    /*
     * Sheet 5: Project Summary
     */
    const projectMap = new Map<
      string,
      {
        id: string;
        name: string;
        target: number;
        received: number;
        completed: number;
        evaluations: number;
        userIds: Set<string>;
        percentages: number[];
        latestEvaluation: Date;
      }
    >();

    preparedEvaluations.forEach((evaluation) => {
      const current = projectMap.get(evaluation.project.id) ?? {
        id: evaluation.project.id,
        name: evaluation.project.name,
        target: evaluation.project.target,
        received: evaluation.project.received,
        completed: evaluation.project.completed,
        evaluations: 0,
        userIds: new Set<string>(),
        percentages: [],
        latestEvaluation: evaluation.evaluatedAt,
      };

      current.evaluations += 1;

      current.userIds.add(evaluation.user.id);

      current.percentages.push(evaluation.percentage);

      if (evaluation.evaluatedAt > current.latestEvaluation) {
        current.latestEvaluation = evaluation.evaluatedAt;
      }

      projectMap.set(evaluation.project.id, current);
    });

    const projectSheet = workbook.addWorksheet("Project Summary");

    const projectHeaders = [
      "Sr.",
      "Project ID",
      "Project",
      "Target",
      "Received",
      "Completed",
      "Project Completion %",
      "Evaluations",
      "Evaluated Users",
      "Average Performance",
      "Best Performance",
      "Lowest Performance",
      "Latest Evaluation",
    ];

    styleTitle(
      projectSheet,
      "PROJECT PERFORMANCE SUMMARY",
      projectHeaders.length,
    );

    projectSheet.addRow([]);

    const projectHeaderRow = projectSheet.addRow(projectHeaders);

    styleHeaderRow(projectHeaderRow);

    Array.from(projectMap.values())
      .sort((first, second) => first.name.localeCompare(second.name))
      .forEach((project, index) => {
        const average =
          project.percentages.reduce(
            (total, percentage) => total + percentage,
            0,
          ) / project.percentages.length;

        projectSheet.addRow([
          index + 1,
          project.id,
          project.name,
          project.target,
          project.received,
          project.completed,

          calculatePercentage(project.completed, project.target),

          project.evaluations,
          project.userIds.size,
          Number(average.toFixed(2)),

          Math.max(...project.percentages),

          Math.min(...project.percentages),

          formatDateTime(project.latestEvaluation),
        ]);
      });

    projectSheet.columns = projectHeaders.map((header) => ({
      width: header.includes("ID")
        ? 36
        : header === "Project"
          ? 32
          : header.includes("Performance") || header.includes("Completion")
            ? 22
            : 18,
    }));

    [7, 10, 11, 12].forEach((column) => {
      projectSheet.getColumn(column).numFmt = '0.00"%"';
    });

    styleDataRows(projectSheet, 4);

    configureWorksheet(projectSheet, 3, projectHeaders.length);

    /*
     * Sheet 6: Questions
     */
    const questionSheet = workbook.addWorksheet("Questions");

    const questionHeaders = [
      "Sr.",
      "Question ID",
      "Question",
      "Maximum Score",
      "Answer Count",
      "Average Score",
      "Average Percentage",
      "Highest Score",
      "Lowest Score",
      "Remarks Count",
      "Created At",
      "Updated At",
    ];

    styleTitle(questionSheet, "PERFORMANCE QUESTIONS", questionHeaders.length);

    questionSheet.addRow([]);

    const questionHeaderRow = questionSheet.addRow(questionHeaders);

    styleHeaderRow(questionHeaderRow);

    performanceQuestions.forEach((question, index) => {
      const answers = preparedEvaluations.flatMap((evaluation) =>
        evaluation.answers.filter(
          (answer) => answer.questionId === question.id,
        ),
      );

      const totalScore = answers.reduce(
        (total, answer) => total + answer.score,
        0,
      );

      const averageScore = answers.length > 0 ? totalScore / answers.length : 0;

      const scores = answers.map((answer) => answer.score);

      questionSheet.addRow([
        index + 1,
        question.id,
        question.question,
        question.maxScore,
        answers.length,

        Number(averageScore.toFixed(2)),

        calculatePercentage(averageScore, question.maxScore),

        scores.length ? Math.max(...scores) : 0,

        scores.length ? Math.min(...scores) : 0,

        answers.filter((answer) => Boolean(answer.remark?.trim())).length,

        formatDateTime(question.createdAt),

        formatDateTime(question.updatedAt),
      ]);
    });

    questionSheet.columns = [
      {
        width: 8,
      },
      {
        width: 36,
      },
      {
        width: 58,
      },
      {
        width: 18,
      },
      {
        width: 16,
      },
      {
        width: 18,
      },
      {
        width: 20,
      },
      {
        width: 16,
      },
      {
        width: 16,
      },
      {
        width: 16,
      },
      {
        width: 23,
      },
      {
        width: 23,
      },
    ];

    questionSheet.getColumn(7).numFmt = '0.00"%"';

    styleDataRows(questionSheet, 4);

    configureWorksheet(questionSheet, 3, questionHeaders.length);

    const selectedProject = projectId
      ? preparedEvaluations.find(
          (evaluation) => evaluation.projectId === projectId,
        )?.project
      : null;

    const selectedUser = userId
      ? preparedEvaluations.find((evaluation) => evaluation.userId === userId)
          ?.user
      : null;

    const filenamePrefix = selectedProject
      ? `performance-${sanitizeFilename(selectedProject.name)}`
      : selectedUser
        ? `performance-${sanitizeFilename(
            selectedUser.name || selectedUser.email,
          )}`
        : "performance-evaluations";

    const filename = `${filenamePrefix}-${new Date()
      .toISOString()
      .slice(0, 10)}.xlsx`;

    const workbookBuffer = await workbook.xlsx.writeBuffer();

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

    res.setHeader("Cache-Control", "no-store");

    return res.status(200).send(Buffer.from(workbookBuffer));
  } catch (error) {
    console.error("Error exporting performance evaluations:", error);

    return res.status(500).json({
      success: false,
      error: "Failed to generate the performance Excel file.",
    });
  }
};
