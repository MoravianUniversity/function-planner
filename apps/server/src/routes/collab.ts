import { Router } from 'express';
import {
  basePlanDocName,
  collabBasePlanTicketSchema,
  collabSolutionPlanTicketSchema,
  collabStudentPlanTicketSchema,
  solutionPlanDocName,
  studentPlanDocName,
  type Role
} from '@function-planner/shared';
import { prisma } from '../lib/prisma.js';
import { loadCourseContext, requireAuth, requireRole } from '../middleware/auth.js';
import { mintCollabTicket, collabTicketTtlMs, type CollabTicketKind } from '../collab/ticket.js';

const router = Router();

/**
 * Mint a short-lived ticket used as `?ticket=` when opening the y-websocket connection to `/yjs/...`.
 */
router.post('/ticket/base-plan', requireAuth, loadCourseContext, requireRole('TA', 'INSTRUCTOR'), async (req, res, next) => {
  try {
    const { courseId } = res.locals.auth as { courseId: string };
    const parsed = collabBasePlanTicketSchema.parse(req.body);
    if (parsed.courseId !== courseId) {
      return res.status(400).json({ message: 'courseId does not match the active course.' });
    }
    const { basePlanId } = parsed;
    const user = req.user as { id: string };

    const plan = await prisma.basePlan.findFirst({
      where: { courseId, id: basePlanId },
      select: { id: true }
    });
    if (!plan) {
      return res.status(404).json({ message: 'Plan not found in this course.' });
    }

    const docName = basePlanDocName(courseId, basePlanId);
    const ttl = collabTicketTtlMs();
    const ticket = mintCollabTicket(user.id, docName, ttl, 'staff');

    res.json({
      ticket,
      ttlMs: ttl,
      wsServerUrl: '/yjs',
      roomSegment: docName.replace(/^yjs\//, '')
    });
  } catch (error) {
    next(error);
  }
});

router.post('/ticket/solution-plan', requireAuth, loadCourseContext, requireRole('TA', 'INSTRUCTOR'), async (req, res, next) => {
  try {
    const { courseId } = res.locals.auth as { courseId: string };
    const parsed = collabSolutionPlanTicketSchema.parse(req.body);
    if (parsed.courseId !== courseId) {
      return res.status(400).json({ message: 'courseId does not match the active course.' });
    }
    const { basePlanId } = parsed;
    const user = req.user as { id: string };

    const plan = await prisma.basePlan.findFirst({
      where: { courseId, id: basePlanId },
      select: { id: true }
    });
    if (!plan) {
      return res.status(404).json({ message: 'Plan not found in this course.' });
    }

    const docName = solutionPlanDocName(courseId, basePlanId);
    const ttl = collabTicketTtlMs();
    const ticket = mintCollabTicket(user.id, docName, ttl, 'staff');

    res.json({
      ticket,
      ttlMs: ttl,
      wsServerUrl: '/yjs',
      roomSegment: docName.replace(/^yjs\//, '')
    });
  } catch (error) {
    next(error);
  }
});

router.post('/ticket/student-plan', requireAuth, loadCourseContext, requireRole('STUDENT', 'TA', 'INSTRUCTOR'), async (req, res, next) => {
  try {
    const { courseId, user, roles } = res.locals.auth as {
      courseId: string;
      user: { id: string };
      roles: Role[];
    };
    const parsed = collabStudentPlanTicketSchema.parse(req.body);
    if (parsed.courseId !== courseId) {
      return res.status(400).json({ message: 'courseId does not match the active course.' });
    }
    const { studentPlanId } = parsed;

    const plan = await prisma.studentPlan.findFirst({
      where: { id: studentPlanId, courseId },
      include: { members: true }
    });
    if (!plan) {
      return res.status(404).json({ message: 'Student plan not found in this course.' });
    }

    const isMember = plan.members.some((m) => m.userId === user.id);
    const isStaff = roles.includes('TA') || roles.includes('INSTRUCTOR');
    if (!isMember && !isStaff) {
      return res.status(403).json({ message: 'Forbidden.' });
    }

    const kind: CollabTicketKind = isMember ? 'member' : 'staff';
    const docName = studentPlanDocName(courseId, studentPlanId);
    const ttl = collabTicketTtlMs();
    const ticket = mintCollabTicket(user.id, docName, ttl, kind);

    res.json({
      ticket,
      ttlMs: ttl,
      wsServerUrl: '/yjs',
      roomSegment: docName.replace(/^yjs\//, ''),
      kind
    });
  } catch (error) {
    next(error);
  }
});

export default router;
