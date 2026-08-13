import { prisma } from "../lib/prisma.ts";

import {
  sendProjectAssignmentNotifications,
  type AssignmentNotificationChange,
} from "./projectAssignmentNotification.ts";

import type {
  AssignmentProject,
  AssignmentUser,
} from "./projectAssignmentMail.ts";

const userSelect = {
  id: true,
  name: true,
  email: true,
  status: true,
} as const;

const projectSelect = {
  id: true,
  name: true,
  description: true,
  deadline: true,
  target: true,
  received: true,
  completed: true,
} as const;

export class AssignmentServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "AssignmentServiceError";
    this.statusCode = statusCode;
  }
}

const normalizeIds = (values: unknown): string[] => {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(
    new Set(
      values
        .filter(
          (value): value is string =>
            typeof value === "string" && Boolean(value.trim()),
        )
        .map((value) => value.trim()),
    ),
  );
};

const createAssignmentKey = (projectId: string, userId: string) =>
  `${projectId}:${userId}`;

const getOrCreateChange = (
  changes: Map<string, AssignmentNotificationChange>,
  user: AssignmentUser,
) => {
  const existing = changes.get(user.id);

  if (existing) {
    return existing;
  }

  const change: AssignmentNotificationChange = {
    user,
    addedProjects: [],
    removedProjects: [],
  };

  changes.set(user.id, change);

  return change;
};

export const assignUsersToProjects = async ({
  rawProjectIds,
  rawUserIds,
  replaceExisting,
}: {
  rawProjectIds: unknown;
  rawUserIds: unknown;
  replaceExisting: boolean;
}) => {
  const projectIds = normalizeIds(rawProjectIds);

  const userIds = normalizeIds(rawUserIds);

  if (projectIds.length === 0) {
    throw new AssignmentServiceError("Select at least one project.");
  }

  /*
   * Empty users are allowed only in replace
   * mode. This removes every user from the
   * selected projects.
   */
  if (userIds.length === 0 && !replaceExisting) {
    throw new AssignmentServiceError("Select at least one user.");
  }

  const [projects, selectedUsers, existingAssignments] = await Promise.all([
    prisma.project.findMany({
      where: {
        id: {
          in: projectIds,
        },
      },
      select: projectSelect,
    }),

    userIds.length > 0
      ? prisma.user.findMany({
          where: {
            id: {
              in: userIds,
            },
            status: "active",
          },
          select: userSelect,
        })
      : Promise.resolve([]),

    prisma.projectUser.findMany({
      where: {
        projectId: {
          in: projectIds,
        },
      },
      select: {
        id: true,
        projectId: true,
        userId: true,

        project: {
          select: projectSelect,
        },

        user: {
          select: userSelect,
        },
      },
    }),
  ]);

  if (projects.length !== projectIds.length) {
    throw new AssignmentServiceError(
      "One or more selected projects do not exist.",
    );
  }

  if (selectedUsers.length !== userIds.length) {
    throw new AssignmentServiceError(
      "One or more selected users do not exist or are inactive.",
    );
  }

  const existingKeySet = new Set(
    existingAssignments.map((assignment) =>
      createAssignmentKey(assignment.projectId, assignment.userId),
    ),
  );

  const additions = projectIds.flatMap((projectId) =>
    userIds
      .filter(
        (userId) => !existingKeySet.has(createAssignmentKey(projectId, userId)),
      )
      .map((userId) => ({
        projectId,
        userId,
      })),
  );

  const selectedUserIdSet = new Set(userIds);

  const removals = replaceExisting
    ? existingAssignments.filter(
        (assignment) => !selectedUserIdSet.has(assignment.userId),
      )
    : [];

  await prisma.$transaction(async (transaction) => {
    if (removals.length > 0) {
      await transaction.projectUser.deleteMany({
        where: {
          id: {
            in: removals.map((assignment) => assignment.id),
          },
        },
      });
    }

    if (additions.length > 0) {
      await transaction.projectUser.createMany({
        data: additions,
        skipDuplicates: true,
      });
    }
  });

  const projectMap = new Map(projects.map((project) => [project.id, project]));

  const userMap = new Map(selectedUsers.map((user) => [user.id, user]));

  const changes = new Map<string, AssignmentNotificationChange>();

  additions.forEach((addition) => {
    const user = userMap.get(addition.userId);

    const project = projectMap.get(addition.projectId);

    if (!user || !project) {
      return;
    }

    const change = getOrCreateChange(changes, user);

    change.addedProjects.push(project);
  });

  removals.forEach((assignment) => {
    const change = getOrCreateChange(changes, assignment.user);

    change.removedProjects.push(assignment.project);
  });

  /*
   * Assignment transaction has already
   * committed. Email failures do not undo
   * database changes.
   */
  const email = await sendProjectAssignmentNotifications(
    Array.from(changes.values()),
  );

  return {
    addedAssignments: additions.length,

    removedAssignments: removals.length,

    affectedUsers: changes.size,

    email,
  };
};

