/*
  Warnings:

  - You are about to drop the column `competitionCount` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `completedCount` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `hasCompetition` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `mysteryShoppingType` on the `Project` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Project" DROP COLUMN "competitionCount",
DROP COLUMN "completedCount",
DROP COLUMN "hasCompetition",
DROP COLUMN "mysteryShoppingType",
ADD COLUMN     "competition" INTEGER DEFAULT 0;

-- DropEnum
DROP TYPE "MysteryShoppingType";

-- CreateTable
CREATE TABLE "MysteryShoppingType" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'General',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MysteryShoppingType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldResponse" (
    "id" TEXT NOT NULL,
    "RecievedFrom" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FieldResponse_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "FieldResponse" ADD CONSTRAINT "FieldResponse_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
