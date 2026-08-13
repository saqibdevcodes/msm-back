/*
  Warnings:

  - You are about to drop the column `competitionCompleted` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `competitionRecieved` on the `Project` table. All the data in the column will be lost.
  - Made the column `target` on table `Project` required. This step will fail if there are existing NULL values in that column.
  - Made the column `received` on table `Project` required. This step will fail if there are existing NULL values in that column.
  - Made the column `completed` on table `Project` required. This step will fail if there are existing NULL values in that column.
  - Made the column `competition` on table `Project` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Project" DROP COLUMN "competitionCompleted",
DROP COLUMN "competitionRecieved",
ADD COLUMN     "competitionReceived" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "competitionTarget" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "target" SET NOT NULL,
ALTER COLUMN "received" SET NOT NULL,
ALTER COLUMN "completed" SET NOT NULL,
ALTER COLUMN "competition" SET NOT NULL;