export const assignProjectsToUsers = async ({
  rawUserIds,
  rawProjectIds,
  replaceExisting,
}: {
  rawUserIds: unknown;
  rawProjectIds: unknown;
  replaceExisting: boolean;
}) => {
  const userIds = normalizeIds(rawUserIds);

  const projectIds = normalizeIds(rawProjectIds);

  if (userIds.length === 0) {
    throw new AssignmentServiceError("Select at least one user.");
  }

  if (projectIds.length === 0 && !replaceExisting) {
    throw new AssignmentServiceError("Select at least one project.");
  }

  const [users, selectedProjects, existingAssignments] = await Promise.all([
    prisma.user.findMany({
      where: {
        id: {
          in: userIds,
        },
        status: "active",
      },
      select: userSelect,
    }),

    projectIds.length > 0
      ? prisma.project.findMany({
          where: {
            id: {
              in: projectIds,
            },
          },
          select: projectSelect,
        })
      : Promise.resolve([]),

    prisma.projectUser.findMany({
      where: {
        userId: {
          in: userIds,
        },
      },
      select: {
        id: true,
        projectId: true,
        userId: true,

        project: {
          select: projectSelect,
        },

        user: {
          select: userSelect,
        },
      },
    }),
  ]);

  if (users.length !== userIds.length) {
    throw new AssignmentServiceError(
      "One or more selected users do not exist or are inactive.",
    );
  }

  if (selectedProjects.length !== projectIds.length) {
    throw new AssignmentServiceError(
      "One or more selected projects do not exist.",
    );
  }

  const existingKeySet = new Set(
    existingAssignments.map((assignment) =>
      createAssignmentKey(assignment.projectId, assignment.userId),
    ),
  );

  const additions = userIds.flatMap((userId) =>
    projectIds
      .filter(
        (projectId) =>
          !existingKeySet.has(createAssignmentKey(projectId, userId)),
      )
      .map((projectId) => ({
        projectId,
        userId,
      })),
  );

  const selectedProjectIdSet = new Set(projectIds);

  /*
   * Only remove assignments belonging to
   * the selected users.
   */
  const removals = replaceExisting
    ? existingAssignments.filter(
        (assignment) => !selectedProjectIdSet.has(assignment.projectId),
      )
    : [];

  await prisma.$transaction(async (transaction) => {
    if (removals.length > 0) {
      await transaction.projectUser.deleteMany({
        where: {
          id: {
            in: removals.map((assignment) => assignment.id),
          },
        },
      });
    }

    if (additions.length > 0) {
      await transaction.projectUser.createMany({
        data: additions,
        skipDuplicates: true,
      });
    }
  });

  const userMap = new Map(users.map((user) => [user.id, user]));

  const projectMap = new Map(
    selectedProjects.map((project) => [project.id, project]),
  );

  existingAssignments.forEach((assignment) => {
    if (!projectMap.has(assignment.project.id)) {
      projectMap.set(assignment.project.id, assignment.project);
    }
  });

  const changes = new Map<string, AssignmentNotificationChange>();

  additions.forEach((addition) => {
    const user = userMap.get(addition.userId);

    const project = projectMap.get(addition.projectId);

    if (!user || !project) {
      return;
    }

    const change = getOrCreateChange(changes, user);

    change.addedProjects.push(project);
  });

  removals.forEach((assignment) => {
    const user = userMap.get(assignment.userId) || assignment.user;

    const change = getOrCreateChange(changes, user);

    change.removedProjects.push(assignment.project);
  });

  const email = await sendProjectAssignmentNotifications(
    Array.from(changes.values()),
  );

  return {
    addedAssignments: additions.length,

    removedAssignments: removals.length,

    affectedUsers: changes.size,

    email,
  };
};

export const removeUserFromProject = async ({
  projectId,
  userId,
}: {
  projectId: string;
  userId: string;
}) => {
  const assignment = await prisma.projectUser.findUnique({
    where: {
      projectId_userId: {
        projectId,
        userId,
      },
    },

    select: {
      id: true,

      project: {
        select: projectSelect,
      },

      user: {
        select: userSelect,
      },
    },
  });

  if (!assignment) {
    throw new AssignmentServiceError(
      "This user is not assigned to the project.",
      404,
    );
  }

  await prisma.projectUser.delete({
    where: {
      id: assignment.id,
    },
  });

  const email = await sendProjectAssignmentNotifications([
    {
      user: assignment.user,
      addedProjects: [],
      removedProjects: [assignment.project],
    },
  ]);

  return {
    removedAssignments: 1,
    affectedUsers: 1,
    email,
  };
};
