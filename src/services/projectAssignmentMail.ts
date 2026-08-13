interface AssignmentProject {
  id: string;
  name: string;
  description: string | null;
  deadline: Date;
  target: number;
  received: number;
  completed: number;
}

interface AssignmentUser {
  id: string;
  name: string | null;
  email: string;
}

interface ProjectAssignmentEmailParams {
  user: AssignmentUser;
  addedProjects: AssignmentProject[];
  removedProjects: AssignmentProject[];
}

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const formatDate = (value: Date | string) => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not available";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
};

const getProjectRows = (
  projects: AssignmentProject[],
  type: "added" | "removed",
) => {
  const statusColor = type === "added" ? "#15803d" : "#b91c1c";

  const statusBackground = type === "added" ? "#dcfce7" : "#fee2e2";

  const statusLabel = type === "added" ? "Assigned" : "Removed";

  return projects
    .map(
      (project) => `
        <tr>
          <td style="padding:12px;border-bottom:1px solid #e5e7eb;">
            <div style="font-weight:700;color:#111827;">
              ${escapeHtml(project.name)}
            </div>

            ${
              project.description
                ? `
                  <div style="margin-top:4px;color:#6b7280;font-size:13px;">
                    ${escapeHtml(project.description)}
                  </div>
                `
                : ""
            }
          </td>

          <td style="padding:12px;border-bottom:1px solid #e5e7eb;white-space:nowrap;">
            ${formatDate(project.deadline)}
          </td>

          <td style="padding:12px;border-bottom:1px solid #e5e7eb;text-align:center;">
            ${project.completed}/${project.target}
          </td>

          <td style="padding:12px;border-bottom:1px solid #e5e7eb;text-align:center;">
            <span style="
              display:inline-block;
              border-radius:999px;
              padding:5px 10px;
              font-size:12px;
              font-weight:700;
              color:${statusColor};
              background:${statusBackground};
            ">
              ${statusLabel}
            </span>
          </td>
        </tr>
      `,
    )
    .join("");
};

const getTextProjectList = (title: string, projects: AssignmentProject[]) => {
  if (projects.length === 0) {
    return "";
  }

  return [
    title,
    ...projects.map(
      (project) =>
        `- ${project.name} | Deadline: ${formatDate(
          project.deadline,
        )} | Progress: ${project.completed}/${project.target}`,
    ),
  ].join("\n");
};

export const projectAssignmentChangedEmail = ({
  user,
  addedProjects,
  removedProjects,
}: ProjectAssignmentEmailParams) => {
  const userName = user.name?.trim() || "User";

  let subject = "Your project assignments were updated";

  if (addedProjects.length > 0 && removedProjects.length === 0) {
    subject =
      addedProjects.length === 1
        ? `You have been assigned to ${addedProjects[0]?.name}`
        : `${addedProjects.length} projects have been assigned to you`;
  }

  if (removedProjects.length > 0 && addedProjects.length === 0) {
    subject =
      removedProjects.length === 1
        ? `You have been removed from ${removedProjects[0]?.name}`
        : `You have been removed from ${removedProjects.length} projects`;
  }

  const frontendUrl =
    process.env.USER_WORKSPACE_URL ||
    `${process.env.FRONTEND_URL || "http://localhost:5173"}/workspace`;

  const allProjects = [
    ...addedProjects.map((project) => ({
      project,
      type: "added" as const,
    })),

    ...removedProjects.map((project) => ({
      project,
      type: "removed" as const,
    })),
  ];

  const htmlRows = allProjects
    .map(({ project, type }) => getProjectRows([project], type))
    .join("");

  const text = [
    `Dear ${userName},`,
    "",
    "Your project assignments have been updated.",
    "",
    getTextProjectList("Newly assigned projects:", addedProjects),
    "",
    getTextProjectList("Removed projects:", removedProjects),
    "",
    `Open your workspace: ${frontendUrl}`,
    "",
    "Regards,",
    "Project Management Team",
  ]
    .filter((line, index, array) => line !== "" || array[index - 1] !== "")
    .join("\n");

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />

        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0"
        />

        <title>${escapeHtml(subject)}</title>
      </head>

      <body style="
        margin:0;
        padding:0;
        background:#f3f4f6;
        font-family:Arial,Helvetica,sans-serif;
        color:#111827;
      ">
        <div style="
          max-width:760px;
          margin:30px auto;
          background:#ffffff;
          border-radius:14px;
          overflow:hidden;
          border:1px solid #e5e7eb;
        ">
          <div style="
            padding:24px;
            background:#1f4e78;
            color:#ffffff;
          ">
            <h1 style="margin:0;font-size:22px;">
              Project Assignment Update
            </h1>

            <p style="
              margin:7px 0 0;
              color:#dbeafe;
              font-size:14px;
            ">
              Your assigned-project list has changed.
            </p>
          </div>

          <div style="padding:24px;">
            <p style="margin-top:0;">
              Dear
              <strong>${escapeHtml(userName)}</strong>,
            </p>

            <p style="line-height:1.6;color:#4b5563;">
              An administrator has updated your
              project assignments. The details
              are provided below.
            </p>

            <div style="
              margin:20px 0;
              overflow-x:auto;
              border:1px solid #e5e7eb;
              border-radius:10px;
            ">
              <table style="
                width:100%;
                border-collapse:collapse;
                font-size:14px;
              ">
                <thead>
                  <tr style="background:#f8fafc;">
                    <th style="padding:12px;text-align:left;">
                      Project
                    </th>

                    <th style="padding:12px;text-align:left;">
                      Deadline
                    </th>

                    <th style="padding:12px;text-align:center;">
                      Progress
                    </th>

                    <th style="padding:12px;text-align:center;">
                      Change
                    </th>
                  </tr>
                </thead>

                <tbody>
                  ${htmlRows}
                </tbody>
              </table>
            </div>

            ${
              addedProjects.length > 0
                ? `
                  <div style="
                    padding:12px 14px;
                    margin-bottom:16px;
                    border-radius:8px;
                    background:#eff6ff;
                    color:#1e40af;
                    font-size:13px;
                    line-height:1.5;
                  ">
                    Open your workspace to review
                    the project target, deadline,
                    performance remarks and progress.
                  </div>
                `
                : ""
            }

            <a
              href="${escapeHtml(frontendUrl)}"
              style="
                display:inline-block;
                padding:11px 18px;
                background:#2563eb;
                color:#ffffff;
                text-decoration:none;
                border-radius:8px;
                font-weight:700;
                font-size:14px;
              "
            >
              Open My Workspace
            </a>

            <p style="
              margin:24px 0 0;
              color:#6b7280;
              font-size:13px;
            ">
              This is an automatic notification.
              Contact the administrator if you
              believe this assignment change is
              incorrect.
            </p>
          </div>
        </div>
      </body>
    </html>
  `;

  return {
    from:
      process.env.MAIL_FROM ||
      process.env.SMTP_USER ||
      "Project Management <no-reply@example.com>",

    to: user.email,
    subject,
    text,
    html,
  };
};

export type { AssignmentProject, AssignmentUser, ProjectAssignmentEmailParams };
