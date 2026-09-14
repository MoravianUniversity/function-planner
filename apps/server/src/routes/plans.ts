import { createHash } from 'node:crypto';
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import type {
  JoinableStudentPlan,
  MyJoinRequestStatus,
  PlanEntryResponse,
  PendingJoinRequest,
  PlannerModel,
  Role
} from '@function-planner/shared';
import {
  comparePlans,
  comparePythonSchema,
  copyBasePlanSchema,
  createBasePlanSchema,
  importBasePlansSchema,
  mergeBaseIntoSolution,
  checkPlan,
  parsePlanConfig,
  parsePlannerModel,
  planCheckOptionsFromConfig,
  pythonCodeToModel,
  solutionMergeSchema,
  solutionPlanDocName,
  startStudentPlanSchema,
  stringifyPlannerModel,
  studentPlanDocName,
  updateBasePlanSchema
} from '@function-planner/shared';
import { loadCourseContext, requireAuth, requireRole } from '../middleware/auth.js';
import { requireCourseApiToken, requireCourseApiTokenOrStaff } from '../middleware/apiToken.js';
import { rejectReadonlyCourseWrites } from '../middleware/readonly.js';
import { prisma } from '../lib/prisma.js';
import { getActiveStudentUserIds, hasActiveStudentMember } from '../collab/presence.js';
import {
  evictYjsDoc,
  exportPlannerContentFromYjsState,
  getLivePlannerContentJson
} from '../collab/yjsPersistence.js';

const router = Router();

function hashBaseContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function planHasSolution(plan: {
  solutionContent: string;
  solutionYjsState: Buffer | Uint8Array | null;
  solutionBaseContentHash?: string | null;
}): boolean {
  return (
    Boolean(plan.solutionBaseContentHash) ||
    Boolean(plan.solutionContent.trim()) ||
    Boolean(plan.solutionYjsState && plan.solutionYjsState.length > 0)
  );
}

function planSolutionStale(plan: {
  content: string;
  solutionContent: string;
  solutionYjsState: Buffer | Uint8Array | null;
  solutionBaseContentHash: string | null;
}): boolean {
  if (!planHasSolution(plan)) {
    return false;
  }
  return hashBaseContent(plan.content) !== plan.solutionBaseContentHash;
}

function toStaffBasePlanDetail(plan: {
  id: string;
  title: string;
  content: string;
  published: boolean;
  settings: unknown;
  updatedAt: Date;
  solutionContent: string;
  solutionYjsState: Buffer | Uint8Array | null;
  solutionBaseContentHash: string | null;
}) {
  return {
    id: plan.id,
    title: plan.title,
    content: plan.content,
    published: plan.published,
    settings: plan.settings,
    updatedAt: plan.updatedAt,
    solutionContent: plan.solutionContent,
    hasSolution: planHasSolution(plan),
    solutionStale: planSolutionStale(plan)
  };
}

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
      const hasSourceSolution =
        Boolean(src.solutionBaseContentHash) || Boolean(src.solutionContent.trim());
      const copy = await prisma.basePlan.create({
        data: {
          courseId,
          id: resolvedId,
          title: src.title,
          content: src.content,
          published: false,
          ...(settingsPayload !== undefined ? { settings: settingsPayload } : {}),
          ...(hasSourceSolution
            ? {
                solutionContent: src.solutionContent,
                solutionBaseContentHash: src.solutionBaseContentHash ?? hashBaseContent(src.content)
              }
            : {})
        }
      });
      created.push(copy);
    }

    res.status(201).json({ imported: created.length, plans: created });
  } catch (error) {
    next(error);
  }
});

router.post('/copy', requireAuth, loadCourseContext, requireRole('INSTRUCTOR'), rejectReadonlyCourseWrites, async (req, res, next) => {
  try {
    const { courseId } = res.locals.auth;
    const { sourceBasePlanId, id, title, copyConfiguration, copyBasePlan, copySolution } =
      copyBasePlanSchema.parse(req.body);

    const src = await prisma.basePlan.findFirst({
      where: { courseId, id: sourceBasePlanId }
    });
    if (!src) {
      return res.status(400).json({ message: `Invalid source plan: ${sourceBasePlanId}` });
    }

    if (id === sourceBasePlanId) {
      return res.status(400).json({ message: 'New plan id must be different from the source plan id.' });
    }

    const settingsPayload: Prisma.InputJsonValue | undefined =
      copyConfiguration && src.settings !== null && src.settings !== undefined
        ? (src.settings as Prisma.InputJsonValue)
        : undefined;

    const content = copyBasePlan ? src.content : '';
    const hasSourceSolution =
      copySolution && (Boolean(src.solutionBaseContentHash) || Boolean(src.solutionContent.trim()));

    const copy = await prisma.basePlan.create({
      data: {
        courseId,
        id,
        title,
        content,
        published: false,
        ...(settingsPayload !== undefined ? { settings: settingsPayload } : {}),
        ...(hasSourceSolution
          ? {
              solutionContent: src.solutionContent,
              solutionBaseContentHash: src.solutionBaseContentHash ?? hashBaseContent(src.content)
            }
          : {})
      }
    });

    res.status(201).json(copy);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ message: 'Plan id already exists. Choose a different id.' });
    }
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
      res.json(toStaffBasePlanDetail(existing));
      return;
    }

    await prisma.basePlan.updateMany({ where: { courseId, id: planId }, data: updateData });
    const updated = await prisma.basePlan.findFirstOrThrow({ where: { courseId, id: planId } });
    res.json(toStaffBasePlanDetail(updated));
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
    res.json(toStaffBasePlanDetail(plan));
  } catch (error) {
    next(error);
  }
});

