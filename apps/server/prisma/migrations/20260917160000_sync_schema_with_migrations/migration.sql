-- DropForeignKey
ALTER TABLE "StudentPlanMember" DROP CONSTRAINT "StudentPlanMember_studentPlanId_fkey";

-- AlterTable
ALTER TABLE "Course" ADD COLUMN "apiTokenIat" INTEGER,
ADD COLUMN "apiTokenSub" TEXT;

-- AlterTable
ALTER TABLE "JoinRequest" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- RenameForeignKey
ALTER TABLE "StudentPlan" RENAME CONSTRAINT "StudentPlan_basePlanId_fkey" TO "StudentPlan_courseId_basePlanId_fkey";

-- AddForeignKey
ALTER TABLE "StudentPlanMember" ADD CONSTRAINT "StudentPlanMember_studentPlanId_fkey" FOREIGN KEY ("studentPlanId") REFERENCES "StudentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
