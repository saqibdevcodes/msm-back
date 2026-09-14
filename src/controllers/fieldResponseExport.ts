import type { Request, Response } from "express";
import ExcelJS from "exceljs";

import { prisma } from "../lib/prisma.ts";

type AuthenticatedRequest = Request & {
  user?: {
    id?: string;
    userId?: string;
    email?: string;
    name?: string;
  };
  userId?: string;
};

interface ExportQuery {
  projectId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  ids?: string;
}

const TITLE_FILL = "1F4E78";
const HEADER_FILL = "4472C4";
const SUBHEADER_FILL = "D9EAF7";
const SUCCESS_FILL = "E2F0D9";
const WARNING_FILL = "FFF2CC";
const BORDER_COLOR = "D0D5DD";

const getAuthenticatedIdentifier = (req: Request) => {
  const authenticatedRequest = req as AuthenticatedRequest;

  return (
    authenticatedRequest.user?.id ||
    authenticatedRequest.user?.userId ||
    authenticatedRequest.user?.email ||
    authenticatedRequest.userId ||
    "Administrator"
  );
};

const parseDateStart = (value?: string): Date | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const parseDateEnd = (value?: string): Date | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(`${value}T23:59:59.999Z`);

  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const formatDate = (value?: Date | string | null) => {
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
  }).format(date);
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
    second: "2-digit",
  }).format(date);
};

const calculatePercentage = (value: number, total: number) => {
  if (total <= 0) {
    return 0;
  }

  return Number(((value / total) * 100).toFixed(2));
};

const sanitizeFilename = (value: string) =>
  value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

const styleTitle = (
  worksheet: ExcelJS.Worksheet,
  title: string,
  lastColumn: number,
) => {
  worksheet.mergeCells(1, 1, 1, lastColumn);

  const titleCell = worksheet.getCell(1, 1);

  titleCell.value = title;

  titleCell.font = {
    bold: true,
    size: 16,
    color: {
      argb: "FFFFFFFF",
    },
  };

  titleCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: {
      argb: `FF${TITLE_FILL}`,
    },
  };

  titleCell.alignment = {
    horizontal: "center",
    vertical: "middle",
  };

  worksheet.getRow(1).height = 28;
};

