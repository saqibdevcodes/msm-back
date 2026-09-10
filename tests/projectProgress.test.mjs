import { beforeEach, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.ts";
import { addMyProjectProgress, getMyProjectProgress, getAdminProjectProgress, voidProjectProgressEntry } from "../src/controllers/projectProgress.ts";

let worker, project, entries, assigned, calls;
let restorers = [];
// Prisma delegates are proxies, so replace their callable properties directly.
const stub = (object, method, replacement) => {
  const original = object[method];
  object[method] = replacement;
  restorers.push(() => { object[method] = original; });
};
const workDate = new Date().toISOString().slice(0, 10);
const invoke = async (handler, body = {}, params = { projectId: "project-1" }, query = {}) => {
  const response = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ user: { id: worker.id }, body, params, query, headers: {}, ip: "127.0.0.1" }, response);
  return response;
};
const submit = (overrides = {}) => invoke(addMyProjectProgress, { quantity: 3, workDate, category: "PROJECT", clientRequestId: "request-1", ...overrides });

beforeEach(() => {
  worker = { id: "worker-1", name: "Worker One", email: "worker@example.test", role: "user", status: "active" };
  project = { id: "project-1", name: "Project", target: 20, received: 10, completed: 2, competition: true, competitionTarget: 10, competitionReceived: 5, competitionCompleted: 0,
    users: [{ user: worker }, { user: { id: "worker-2", name: "No updates", email: "other@example.test" } }] };
  entries = [];
  calls = [];
  assigned = true;
  stub(console, "error", () => {});
  stub(prisma.user, "findFirst", async () => worker);
  stub(prisma.user, "findMany", async () => [worker]);
  stub(prisma.projectUser, "findUnique", async () => assigned ? { id: "assignment-1" } : null);
  stub(prisma, "$queryRaw", async () => { calls.push("lock"); return [{ id: project.id }]; });
  stub(prisma, "$transaction", async (callback) => callback(prisma));
  stub(prisma.project, "findUnique", async () => { calls.push("read project"); return project; });
  stub(prisma.project, "findUniqueOrThrow", async () => project);
  stub(prisma.project, "update", async ({ data }) => {
    calls.push("update total");
    for (const key of ["completed", "competitionCompleted"]) if (data[key]) project[key] += data[key].increment ?? -data[key].decrement;
    return project;
  });
  stub(prisma.projectProgressEntry, "findUnique", async ({ where }) => entries.find((entry) => where.id ? entry.id === where.id : entry.clientRequestId === where.clientRequestId) || null);
  stub(prisma.projectProgressEntry, "create", async ({ data }) => {
    calls.push("create entry");
    const entry = { ...data, id: `entry-${entries.length + 1}`, user: worker, createdBy: worker };
    entries.push(entry);
    return entry;
  });
  stub(prisma.projectProgressEntry, "update", async ({ where, data }) => Object.assign(entries.find((entry) => entry.id === where.id), data));
  stub(prisma.projectProgressEntry, "findMany", async ({ skip, take }) => entries.slice(skip, skip + take));
  stub(prisma.projectProgressEntry, "count", async () => entries.length);
  stub(prisma.projectProgressEntry, "groupBy", async () => {
    const groups = new Map();
    for (const entry of entries.filter((entry) => entry.status === "ACTIVE")) {
      const key = `${entry.userId}-${entry.category}`;
      const group = groups.get(key) || { userId: entry.userId, category: entry.category, _sum: { quantity: 0 }, _count: { _all: 0 } };
      group._sum.quantity += entry.quantity;
      group._count._all += 1;
      groups.set(key, group);
    }
    return [...groups.values()];
  });
});
afterEach(() => { for (const restore of restorers.reverse()) restore(); restorers = []; });

test("assigned worker records completed work and authenticated attribution", async () => {
  const response = await submit({ userId: "forged-user", createdById: "forged-admin" });
  assert.equal(response.code, 201);
  assert.equal(project.completed, 5);
  assert.equal(entries[0].userId, worker.id);
  assert.equal(entries[0].createdById, worker.id);
  assert.equal(entries[0].completedBefore, 2);
  assert.equal(entries[0].completedAfter, 5);
  assert.deepEqual(calls, ["lock", "read project", "create entry", "update total"]);
});

