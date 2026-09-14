import { pathToFileURL } from "node:url";
import { prisma } from "../src/lib/prisma.ts";
import { hashPassword } from "../src/services/auth.ts";

const required = (name: string) => {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(`${name} is required. Set it in your environment or .env file.`);
  }
  return value;
};

export async function seedUsers() {
  const accounts = [
    {
      email: required("SEED_ADMIN_EMAIL").trim().toLowerCase(),
      password: required("SEED_ADMIN_PASSWORD"),
      name: process.env.SEED_ADMIN_NAME?.trim() || "MSM Admin",
      role: "admin" as const,
    },
    {
      email: required("SEED_USER_EMAIL").trim().toLowerCase(),
      password: required("SEED_USER_PASSWORD"),
      name: process.env.SEED_USER_NAME?.trim() || "MSM User",
      role: "user" as const,
    },
  ] as const;

  if (accounts[0].email === accounts[1].email) {
    throw new Error("SEED_ADMIN_EMAIL and SEED_USER_EMAIL must be different.");
  }

  const data = await Promise.all(
    accounts.map(async (account) => ({
      ...account,
      password: await hashPassword(account.password),
      status: "active" as const,
    })),
  );

  return prisma.$transaction(async (tx) => {
    const users = [];
    for (const account of data) {
      const user = await tx.user.upsert({
        where: { email: account.email },
        update: {},
        create: account,
        select: { id: true, email: true, name: true, role: true, status: true },
      });
      users.push(user);
    }
    return users;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const users = await seedUsers();
    console.table(users);
    console.log("Seed complete. Existing accounts were preserved.");
  } catch (error) {
    console.error("Seed failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
