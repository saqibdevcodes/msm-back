/*
  Warnings:

  - The `completed` column on the `Project` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "competitionCompleted" INTEGER NOT NULL DEFAULT 0,
DROP COLUMN "completed",
ADD COLUMN     "completed" INTEGER NOT NULL DEFAULT 0;
