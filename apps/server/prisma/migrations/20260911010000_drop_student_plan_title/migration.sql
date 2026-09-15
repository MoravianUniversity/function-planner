-- Titles always come from BasePlan; StudentPlan no longer stores a snapshot.
ALTER TABLE "StudentPlan" DROP COLUMN IF EXISTS "title";