/**
 * Seed (reset) or field-aware merge of the staff solution from the current base template.
 * Clears solutionYjsState and evicts the live solution room so the next open reloads from content.
 */
router.post(
  '/base/:planId/solution/merge',
  requireAuth,
  loadCourseContext,
  requireRole('TA', 'INSTRUCTOR'),
  rejectReadonlyCourseWrites,
  async (req, res, next) => {
    try {
      const { courseId } = res.locals.auth;
      const planId = String(req.params.planId);
      const { mode } = solutionMergeSchema.parse(req.body);

      const plan = await prisma.basePlan.findFirst({ where: { courseId, id: planId } });
      if (!plan) {
        return res.status(404).json({ message: 'Plan not found in this course.' });
      }

      const config = parsePlanConfig(plan.settings);
      const baseModel = parsePlannerModel(plan.content);
      const contentHash = hashBaseContent(plan.content);

      let nextSolutionContent: string;
      if (mode === 'reset' || !planHasSolution(plan)) {
        nextSolutionContent = plan.content;
      } else {
        const solutionModel = parsePlannerModel(plan.solutionContent);
        if (!baseModel) {
          nextSolutionContent = plan.content;
        } else {
          const merged = mergeBaseIntoSolution(baseModel, solutionModel, config);
          nextSolutionContent = stringifyPlannerModel(merged);
        }
      }

      await prisma.basePlan.updateMany({
        where: { courseId, id: planId },
        data: {
          solutionContent: nextSolutionContent,
          solutionYjsState: null,
          solutionBaseContentHash: contentHash
        }
      });

      evictYjsDoc(solutionPlanDocName(courseId, planId));

      const updated = await prisma.basePlan.findFirstOrThrow({ where: { courseId, id: planId } });
      res.json(toStaffBasePlanDetail(updated));
    } catch (error) {
      next(error);
    }
  }
);

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
      include: { members: true, basePlan: { select: { title: true } } }
    });

    if (studentPlan) {
      const isMember = studentPlan.members.some((m: { userId: string }) => m.userId === user.id);
      if (isMember || isStaff) {
        const body: PlanEntryResponse = {
          kind: 'student',
          studentPlanId: studentPlan.id,
          title: studentPlan.basePlan.title,
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
      },
      include: { basePlan: { select: { title: true } } }
    });

    if (myPlan) {
      const body: PlanEntryResponse = {
        kind: 'student',
        studentPlanId: myPlan.id,
        title: myPlan.basePlan.title,
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
        basePlan: { select: { title: true } }
      },
      orderBy: { updatedAt: 'desc' }
    });
    res.json(
      plans.map((plan) => ({
        id: plan.id,
        title: plan.basePlan.title,
        basePlanId: plan.basePlanId,
        members: plan.members
      }))
    );
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
        members: { include: { user: true } },
        basePlan: { select: { title: true } }
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
        title: plan.basePlan.title,
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
        content: '',
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
      title: plan.basePlan.title,
      content: plan.content,
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

