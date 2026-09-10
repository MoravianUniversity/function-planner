import { Router } from 'express';
import { Prisma } from '@prisma/client';
import type {
  JoinableStudentPlan,
  MyJoinRequestStatus,
  PlanEntryResponse,
  PendingJoinRequest,
  Role
} from '@function-planner/shared';
import {
  createBasePlanSchema,
  importBasePlansSchema,
  startStudentPlanSchema,
  studentPlanDocName,
  updateBasePlanSchema
} from '@function-planner/shared';
import { loadCourseContext, requireAuth, requireRole } from '../middleware/auth.js';
import { rejectReadonlyCourseWrites } from '../middleware/readonly.js';
import { prisma } from '../lib/prisma.js';
import { getActiveStudentUserIds, hasActiveStudentMember } from '../collab/presence.js';
import { evictYjsDoc } from '../collab/yjsPersistence.js';

const router = Router();

router.get('/base', requireAuth, loadCourseContext, requireRole('TA', 'INSTRUCTOR', 'STUDENT'), async (_req, res, next) => {
  try {
    const { courseId } = res.locals.auth;
    const plans = await prisma.basePlan.findMany({ where: { courseId }, orderBy: { updatedAt: 'desc' } });
    res.json(plans);
  } catch (error) {
    next(error);
  }
});

router.get('/import-sources', requireAuth, loadCourseContext, requireRole('INSTRUCTOR'), async (_req, res, next) => {
  try {
    const { courseId, user } = res.locals.auth as { courseId: string; user: { id: string } };

    const instructorEnrollments = await prisma.enrollment.findMany({
      where: {
        userId: user.id,
        role: 'INSTRUCTOR',
        enabled: true,
        courseId: { not: courseId },
        user: { enabled: true }
      },
      include: { course: true },
      orderBy: { course: { endsAt: 'desc' } }
    });

    const sources = [];
    for (const enrollment of instructorEnrollments) {
      const plans = await prisma.basePlan.findMany({
        where: { courseId: enrollment.courseId },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, title: true, published: true }
      });
      sources.push({
        courseId: enrollment.course.id,
        courseName: enrollment.course.name,
        term: enrollment.course.term,
        plans
      });
    }

    res.json({ sources });
  } catch (error) {
    next(error);
  }
});

router.post('/import', requireAuth, loadCourseContext, requireRole('INSTRUCTOR'), rejectReadonlyCourseWrites, async (req, res, next) => {
  try {
    const { courseId, user } = res.locals.auth as { courseId: string; user: { id: string } };
    const { sourceBasePlans } = importBasePlansSchema.parse(req.body);
    const uniqueSources = Array.from(new Map(sourceBasePlans.map((s) => [`${s.sourceCourseId}::${s.sourceBasePlanId}`, s])).values());

    const created = [];
    for (const source of uniqueSources) {
      if (source.sourceCourseId === courseId) {
        return res.status(400).json({ message: `Invalid source plan: ${source.sourceBasePlanId}` });
      }

      const src = await prisma.basePlan.findFirst({
        where: {
          courseId: source.sourceCourseId,
          id: source.sourceBasePlanId
        }
      });
      if (!src) {
        return res.status(400).json({ message: `Invalid source plan: ${source.sourceBasePlanId}` });
      }

      const access = await prisma.enrollment.findFirst({
        where: {
          userId: user.id,
          courseId: source.sourceCourseId,
          role: 'INSTRUCTOR',
          enabled: true,
          user: { enabled: true }
        }
      });
      if (!access) {
        return res.status(403).json({ message: 'You can only import plans from courses you instruct.' });
      }

      const settingsPayload: Prisma.InputJsonValue | undefined =
        src.settings === null || src.settings === undefined ? undefined : (src.settings as Prisma.InputJsonValue);

      const resolvedId = await nextAvailableBasePlanId(courseId, src.id);
      const copy = await prisma.basePlan.create({
        data: {
          courseId,
          id: resolvedId,
          title: src.title,
          content: src.content,
          published: false,
          ...(settingsPayload !== undefined ? { settings: settingsPayload } : {})
        }
      });
      created.push(copy);
    }

    res.status(201).json({ imported: created.length, plans: created });
  } catch (error) {
    next(error);
  }
});