test("competition updates do not change regular completed work", async () => {
  assert.equal((await submit({ category: "COMPETITION" })).code, 201);
  assert.equal(project.completed, 2);
  assert.equal(project.competitionCompleted, 3);
});

test("unassigned and inactive users cannot submit", async () => {
  assigned = false;
  assert.equal((await submit()).code, 403);
  assigned = true;
  worker.status = "inactive";
  assert.equal((await submit()).code, 403);
  assert.equal(entries.length, 0);
});

test("invalid quantities, impossible dates and future work dates are rejected", async () => {
  for (const quantity of [0, -2, 1.5, true, [], "abc", 2147483648]) assert.equal((await submit({ quantity })).code, 400);
  assert.equal((await submit({ workDate: "2026-02-30" })).code, 400);
  assert.equal((await submit({ workDate: "2099-01-01" })).code, 400);
  assert.equal(entries.length, 0);
});

test("completed work cannot exceed received reports or use disabled competition", async () => {
  assert.equal((await submit({ quantity: 9 })).code, 400);
  project.competition = false;
  assert.equal((await submit({ category: "COMPETITION" })).code, 400);
  assert.equal(project.completed, 2);
  assert.equal(entries.length, 0);
});

test("retries with the same ID do not add work twice", async () => {
  await submit();
  const response = await submit();
  assert.equal(response.code, 200);
  assert.equal(entries.length, 1);
  assert.equal(project.completed, 5);
});

test("reused submission IDs cannot expose another user's entry or change work", async () => {
  await submit();
  assert.equal((await submit({ quantity: 4 })).code, 409);
  worker = { ...worker, id: "different-worker" };
  const response = await submit();
  assert.equal(response.code, 409);
  assert.equal(response.body.data, undefined);
  assert.equal(entries.length, 1);
});

test("admin sees history without assignment; regular users cannot use admin endpoint", async () => {
  assert.equal((await invoke(getAdminProjectProgress)).code, 403);
  worker.role = "admin";
  assigned = false;
  assert.equal((await invoke(getAdminProjectProgress)).code, 200);
  worker.role = "user";
  assert.equal((await invoke(getMyProjectProgress)).code, 403);
});

test("contribution totals include more than 200 entries and users with no updates", async () => {
  entries = Array.from({ length: 205 }, (_, index) => ({ id: `entry-${index}`, userId: worker.id, category: "PROJECT", quantity: 1, status: "ACTIVE" }));
  entries.push({ id: "voided", userId: worker.id, category: "PROJECT", quantity: 10, status: "VOIDED" });
  const response = await invoke(getMyProjectProgress, {}, { projectId: project.id }, { page: "2", limit: "25" });
  assert.equal(response.code, 200);
  assert.equal(response.body.data.mySummary.projectCompleted, 205);
  assert.equal(response.body.data.mySummary.totalEntries, 205);
  assert.equal(response.body.data.entries.length, 25);
  assert.equal(response.body.data.pagination.total, 206);
  assert.equal(response.body.data.project.users, undefined, "progress totals must not replace the full project assignments in the UI");
  assert.equal(response.body.data.teamSummary.find((member) => member.userId === "worker-2").entries, 0);
});

test("voiding reverses a contribution once and preserves the audit record", async () => {
  await submit();
  worker.role = "admin";
  const response = await invoke(voidProjectProgressEntry, { reason: "Entered twice" }, { entryId: "entry-1" });
  assert.equal(response.code, 200);
  assert.equal(project.completed, 2);
  assert.equal(entries[0].status, "VOIDED");
  assert.equal(entries[0].voidReason, "Entered twice");
  assert.equal((await invoke(voidProjectProgressEntry, { reason: "Again" }, { entryId: "entry-1" })).code, 400);
  assert.equal(project.completed, 2);
});

test("voiding cannot make completed work negative", async () => {
  await submit();
  worker.role = "admin";
  project.completed = 1;
  assert.equal((await invoke(voidProjectProgressEntry, { reason: "Correction" }, { entryId: "entry-1" })).code, 409);
  assert.equal(project.completed, 1);
  assert.equal(entries[0].status, "ACTIVE");
});
