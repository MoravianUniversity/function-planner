-- Create enums
CREATE TYPE "Role" AS ENUM ('INSTRUCTOR', 'TA', 'STUDENT');
CREATE TYPE "StudentPlanState" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETE');

-- Create tables
CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "googleSub" TEXT,
  "email" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Course" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "term" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Enrollment" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "role" "Role" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BasePlan" (
  "id" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL DEFAULT '',
  "published" BOOLEAN NOT NULL DEFAULT false,
  "settings" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BasePlan_pkey" PRIMARY KEY ("courseId","id")
);

CREATE TABLE "StudentPlan" (
  "id" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "basePlanId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL DEFAULT '',
  "state" "StudentPlanState" NOT NULL DEFAULT 'NOT_STARTED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudentPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudentPlanMember" (
  "id" TEXT NOT NULL,
  "studentPlanId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentPlanMember_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "Course_startsAt_idx" ON "Course"("startsAt");
CREATE UNIQUE INDEX "Enrollment_userId_courseId_role_key" ON "Enrollment"("userId", "courseId", "role");
CREATE INDEX "Enrollment_courseId_role_idx" ON "Enrollment"("courseId", "role");
CREATE INDEX "BasePlan_courseId_published_idx" ON "BasePlan"("courseId", "published");
CREATE INDEX "StudentPlan_courseId_idx" ON "StudentPlan"("courseId");
CREATE INDEX "StudentPlan_basePlanId_idx" ON "StudentPlan"("basePlanId");
CREATE UNIQUE INDEX "StudentPlanMember_studentPlanId_userId_key" ON "StudentPlanMember"("studentPlanId", "userId");

-- FKs
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BasePlan" ADD CONSTRAINT "BasePlan_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentPlan" ADD CONSTRAINT "StudentPlan_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentPlan" ADD CONSTRAINT "StudentPlan_basePlanId_fkey" FOREIGN KEY ("courseId","basePlanId") REFERENCES "BasePlan"("courseId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentPlanMember" ADD CONSTRAINT "StudentPlanMember_studentPlanId_fkey" FOREIGN KEY ("studentPlanId") REFERENCES "StudentPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentPlanMember" ADD CONSTRAINT "StudentPlanMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
