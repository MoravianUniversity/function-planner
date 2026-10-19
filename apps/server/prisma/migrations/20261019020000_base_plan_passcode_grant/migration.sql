-- CreateTable
CREATE TABLE "BasePlanPasscodeGrant" (
    "courseId" TEXT NOT NULL,
    "basePlanId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BasePlanPasscodeGrant_pkey" PRIMARY KEY ("courseId","basePlanId","userId")
);

-- CreateIndex
CREATE INDEX "BasePlanPasscodeGrant_userId_idx" ON "BasePlanPasscodeGrant"("userId");

-- AddForeignKey
ALTER TABLE "BasePlanPasscodeGrant" ADD CONSTRAINT "BasePlanPasscodeGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BasePlanPasscodeGrant" ADD CONSTRAINT "BasePlanPasscodeGrant_courseId_basePlanId_fkey" FOREIGN KEY ("courseId", "basePlanId") REFERENCES "BasePlan"("courseId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
