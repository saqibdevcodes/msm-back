/*
  Warnings:

  - You are about to drop the column `RecievedFrom` on the `FieldResponse` table. All the data in the column will be lost.
  - Added the required column `receivedFrom` to the `FieldResponse` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `quantity` on the `FieldResponse` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'user', 'field');

-- AlterTable
ALTER TABLE "FieldResponse" DROP COLUMN "RecievedFrom",
ADD COLUMN     "receivedFrom" TEXT NOT NULL,
DROP COLUMN "quantity",
ADD COLUMN     "quantity" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "role" "Role" NOT NULL DEFAULT 'user';

-- CreateTable
CREATE TABLE "PerformanceEvaluation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "totalScore" INTEGER NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerformanceEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceQuestion" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "maxScore" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerformanceQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceAnswer" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerformanceAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PerformanceEvaluation_userId_idx" ON "PerformanceEvaluation"("userId");

-- CreateIndex
CREATE INDEX "PerformanceEvaluation_projectId_idx" ON "PerformanceEvaluation"("projectId");

-- CreateIndex
CREATE INDEX "PerformanceAnswer_evaluationId_idx" ON "PerformanceAnswer"("evaluationId");

-- CreateIndex
CREATE INDEX "PerformanceAnswer_questionId_idx" ON "PerformanceAnswer"("questionId");

-- CreateIndex
CREATE INDEX "FieldResponse_projectId_idx" ON "FieldResponse"("projectId");

-- CreateIndex
CREATE INDEX "ProjectUser_projectId_idx" ON "ProjectUser"("projectId");

-- CreateIndex
CREATE INDEX "ProjectUser_userId_idx" ON "ProjectUser"("userId");

-- AddForeignKey
ALTER TABLE "PerformanceEvaluation" ADD CONSTRAINT "PerformanceEvaluation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceEvaluation" ADD CONSTRAINT "PerformanceEvaluation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceAnswer" ADD CONSTRAINT "PerformanceAnswer_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "PerformanceEvaluation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceAnswer" ADD CONSTRAINT "PerformanceAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "PerformanceQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
