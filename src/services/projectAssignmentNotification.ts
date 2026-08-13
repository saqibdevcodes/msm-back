import { transporter } from "../utils/mail.ts";

import {
  projectAssignmentChangedEmail,
  type AssignmentProject,
  type AssignmentUser,
} from "./projectAssignmentMail.ts";

export interface AssignmentNotificationChange {
  user: AssignmentUser;
  addedProjects: AssignmentProject[];
  removedProjects: AssignmentProject[];
}

export interface AssignmentEmailSummary {
  attempted: number;
  sent: number;
  failed: number;
}

const deduplicateProjects = (projects: AssignmentProject[]) => {
  const projectMap = new Map<string, AssignmentProject>();

  projects.forEach((project) => {
    projectMap.set(project.id, project);
  });

  return Array.from(projectMap.values());
};

export const sendProjectAssignmentNotifications = async (
  changes: AssignmentNotificationChange[],
): Promise<AssignmentEmailSummary> => {
  const relevantChanges = changes
    .map((change) => ({
      ...change,

      addedProjects: deduplicateProjects(change.addedProjects),

      removedProjects: deduplicateProjects(change.removedProjects),
    }))
    .filter(
      (change) =>
        change.user.email &&
        (change.addedProjects.length > 0 || change.removedProjects.length > 0),
    );

  const results = await Promise.allSettled(
    relevantChanges.map(async (change) => {
      const mailOptions = projectAssignmentChangedEmail(change);

      await transporter.sendMail(mailOptions);

      return {
        userId: change.user.id,
        email: change.user.email,
      };
    }),
  );

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error("Project assignment email failed:", {
        userId: relevantChanges[index]?.user.id,

        email: relevantChanges[index]?.user.email,

        error: result.reason,
      });
    }
  });

  const sent = results.filter((result) => result.status === "fulfilled").length;

  return {
    attempted: results.length,
    sent,
    failed: results.length - sent,
  };
};
