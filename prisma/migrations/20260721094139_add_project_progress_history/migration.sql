-- CreateEnum
CREATE TYPE "ProgressCategory" AS ENUM ('PROJECT', 'COMPETITION');

-- CreateEnum
CREATE TYPE "ProgressSource" AS ENUM ('USER', 'ADMIN', 'SYSTEM', 'IMPORT');

-- CreateEnum
CREATE TYPE "ProgressEntryStatus" AS ENUM ('ACTIVE', 'VOIDED');

-- CreateTable
CREATE TABLE "ProjectProgressEntry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT,
    "createdById" TEXT,
    "category" "ProgressCategory" NOT NULL DEFAULT 'PROJECT',
    "quantity" INTEGER NOT NULL,
    "workDate" DATE NOT NULL,
    "note" TEXT,
    "source" "ProgressSource" NOT NULL DEFAULT 'USER',
    "status" "ProgressEntryStatus" NOT NULL DEFAULT 'ACTIVE',
    "clientRequestId" TEXT,
    "targetSnapshot" INTEGER NOT NULL,
    "receivedSnapshot" INTEGER NOT NULL,
    "completedBefore" INTEGER NOT NULL,
    "completedAfter" INTEGER NOT NULL,
    "submittedIp" TEXT,
    "submittedUserAgent" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectProgressEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectProgressEntry_clientRequestId_key" ON "ProjectProgressEntry"("clientRequestId");

-- CreateIndex
CREATE INDEX "ProjectProgressEntry_projectId_idx" ON "ProjectProgressEntry"("projectId");

-- CreateIndex
CREATE INDEX "ProjectProgressEntry_userId_idx" ON "ProjectProgressEntry"("userId");

-- CreateIndex
CREATE INDEX "ProjectProgressEntry_createdById_idx" ON "ProjectProgressEntry"("createdById");

-- CreateIndex
CREATE INDEX "ProjectProgressEntry_projectId_workDate_idx" ON "ProjectProgressEntry"("projectId", "workDate");

-- CreateIndex
CREATE INDEX "ProjectProgressEntry_userId_workDate_idx" ON "ProjectProgressEntry"("userId", "workDate");

-- CreateIndex
CREATE INDEX "ProjectProgressEntry_projectId_category_status_idx" ON "ProjectProgressEntry"("projectId", "category", "status");

-- AddForeignKey
ALTER TABLE "ProjectProgressEntry" ADD CONSTRAINT "ProjectProgressEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectProgressEntry" ADD CONSTRAINT "ProjectProgressEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectProgressEntry" ADD CONSTRAINT "ProjectProgressEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectProgressEntry" ADD CONSTRAINT "ProjectProgressEntry_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
