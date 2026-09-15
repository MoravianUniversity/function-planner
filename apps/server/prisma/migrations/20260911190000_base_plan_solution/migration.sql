-- AlterTable
ALTER TABLE "BasePlan" ADD COLUMN "solutionContent" TEXT NOT NULL DEFAULT '';
ALTER TABLE "BasePlan" ADD COLUMN "solutionYjsState" BYTEA;
ALTER TABLE "BasePlan" ADD COLUMN "solutionBaseContentHash" TEXT;
