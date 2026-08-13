/*
  Warnings:

  - A unique constraint covering the columns `[name]` on the table `Project` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Project" ALTER COLUMN "target" SET DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "Project_name_key" ON "Project"("name");
