-- AlterTable
-- This column was originally added by editing the already-applied migration
-- 20261017120000_student_plan_locked, so databases that had applied that migration
-- never received it. IF NOT EXISTS keeps this safe for databases that already have it.
ALTER TABLE "BasePlan" ADD COLUMN IF NOT EXISTS "studentsLocked" BOOLEAN NOT NULL DEFAULT false;
