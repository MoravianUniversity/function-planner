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
        include: {
          basePlan: { select: { title: true } },
          members: { include: { user: { select: { firstName: true, lastName: true, email: true } } } }
        },
        orderBy: { updatedAt: 'desc' }
      }),
      prisma.studentPlan.findMany({
        where: { courseId },
        include: { basePlan: { select: { title: true } } },
        orderBy: { updatedAt: 'desc' }
      }),
      prisma.course.findUniqueOrThrow({ where: { id: courseId } })
    ]);

    const myStartedBasePlanIds = new Set(myStudentPlans.map((sp: { basePlanId: string }) => sp.basePlanId));
    const unstartedPublishedPlans = basePlans
      .filter((p: { published: boolean }) => p.published)
      .filter((p: { id: string }) => !myStartedBasePlanIds.has(p.id));

    const staffBasePlans = roles.includes('INSTRUCTOR')
      ? basePlans
      : basePlans.filter((p: { published: boolean }) => p.published);

    const mapStudentPlan = (sp: {
      id: string;
      basePlanId: string;
      basePlan: { title: string };
      members?: { user: { firstName: string; lastName: string; email: string } }[];
    }) => ({
      id: sp.id,
      basePlanId: sp.basePlanId,
      title: sp.basePlan.title,
      readonly: isCourseReadonly(course.endsAt),
      ...(sp.members
        ? {
            members: sp.members.map((m) => ({
              firstName: m.user.firstName,
              lastName: m.user.lastName,
              email: m.user.email
            }))
          }
        : {})
    });

    res.json({
      roles,
      readonly: isCourseReadonly(course.endsAt),
      studentView: {
        myPlans: myStudentPlans.map(mapStudentPlan),
        availablePublishedPlans: unstartedPublishedPlans
      },
      staffView: {
        basePlans: staffBasePlans,
        studentPlans: allStudentPlans.map(mapStudentPlan)
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