router.post('/base', requireAuth, loadCourseContext, requireRole('INSTRUCTOR'), rejectReadonlyCourseWrites, async (req, res, next) => {
  try {
    const { courseId } = res.locals.auth;
    const payload = createBasePlanSchema.parse(req.body);
    const created = await prisma.basePlan.create({
      data: {
        id: payload.id,
        courseId,
        title: payload.title,
        content: payload.content
      }
    });
    res.status(201).json(created);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ message: 'Plan id already exists. Choose a different id.' });
    }
    next(error);
  }
});

router.patch('/base/:planId', requireAuth, loadCourseContext, requireRole('INSTRUCTOR'), rejectReadonlyCourseWrites, async (req, res, next) => {
  try {
    const { courseId } = res.locals.auth;
    const planId = String(req.params.planId);
    const existing = await prisma.basePlan.findFirst({ where: { courseId, id: planId } });
    if (!existing) {
      return res.status(404).json({ message: 'Plan not found in this course.' });
    }

    const payload = updateBasePlanSchema.parse(req.body);
    const updateData: Prisma.BasePlanUpdateInput = {};
    if (payload.title !== undefined) {
      updateData.title = payload.title;
    }
    if (payload.content !== undefined) {
      updateData.content = payload.content;
    }
    if (payload.published !== undefined) {
      if (existing.published && payload.published === false) {
        return res.status(400).json({ message: 'Published plans cannot be unpublished.' });
      }
      updateData.published = payload.published;
    }
    if (payload.settings !== undefined) {
      updateData.settings =
        payload.settings === null ? Prisma.DbNull : (payload.settings as Prisma.InputJsonValue);
    }

    if (Object.keys(updateData).length === 0) {
      res.json(existing);
      return;
    }

    await prisma.basePlan.updateMany({ where: { courseId, id: planId }, data: updateData });
    const updated = await prisma.basePlan.findFirstOrThrow({ where: { courseId, id: planId } });
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.get('/base/:planId', requireAuth, loadCourseContext, requireRole('TA', 'INSTRUCTOR'), async (req, res, next) => {
  try {
    const { courseId } = res.locals.auth;
    const planId = String(req.params.planId);
    const plan = await prisma.basePlan.findFirst({ where: { courseId, id: planId } });
    if (!plan) {
      return res.status(404).json({ message: 'Plan not found in this course.' });
    }
    res.json(plan);
  } catch (error) {
    next(error);
  }
});

/**
 * Resolves a single `/plans/:identifier` URL for the current user (student plan id, base plan id, etc.).
 */
router.get('/entry/:identifier', requireAuth, loadCourseContext, async (req, res, next) => {
  try {
    const identifier = decodeURIComponent(String(req.params.identifier));
    const { courseId, user, roles } = res.locals.auth as { courseId: string; user: { id: string }; roles: Role[] };
    const isStaff = roles.includes('TA') || roles.includes('INSTRUCTOR');
    const isStudent = roles.includes('STUDENT');

    const studentPlan = await prisma.studentPlan.findFirst({
      where: { id: identifier, courseId },
      include: { members: true }
    });

    if (studentPlan) {
      const isMember = studentPlan.members.some((m: { userId: string }) => m.userId === user.id);
      if (isMember || isStaff) {
        const body: PlanEntryResponse = {
          kind: 'student',
          studentPlanId: studentPlan.id,
          title: studentPlan.title,
          basePlanId: studentPlan.basePlanId
        };
        return res.json(body);
      }
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const basePlan = await prisma.basePlan.findFirst({ where: { courseId, id: identifier } });
    if (!basePlan) {
      return res.status(404).json({ message: 'Plan not found.' });
    }

    if (isStaff) {
      if (roles.includes('TA') && !roles.includes('INSTRUCTOR') && !basePlan.published) {
        return res.status(403).json({ message: 'Forbidden.' });
      }
      const body: PlanEntryResponse = {
        kind: 'staff-base',
        basePlanId: basePlan.id,
        title: basePlan.title
      };
      return res.json(body);
    }

    if (!isStudent) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const myPlan = await prisma.studentPlan.findFirst({
      where: {
        courseId,
        basePlanId: basePlan.id,
        members: { some: { userId: user.id } }
      }
    });

    if (myPlan) {
      const body: PlanEntryResponse = {
        kind: 'student',
        studentPlanId: myPlan.id,
        title: myPlan.title,
        basePlanId: myPlan.basePlanId
      };
      return res.json(body);
    }

    if (!basePlan.published) {
      return res.status(403).json({ message: 'This plan is not published.' });
    }

    const body: PlanEntryResponse = {
      kind: 'start-published',
      basePlanId: basePlan.id,
      title: basePlan.title
    };
    return res.json(body);
  } catch (error) {
    next(error);
  }
});

router.get('/students', requireAuth, loadCourseContext, requireRole('TA', 'INSTRUCTOR'), async (req, res, next) => {
  try {
    const { courseId } = res.locals.auth;
    const basePlanId = typeof req.query.basePlanId === 'string' ? req.query.basePlanId.trim() || undefined : undefined;
    const where: Prisma.StudentPlanWhereInput = basePlanId
      ? { courseId, basePlanId }
      : { courseId };
    const plans = await prisma.studentPlan.findMany({
      where,
      include: {
        members: { include: { user: true } },
        basePlan: true
      },
      orderBy: { updatedAt: 'desc' }
    });
    res.json(plans);
  } catch (error) {
    next(error);
  }
});

router.get('/students/joinable', requireAuth, loadCourseContext, requireRole('STUDENT'), async (req, res, next) => {
  try {
    const { courseId } = res.locals.auth as { courseId: string };
    const basePlanId = typeof req.query.basePlanId === 'string' ? req.query.basePlanId.trim() : '';
    if (!basePlanId) {
      return res.status(400).json({ message: 'basePlanId is required.' });
    }

    const plans = await prisma.studentPlan.findMany({
      where: { courseId, basePlanId },
      include: {
        members: { include: { user: true } }
      },
      orderBy: { updatedAt: 'desc' }
    });

    const joinable: JoinableStudentPlan[] = [];
    for (const plan of plans) {
      const docName = studentPlanDocName(courseId, plan.id);
      if (!hasActiveStudentMember(docName)) {
        continue;
      }
      const activeUserIds = getActiveStudentUserIds(docName);
      const activeSet = new Set(activeUserIds);
      joinable.push({
        id: plan.id,
        title: plan.title,
        activeUserIds,
        members: plan.members.map((m) => ({
          userId: m.userId,
          firstName: m.user.firstName,
          lastName: m.user.lastName,
          email: m.user.email,
          active: activeSet.has(m.userId)
        }))
      });
    }

    res.json({ plans: joinable });
  } catch (error) {
    next(error);
  }
});

router.get('/students/my-join-request', requireAuth, loadCourseContext, requireRole('STUDENT'), async (req, res, next) => {
  try {
    const { courseId, user } = res.locals.auth as { courseId: string; user: { id: string } };
    const basePlanId = typeof req.query.basePlanId === 'string' ? req.query.basePlanId.trim() : '';
    if (!basePlanId) {
      return res.status(400).json({ message: 'basePlanId is required.' });
    }

    const membership = await prisma.studentPlanMember.findFirst({
      where: {
        userId: user.id,
        studentPlan: { courseId, basePlanId }
      },
      include: { studentPlan: true }
    });
    if (membership) {
      const body: MyJoinRequestStatus = { status: 'accepted', studentPlanId: membership.studentPlanId };
      return res.json(body);
    }

    const pending = await prisma.joinRequest.findFirst({
      where: {
        requesterUserId: user.id,
        status: 'PENDING',
        studentPlan: { courseId, basePlanId }
      },
      orderBy: { createdAt: 'desc' }
    });
    if (pending) {
      const body: MyJoinRequestStatus = {
        status: 'pending',
        joinRequestId: pending.id,
        studentPlanId: pending.studentPlanId
      };
      return res.json(body);
    }

    const rejected = await prisma.joinRequest.findFirst({
      where: {
        requesterUserId: user.id,
        status: 'REJECTED',
        studentPlan: { courseId, basePlanId }
      },
      orderBy: { updatedAt: 'desc' }
    });
    if (rejected) {
      // Clear after reporting so the UI can show once
      await prisma.joinRequest.delete({ where: { id: rejected.id } });
      const body: MyJoinRequestStatus = { status: 'rejected' };
      return res.json(body);
    }

    const body: MyJoinRequestStatus = { status: 'none' };
    return res.json(body);
  } catch (error) {
    next(error);
  }
});

router.post('/students/start', requireAuth, loadCourseContext, requireRole('STUDENT', 'TA', 'INSTRUCTOR'), rejectReadonlyCourseWrites, async (req, res, next) => {
  try {
    const { courseId, user, roles } = res.locals.auth as { courseId: string; user: { id: string }; roles: Role[] };
    const payload = startStudentPlanSchema.parse(req.body);

    if (!roles.includes('STUDENT') && !roles.includes('INSTRUCTOR')) {
      return res.status(403).json({ message: 'Only students or instructors may start plans.' });
    }

    const existing = await findMembershipForBasePlan(user.id, courseId, payload.basePlanId);
    if (existing) {
      return res.status(409).json({ message: 'You already belong to a plan for this assignment. Leave it first.' });
    }

    const memberUserIds = [...new Set([user.id, ...payload.memberUserIds])];
    for (const memberId of memberUserIds) {
      if (memberId === user.id) {
        continue;
      }
      const other = await findMembershipForBasePlan(memberId, courseId, payload.basePlanId);
      if (other) {
        return res.status(409).json({ message: 'One or more invited members already belong to a plan for this assignment.' });
      }
    }

    const basePlan = await prisma.basePlan.findFirstOrThrow({ where: { courseId, id: payload.basePlanId } });
    if (!basePlan.published) {
      return res.status(400).json({ message: 'Cannot start an unpublished plan.' });
    }

    const studentPlan = await prisma.studentPlan.create({
      data: {
        basePlanId: payload.basePlanId,
        courseId,
        title: basePlan.title,
        content: '',
        state: 'IN_PROGRESS',
        members: {
          createMany: {
            data: memberUserIds.map((memberId) => ({ userId: memberId }))
          }
        }
      },
      include: {
        members: true
      }
    });

    return res.status(201).json(studentPlan);
  } catch (error) {
    next(error);
  }
});

router.get('/students/:studentPlanId/join-requests', requireAuth, loadCourseContext, requireRole('STUDENT', 'TA', 'INSTRUCTOR'), async (req, res, next) => {
  try {
    const { courseId, user } = res.locals.auth as { courseId: string; user: { id: string } };
    const studentPlanId = String(req.params.studentPlanId);

    const plan = await prisma.studentPlan.findFirst({
      where: { id: studentPlanId, courseId },
      include: { members: true }
    });
    if (!plan) {
      return res.status(404).json({ message: 'Student plan not found.' });
    }
    const isMember = plan.members.some((m) => m.userId === user.id);
    if (!isMember) {
      return res.status(403).json({ message: 'Only plan members can view join requests.' });
    }

    const rows = await prisma.joinRequest.findMany({
      where: { studentPlanId, status: 'PENDING' },
      include: { requester: true },
      orderBy: { createdAt: 'asc' }
    });

    const requests: PendingJoinRequest[] = rows.map((r) => ({
      id: r.id,
      studentPlanId: r.studentPlanId,
      createdAt: r.createdAt.toISOString(),
      requester: {
        id: r.requester.id,
        email: r.requester.email,
        firstName: r.requester.firstName,
        lastName: r.requester.lastName
      }
    }));

    res.json({ requests });
  } catch (error) {
    next(error);
  }
});

router.post('/students/:studentPlanId/join-requests', requireAuth, loadCourseContext, requireRole('STUDENT'), rejectReadonlyCourseWrites, async (req, res, next) => {
  try {
    const { courseId, user } = res.locals.auth as { courseId: string; user: { id: string } };
    const studentPlanId = String(req.params.studentPlanId);

    const plan = await prisma.studentPlan.findFirst({
      where: { id: studentPlanId, courseId },
      include: { members: true }
    });
    if (!plan) {
      return res.status(404).json({ message: 'Student plan not found.' });
    }

    if (plan.members.some((m) => m.userId === user.id)) {
      return res.status(409).json({ message: 'You are already a member of this plan.' });
    }

    const existingMembership = await findMembershipForBasePlan(user.id, courseId, plan.basePlanId);
    if (existingMembership) {
      return res.status(409).json({ message: 'You already belong to a plan for this assignment. Leave it first.' });
    }

    const docName = studentPlanDocName(courseId, plan.id);
    if (!hasActiveStudentMember(docName)) {
      return res.status(400).json({ message: 'This plan has no active members right now. Try again when someone is in the planner.' });
    }

    const existingPending = await prisma.joinRequest.findFirst({
      where: {
        requesterUserId: user.id,
        status: 'PENDING',
        studentPlan: { courseId, basePlanId: plan.basePlanId }
      }
    });
    if (existingPending) {
      return res.status(409).json({ message: 'You already have a pending join request for this assignment.' });
    }

    // Clear any prior rejected row for this plan so unique constraint allows recreate
    await prisma.joinRequest.deleteMany({
      where: { studentPlanId, requesterUserId: user.id, status: 'REJECTED' }
    });

    const created = await prisma.joinRequest.create({
      data: {
        studentPlanId,
        requesterUserId: user.id,
        status: 'PENDING'
      }
    });

    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

router.post(
  '/students/:studentPlanId/join-requests/:requestId/accept',
  requireAuth,
  loadCourseContext,
  requireRole('STUDENT', 'TA', 'INSTRUCTOR'),
  rejectReadonlyCourseWrites,
  async (req, res, next) => {
    try {
      const { courseId, user } = res.locals.auth as { courseId: string; user: { id: string } };
      const studentPlanId = String(req.params.studentPlanId);
      const requestId = String(req.params.requestId);

      const plan = await prisma.studentPlan.findFirst({
        where: { id: studentPlanId, courseId },
        include: { members: true }
      });
      if (!plan) {
        return res.status(404).json({ message: 'Student plan not found.' });
      }
      if (!plan.members.some((m) => m.userId === user.id)) {
        return res.status(403).json({ message: 'Only plan members can accept join requests.' });
      }

      const joinRequest = await prisma.joinRequest.findFirst({
        where: { id: requestId, studentPlanId, status: 'PENDING' }
      });
      if (!joinRequest) {
        return res.status(404).json({ message: 'Join request not found.' });
      }

      const requesterMembership = await findMembershipForBasePlan(joinRequest.requesterUserId, courseId, plan.basePlanId);
      if (requesterMembership) {
        await prisma.joinRequest.delete({ where: { id: joinRequest.id } });
        return res.status(409).json({ message: 'Requester already belongs to a plan for this assignment.' });
      }

      await prisma.$transaction([
        prisma.studentPlanMember.create({
          data: { studentPlanId, userId: joinRequest.requesterUserId }
        }),
        prisma.joinRequest.delete({ where: { id: joinRequest.id } })
      ]);

      res.json({ success: true, studentPlanId });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/students/:studentPlanId/join-requests/:requestId/reject',
  requireAuth,
  loadCourseContext,
  requireRole('STUDENT', 'TA', 'INSTRUCTOR'),
  rejectReadonlyCourseWrites,
  async (req, res, next) => {
    try {
      const { courseId, user } = res.locals.auth as { courseId: string; user: { id: string } };
      const studentPlanId = String(req.params.studentPlanId);
      const requestId = String(req.params.requestId);

      const plan = await prisma.studentPlan.findFirst({
        where: { id: studentPlanId, courseId },
        include: { members: true }
      });
      if (!plan) {
        return res.status(404).json({ message: 'Student plan not found.' });
      }
      if (!plan.members.some((m) => m.userId === user.id)) {
        return res.status(403).json({ message: 'Only plan members can reject join requests.' });
      }

      const joinRequest = await prisma.joinRequest.findFirst({
        where: { id: requestId, studentPlanId, status: 'PENDING' }
      });
      if (!joinRequest) {
        return res.status(404).json({ message: 'Join request not found.' });
      }

      await prisma.joinRequest.update({
        where: { id: joinRequest.id },
        data: { status: 'REJECTED' }
      });

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

router.post('/students/:studentPlanId/leave', requireAuth, loadCourseContext, requireRole('STUDENT', 'TA', 'INSTRUCTOR'), rejectReadonlyCourseWrites, async (req, res, next) => {
  try {
    const { courseId, user } = res.locals.auth as { courseId: string; user: { id: string } };
    const studentPlanId = String(req.params.studentPlanId);

    const plan = await prisma.studentPlan.findFirst({
      where: { id: studentPlanId, courseId },
      include: { members: true }
    });
    if (!plan) {
      return res.status(404).json({ message: 'Student plan not found.' });
    }

    const membership = plan.members.find((m) => m.userId === user.id);
    if (!membership) {
      return res.status(403).json({ message: 'You are not a member of this plan.' });
    }

    const basePlanId = plan.basePlanId;
    const remaining = plan.members.length - 1;

    if (remaining <= 0) {
      const docName = studentPlanDocName(courseId, studentPlanId);
      await prisma.studentPlan.delete({ where: { id: studentPlanId } });
      evictYjsDoc(docName);
      return res.json({ success: true, deleted: true, basePlanId });
    }

    await prisma.studentPlanMember.delete({ where: { id: membership.id } });
    return res.json({ success: true, deleted: false, basePlanId });
  } catch (error) {
    next(error);
  }
});

router.get('/students/:studentPlanId', requireAuth, loadCourseContext, requireRole('STUDENT', 'TA', 'INSTRUCTOR'), async (req, res, next) => {
  try {
    const { courseId, user, roles } = res.locals.auth as { courseId: string; user: { id: string }; roles: Role[] };
    const plan = await prisma.studentPlan.findFirst({
      where: { id: String(req.params.studentPlanId), courseId },
      include: {
        members: { include: { user: true } },
        basePlan: true
      }
    });

    if (!plan) {
      return res.status(404).json({ message: 'Plan not found.' });
    }

    const isMember = plan.members.some((member: { userId: string }) => member.userId === user.id);
    const canStaffView = roles.includes('TA') || roles.includes('INSTRUCTOR');
    if (!isMember && !canStaffView) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const docName = studentPlanDocName(courseId, plan.id);
    const activeUserIds = getActiveStudentUserIds(docName);
    const activeSet = new Set(activeUserIds);
    // Members and instructors can edit; TAs supervising without membership are read-only.
    const canEdit = isMember || roles.includes('INSTRUCTOR');

    return res.json({
      id: plan.id,
      courseId: plan.courseId,
      basePlanId: plan.basePlanId,
      title: plan.title,
      content: plan.content,
      state: plan.state,
      updatedAt: plan.updatedAt,
      currentUserId: user.id,
      isMember,
      canEdit,
      readonly: !canEdit,
      settings: plan.basePlan.settings ?? null,
      basePlanContent: plan.basePlan.content ?? '',
      activeUserIds,
      members: plan.members.map((m) => ({
        userId: m.userId,
        firstName: m.user.firstName,
        lastName: m.user.lastName,
        email: m.user.email,
        active: activeSet.has(m.userId)
      }))
    });
  } catch (error) {
    next(error);
  }
});

export default router;

async function findMembershipForBasePlan(userId: string, courseId: string, basePlanId: string) {
  return prisma.studentPlanMember.findFirst({
    where: {
      userId,
      studentPlan: { courseId, basePlanId }
    }
  });
}

async function nextAvailableBasePlanId(courseId: string, requestedId: string): Promise<string> {
  let candidate = requestedId;
  while (await basePlanIdExists(courseId, candidate)) {
    candidate = incrementIdSuffix(candidate);
  }
  return candidate;
}

async function basePlanIdExists(courseId: string, id: string): Promise<boolean> {
  const existing = await prisma.basePlan.findFirst({
    where: { courseId, id },
    select: { id: true }
  });
  return Boolean(existing);
}

function incrementIdSuffix(id: string): string {
  const match = id.match(/^(.*?)(\d+)$/);
  if (!match) {
    return `${id}2`;
  }
  const [, prefix, digits] = match;
  const next = String(Number(digits) + 1);
  return `${prefix}${next}`;
}
