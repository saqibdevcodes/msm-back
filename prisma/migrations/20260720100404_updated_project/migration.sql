/*
  Warnings:

  - The `competition` column on the `Project` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "competitionCompleted" INTEGER,
ADD COLUMN     "competitionRecieved" INTEGER,
DROP COLUMN "competition",
ADD COLUMN     "competition" BOOLEAN DEFAULT false;
