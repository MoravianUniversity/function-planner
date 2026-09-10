import { Router } from 'express';
import type { Role } from '@function-planner/shared';
import { loadCourseContext, requireAuth } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { isCourseReadonly } from '@function-planner/shared';

const router = Router();

router.get('/', requireAuth, loadCourseContext, async (_req, res, next) => {
  try {
    const { courseId, roles, user } = res.locals.auth as { courseId: string; roles: Role[]; user: { id: string } };

    const [basePlans, myStudentPlans, allStudentPlans, course] = await Promise.all([
      prisma.basePlan.findMany({ where: { courseId }, orderBy: { updatedAt: 'desc' } }),
      prisma.studentPlan.findMany({
        where: { courseId, members: { some: { userId: user.id } } },
        orderBy: { updatedAt: 'desc' }
      }),
      prisma.studentPlan.findMany({ where: { courseId }, orderBy: { updatedAt: 'desc' } }),
      prisma.course.findUniqueOrThrow({ where: { id: courseId } })
    ]);

    const myStartedBasePlanIds = new Set(myStudentPlans.map((sp: { basePlanId: string }) => sp.basePlanId));
    const unstartedPublishedPlans = basePlans
      .filter((p: { published: boolean }) => p.published)
      .filter((p: { id: string }) => !myStartedBasePlanIds.has(p.id));

    const staffBasePlans = roles.includes('INSTRUCTOR')
      ? basePlans
      : basePlans.filter((p: { published: boolean }) => p.published);

    res.json({
      roles,
      readonly: isCourseReadonly(course.endsAt),
      studentView: {
        myPlans: myStudentPlans,
        availablePublishedPlans: unstartedPublishedPlans
      },
      staffView: {
        basePlans: staffBasePlans,
        studentPlans: allStudentPlans
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