const styleHeaderRow = (row: ExcelJS.Row) => {
  row.height = 24;

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

const styleDataRows = (worksheet: ExcelJS.Worksheet, startRow: number) => {
  for (
    let rowNumber = startRow;
    rowNumber <= worksheet.rowCount;
    rowNumber += 1
  ) {
    const row = worksheet.getRow(rowNumber);

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

const setAutoFilter = (
  worksheet: ExcelJS.Worksheet,
  headerRow: number,
  lastColumn: number,
) => {
  worksheet.autoFilter = {
    from: {
      row: headerRow,
      column: 1,
    },
    to: {
      row: headerRow,
      column: lastColumn,
    },
  };

  worksheet.views = [
    {
      state: "frozen",
      ySplit: headerRow,
    },
  ];
};

export const exportFieldResponsesExcel = async (
  req: Request,
  res: Response,
) => {
  try {
    const { projectId, search, dateFrom, dateTo, ids } =
      req.query as ExportQuery;

    const normalizedSearch = search?.trim();

    const selectedIds = ids
      ? ids
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)
      : [];

    const fromDate = parseDateStart(dateFrom);

    const toDate = parseDateEnd(dateTo);

    const fieldResponses = await prisma.fieldResponse.findMany({
      where: {
        ...(projectId
          ? {
              projectId,
            }
          : {}),

        ...(selectedIds.length > 0
          ? {
              id: {
                in: selectedIds,
              },
            }
          : {}),

        ...(normalizedSearch
          ? {
              receivedFrom: {
                contains: normalizedSearch,
                mode: "insensitive",
              },
            }
          : {}),

        ...(fromDate || toDate
          ? {
              createdAt: {
                ...(fromDate
                  ? {
                      gte: fromDate,
                    }
                  : {}),

                ...(toDate
                  ? {
                      lte: toDate,
                    }
                  : {}),
              },
            }
          : {}),
      },

      select: {
        id: true,
        projectId: true,
        receivedFrom: true,
        quantity: true,
        createdAt: true,
        updatedAt: true,

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

            users: {
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

              orderBy: {
                assignedAt: "asc",
              },
            },
          },
        },
      },

      orderBy: [
        {
          project: {
            name: "asc",
          },
        },
        {
          createdAt: "desc",
        },
      ],
    });

    if (fieldResponses.length === 0) {
      return res.status(404).json({
        success: false,
        error: "No field responses match the selected filters.",
      });
    }

    const projectMap = new Map<
      string,
      (typeof fieldResponses)[number]["project"]
    >();

    fieldResponses.forEach((response) => {
      projectMap.set(response.project.id, response.project);
    });

    const projects = Array.from(projectMap.values());

    const totalQuantity = fieldResponses.reduce(
      (total, response) => total + response.quantity,
      0,
    );

    const sourceSummaryMap = new Map<
      string,
      {
        projectId: string;
        projectName: string;
        receivedFrom: string;
        entries: number;
        quantity: number;
        firstEntry: Date;
        lastEntry: Date;
        projectReceived: number;
      }
    >();

    fieldResponses.forEach((response) => {
      const sourceKey = `${response.projectId}::${response.receivedFrom
        .trim()
        .toLowerCase()}`;

      const existing = sourceSummaryMap.get(sourceKey);

      if (existing) {
        existing.entries += 1;
        existing.quantity += response.quantity;

        if (response.createdAt < existing.firstEntry) {
          existing.firstEntry = response.createdAt;
        }

        if (response.createdAt > existing.lastEntry) {
          existing.lastEntry = response.createdAt;
        }

        return;
      }

      sourceSummaryMap.set(sourceKey, {
        projectId: response.projectId,

        projectName: response.project.name,

        receivedFrom: response.receivedFrom,

        entries: 1,

        quantity: response.quantity,

        firstEntry: response.createdAt,

        lastEntry: response.createdAt,

        projectReceived: response.project.received,
      });
    });

    const sourceSummaries = Array.from(sourceSummaryMap.values()).sort(
      (first, second) =>
        first.projectName.localeCompare(second.projectName) ||
        second.quantity - first.quantity,
    );

    const workbook = new ExcelJS.Workbook();

    workbook.creator = "Project Management System";

    workbook.lastModifiedBy = String(getAuthenticatedIdentifier(req));

    workbook.created = new Date();
    workbook.modified = new Date();

    workbook.properties = {
      date1904: false,
    };

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

    styleTitle(informationSheet, "FIELD RESPONSES EXPORT", 4);

    informationSheet.columns = [
      {
        key: "label",
        width: 28,
      },
      {
        key: "value",
        width: 60,
      },
      {
        key: "extraLabel",
        width: 28,
      },
      {
        key: "extraValue",
        width: 42,
      },
    ];

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
        "Search Filter",
        normalizedSearch || "None",
      ],
      [
        "Date From",
        dateFrom || "Not applied",
        "Date To",
        dateTo || "Not applied",
      ],
      [
        "Selected IDs",
        selectedIds.length ? selectedIds.join(", ") : "None",
        "Exported Projects",
        projects.length,
      ],
      [
        "Field Response Entries",
        fieldResponses.length,
        "Total Quantity",
        totalQuantity,
      ],
    ];

    informationRows.forEach((values, index) => {
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
              argb: `FF${SUBHEADER_FILL}`,
            },
          };
        } else if (index % 2 === 1) {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: {
              argb: "FFF7F9FC",
            },
          };
        }
      });
    });

    /*
     * Sheet 2: Field Responses
     */
    const responsesSheet = workbook.addWorksheet("Field Responses", {
      properties: {
        tabColor: {
          argb: "FF4472C4",
        },
      },
    });

    const responseHeaders = [
      "Sr.",
      "Response ID",
      "Project ID",
      "Project",
      "Project Description",
      "Deadline",
      "Received From",
      "Quantity",
      "Project Target",
      "Project Received",
      "Project Completed",
      "Remaining to Target",
      "Field Progress %",
      "Source Contribution %",
      "Added At",
      "Last Updated At",
    ];

    styleTitle(
      responsesSheet,
      "DETAILED FIELD RESPONSES",
      responseHeaders.length,
    );

    responsesSheet.addRow([]);

    const responseHeaderRow = responsesSheet.addRow(responseHeaders);

    styleHeaderRow(responseHeaderRow);

    fieldResponses.forEach((response, index) => {
      responsesSheet.addRow([
        index + 1,
        response.id,
        response.projectId,
        response.project.name,
        response.project.description || "",
        formatDate(response.project.deadline),
        response.receivedFrom,
        response.quantity,
        response.project.target,
        response.project.received,
        response.project.completed,

        Math.max(response.project.target - response.project.received, 0),

        calculatePercentage(response.project.received, response.project.target),

        calculatePercentage(response.quantity, response.project.received),

        formatDateTime(response.createdAt),

        formatDateTime(response.updatedAt),
      ]);
    });

    responsesSheet.columns = [
      {
        width: 8,
      },
      {
        width: 38,
      },
      {
        width: 28,
      },
      {
        width: 28,
      },
      {
        width: 46,
      },
      {
        width: 16,
      },
      {
        width: 28,
      },
      {
        width: 14,
      },
      {
        width: 14,
      },
      {
        width: 16,
      },
      {
        width: 16,
      },
      {
        width: 18,
      },
      {
        width: 18,
      },
      {
        width: 22,
      },
      {
        width: 24,
      },
      {
        width: 24,
      },
    ];

    styleDataRows(responsesSheet, 4);

    setAutoFilter(responsesSheet, 3, responseHeaders.length);

    responsesSheet.getColumn(13).numFmt = '0.00"%"';

    responsesSheet.getColumn(14).numFmt = '0.00"%"';

    /*
     * Sheet 3: Project Summary
     */
    const projectSheet = workbook.addWorksheet("Project Summary", {
      properties: {
        tabColor: {
          argb: "FF70AD47",
        },
      },
    });

    const projectHeaders = [
      "Sr.",
      "Project ID",
      "Project",
      "Description",
      "Deadline",
      "Target",
      "Received",
      "Completed",
      "Remaining to Target",
      "Remaining to Complete",
      "Field Progress %",
      "Completion %",
      "Field Entries",
      "Field Quantity Total",
      "Unique Sources",
      "Assigned Users",
      "Competition Enabled",
      "Competition Target",
      "Competition Received",
      "Competition Completed",
      "Created At",
      "Updated At",
    ];

    styleTitle(
      projectSheet,
      "PROJECT FIELD RESPONSE SUMMARY",
      projectHeaders.length,
    );

    projectSheet.addRow([]);

    const projectHeaderRow = projectSheet.addRow(projectHeaders);

    styleHeaderRow(projectHeaderRow);

    projects.forEach((project, index) => {
      const projectResponses = fieldResponses.filter(
        (response) => response.projectId === project.id,
      );

      const projectQuantity = projectResponses.reduce(
        (total, response) => total + response.quantity,
        0,
      );

      const uniqueSources = new Set(
        projectResponses.map((response) =>
          response.receivedFrom.trim().toLowerCase(),
        ),
      ).size;

      projectSheet.addRow([
        index + 1,
        project.id,
        project.name,
        project.description || "",
        formatDate(project.deadline),
        project.target,
        project.received,
        project.completed,

        Math.max(project.target - project.received, 0),

        Math.max(project.received - project.completed, 0),

        calculatePercentage(project.received, project.target),

        calculatePercentage(project.completed, project.target),

        projectResponses.length,
        projectQuantity,
        uniqueSources,
        project.users.length,

        project.competition ? "Yes" : "No",

        project.competitionTarget,
        project.competitionReceived,
        project.competitionCompleted,

        formatDateTime(project.createdAt),

        formatDateTime(project.updatedAt),
      ]);
    });

    projectSheet.columns = projectHeaders.map((header) => ({
      width:
        header === "Description"
          ? 48
          : header.includes("ID")
            ? 32
            : header.includes("Created") || header.includes("Updated")
              ? 24
              : 18,
    }));

    projectSheet.getColumn(12).numFmt = '0.00"%"';

    projectSheet.getColumn(13).numFmt = '0.00"%"';

    styleDataRows(projectSheet, 4);

    setAutoFilter(projectSheet, 3, projectHeaders.length);

    /*
     * Sheet 4: Source Summary
     */
    const sourceSheet = workbook.addWorksheet("Source Summary", {
      properties: {
        tabColor: {
          argb: "FFFFC000",
        },
      },
    });

    const sourceHeaders = [
      "Sr.",
      "Project ID",
      "Project",
      "Received From",
      "Entry Count",
      "Total Quantity",
      "Project Received",
      "Contribution %",
      "First Entry",
      "Latest Entry",
    ];

    styleTitle(sourceSheet, "FIELD SOURCE SUMMARY", sourceHeaders.length);

    sourceSheet.addRow([]);

    const sourceHeaderRow = sourceSheet.addRow(sourceHeaders);

    styleHeaderRow(sourceHeaderRow);

    sourceSummaries.forEach((source, index) => {
      sourceSheet.addRow([
        index + 1,
        source.projectId,
        source.projectName,
        source.receivedFrom,
        source.entries,
        source.quantity,
        source.projectReceived,

        calculatePercentage(source.quantity, source.projectReceived),

        formatDateTime(source.firstEntry),

        formatDateTime(source.lastEntry),
      ]);
    });

    sourceSheet.columns = [
      {
        width: 8,
      },
      {
        width: 30,
      },
      {
        width: 30,
      },
      {
        width: 30,
      },
      {
        width: 14,
      },
      {
        width: 16,
      },
      {
        width: 18,
      },
      {
        width: 18,
      },
      {
        width: 24,
      },
      {
        width: 24,
      },
    ];

    sourceSheet.getColumn(8).numFmt = '0.00"%"';

    styleDataRows(sourceSheet, 4);

    setAutoFilter(sourceSheet, 3, sourceHeaders.length);

    /*
     * Sheet 5: Project Assignments
     */
    const assignmentSheet = workbook.addWorksheet("Project Assignments", {
      properties: {
        tabColor: {
          argb: "FFA5A5A5",
        },
      },
    });

    const assignmentHeaders = [
      "Sr.",
      "Assignment ID",
      "Project ID",
      "Project",
      "User ID",
      "User",
      "Email",
      "Role",
      "User Status",
      "Assigned At",
    ];

    styleTitle(
      assignmentSheet,
      "PROJECT USER ASSIGNMENTS",
      assignmentHeaders.length,
    );

    assignmentSheet.addRow([]);

    const assignmentHeaderRow = assignmentSheet.addRow(assignmentHeaders);

    styleHeaderRow(assignmentHeaderRow);

    let assignmentNumber = 1;

    projects.forEach((project) => {
      project.users.forEach((assignment) => {
        assignmentSheet.addRow([
          assignmentNumber,
          assignment.id,
          project.id,
          project.name,
          assignment.user.id,
          assignment.user.name || "",
          assignment.user.email,
          assignment.user.role,
          assignment.user.status,
          formatDateTime(assignment.assignedAt),
        ]);

        assignmentNumber += 1;
      });
    });

    assignmentSheet.columns = [
      {
        width: 8,
      },
      {
        width: 38,
      },
      {
        width: 30,
      },
      {
        width: 30,
      },
      {
        width: 38,
      },
      {
        width: 28,
      },
      {
        width: 34,
      },
      {
        width: 14,
      },
      {
        width: 16,
      },
      {
        width: 24,
      },
    ];

    styleDataRows(assignmentSheet, 4);

    setAutoFilter(assignmentSheet, 3, assignmentHeaders.length);

    /*
     * Highlight useful totals.
     */
    [responsesSheet, projectSheet, sourceSheet, assignmentSheet].forEach(
      (worksheet) => {
        worksheet.pageSetup = {
          orientation: "landscape",
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 0,
          paperSize: 9,
        };

        worksheet.pageSetup.margins = {
          left: 0.25,
          right: 0.25,
          top: 0.5,
          bottom: 0.5,
          header: 0.2,
          footer: 0.2,
        };

        worksheet.headerFooter.oddFooter =
          "&LGenerated by Project Management System&CPage &P of &N&R&D &T";
      },
    );

    const selectedProject =
      projectId && projects.length === 1 ? projects[0] : null;

    const filenameBase = selectedProject
      ? `field-responses-${sanitizeFilename(selectedProject.name)}`
      : "field-responses-all-projects";

    const filename = `${filenameBase}-${new Date()
      .toISOString()
      .slice(0, 10)}.xlsx`;

    const workbookBuffer = await workbook.xlsx.writeBuffer();

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

    return res.status(200).send(Buffer.from(workbookBuffer));
  } catch (error) {
    console.error("Error exporting field responses:", error);

    return res.status(500).json({
      success: false,
      error: "Failed to generate the field responses Excel file.",
    });
  }
};
