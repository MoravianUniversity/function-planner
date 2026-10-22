-- AlterTable
ALTER TABLE "StudentPlan" ADD COLUMN "locked" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "BasePlan" ADD COLUMN "studentsLocked" BOOLEAN NOT NULL DEFAULT false;