router.get(
  '/base/:basePlanId/members/:email/problems',
  requireCourseApiToken,
  async (req, res, next) => {
    try {
      const { courseId } = res.locals.auth as { courseId: string };
      const basePlanId = String(req.params.basePlanId);
      const email = decodeURIComponent(String(req.params.email)).trim().toLowerCase();

      const basePlan = await prisma.basePlan.findFirst({
        where: { courseId, id: basePlanId },
        select: { id: true, settings: true }
      });
      if (!basePlan) {
        return res.status(404).json({ message: 'Base plan not found.' });
      }

      const user = await prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } }
      });
      if (!user) {
        return res.status(404).json({ message: 'Member not found.' });
      }

      const membership = await prisma.studentPlanMember.findFirst({
        where: {
          userId: user.id,
          studentPlan: { courseId, basePlanId }
        },
        include: {
          studentPlan: {
            include: {
              members: { include: { user: { select: { id: true, email: true } } } }
            }
          }
        }
      });
      if (!membership) {
        return res.status(404).json({ message: 'No student plan membership for this member and base plan.' });
      }

      const studentPlan = membership.studentPlan;
      const docName = studentPlanDocName(courseId, studentPlan.id);
      const liveJson = getLivePlannerContentJson(docName);
      const fromYjs = liveJson ?? exportPlannerContentFromYjsState(studentPlan.yjsState ?? Buffer.alloc(0));
      const contentJson = fromYjs ?? (studentPlan.content.trim() ? studentPlan.content : null);
      const model = parsePlannerModel(contentJson);
      if (!model) {
        return res.status(404).json({ message: 'Plan model is empty or invalid.' });
      }

      const config = parsePlanConfig(basePlan.settings);
      const externalAuthors = studentPlan.members.map((m) => m.user.id);
      const options = planCheckOptionsFromConfig(config, {
        adminMode: false,
        externalAuthors
      });
      const problems = checkPlan(model, options);

      return res.json({
        basePlanId,
        studentPlanId: studentPlan.id,
        email: user.email,
        problems
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/base/:basePlanId/compare-python',
  requireCourseApiTokenOrStaff,
  async (req, res, next) => {
    try {
      const auth = res.locals.auth as {
        courseId: string;
        roles?: Role[];
        user?: { id: string };
      };
      const { courseId } = auth;
      const sessionUserId = auth.user?.id;
      const isStaff = Boolean(auth.roles?.some((r) => r === 'TA' || r === 'INSTRUCTOR'));
      const basePlanId = String(req.params.basePlanId);
      const body = comparePythonSchema.parse(req.body);
      const compareTo = body.compareTo;
      const compare = body.compare.length > 0 ? body.compare : (['structural'] as const);

      if (sessionUserId && !isStaff && compareTo !== 'student') {
        return res.status(403).json({ message: 'Students can only compare against their own plan.' });
      }

      const basePlan = await prisma.basePlan.findFirst({
        where: { courseId, id: basePlanId },
        select: {
          id: true,
          content: true,
          solutionContent: true,
          solutionYjsState: true
        }
      });
      if (!basePlan) {
        return res.status(404).json({ message: 'Base plan not found.' });
      }

      let expected: PlannerModel | null = null;
      let studentPlanId: string | undefined;
      let email: string | undefined;

      if (compareTo === 'student') {
        // Students always resolve via their own membership; staff/API use body.email.
        let memberUserId: string;
        if (sessionUserId && !isStaff) {
          memberUserId = sessionUserId;
          const selfUser = await prisma.user.findUnique({
            where: { id: sessionUserId },
            select: { email: true }
          });
          email = selfUser?.email;
        } else {
          const lookupEmail = body.email?.trim().toLowerCase();
          if (!lookupEmail) {
            return res.status(400).json({ message: 'email is required when compareTo is "student".' });
          }
          const user = await prisma.user.findFirst({
            where: { email: { equals: lookupEmail, mode: 'insensitive' } }
          });
          if (!user) {
            return res.status(404).json({ message: 'Member not found.' });
          }
          memberUserId = user.id;
          email = user.email;
        }

        const membership = await prisma.studentPlanMember.findFirst({
          where: {
            userId: memberUserId,
            studentPlan: { courseId, basePlanId }
          },
          include: { studentPlan: true }
        });
        if (!membership) {
          return res
            .status(404)
            .json({ message: 'No student plan membership for this member and base plan.' });
        }

        const studentPlan = membership.studentPlan;
        studentPlanId = studentPlan.id;
        const docName = studentPlanDocName(courseId, studentPlan.id);
        const liveJson = getLivePlannerContentJson(docName);
        const fromYjs =
          liveJson ?? exportPlannerContentFromYjsState(studentPlan.yjsState ?? Buffer.alloc(0));
        const contentJson = fromYjs ?? (studentPlan.content.trim() ? studentPlan.content : null);
        expected = parsePlannerModel(contentJson);
        if (!expected) {
          return res.status(404).json({ message: 'Student plan model is empty or invalid.' });
        }
      } else if (compareTo === 'solution') {
        const docName = solutionPlanDocName(courseId, basePlanId);
        const liveJson = getLivePlannerContentJson(docName);
        const fromYjs =
          liveJson ??
          exportPlannerContentFromYjsState(basePlan.solutionYjsState ?? Buffer.alloc(0));
        const contentJson =
          fromYjs ?? (basePlan.solutionContent.trim() ? basePlan.solutionContent : null);
        expected = parsePlannerModel(contentJson);
        if (!expected) {
          return res.status(404).json({ message: 'Solution plan model is empty or invalid.' });
        }
      } else {
        expected = parsePlannerModel(basePlan.content);
        if (!expected) {
          return res.status(404).json({ message: 'Base plan model is empty or invalid.' });
        }
      }

      let actual: PlannerModel;
      try {
        actual = pythonCodeToModel(body.python, { tests: body.tests });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to parse Python source.';
        return res.status(400).json({ message: `Invalid Python: ${message}` });
      }

      const report = comparePlans(expected, actual, { compare: [...compare] });

      return res.json({
        basePlanId,
        compareTo,
        ...(email ? { email } : {}),
        ...(studentPlanId ? { studentPlanId } : {}),
        ...report
      });
    } catch (error) {
      next(error);
    }
  }
);

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
