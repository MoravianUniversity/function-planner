-- AlterTable
ALTER TABLE "BasePlan" ADD COLUMN IF NOT EXISTS "yjsState" BYTEA;

-- AlterTable
ALTER TABLE "StudentPlan" ADD COLUMN IF NOT EXISTS "yjsState" BYTEA;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "JoinRequestStatus" AS ENUM ('PENDING', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "JoinRequest" (
    "id" TEXT NOT NULL,
    "studentPlanId" TEXT NOT NULL,
    "requesterUserId" TEXT NOT NULL,
    "status" "JoinRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JoinRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "JoinRequest_studentPlanId_requesterUserId_key" ON "JoinRequest"("studentPlanId", "requesterUserId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "JoinRequest_requesterUserId_idx" ON "JoinRequest"("requesterUserId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "JoinRequest" ADD CONSTRAINT "JoinRequest_studentPlanId_fkey" FOREIGN KEY ("studentPlanId") REFERENCES "StudentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "JoinRequest" ADD CONSTRAINT "JoinRequest_requesterUserId_fkey" FOREIGN KEY ("requesterUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
