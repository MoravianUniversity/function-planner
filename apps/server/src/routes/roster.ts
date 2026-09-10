import { Router } from 'express';
import { parse } from 'csv-parse/sync';
import { addRosterMemberSchema, csvStudentSchema, toggleEnrollmentSchema } from '@function-planner/shared';
import { loadCourseContext, requireAuth, requireRole } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';

const router = Router();

router.get('/', requireAuth, loadCourseContext, requireRole('INSTRUCTOR'), async (_req, res, next) => {
  try {
    const { courseId } = res.locals.auth;
    const currentUserId = (res.locals.auth.user as { id: string }).id;
    const enrollments = await prisma.enrollment.findMany({
      where: { courseId },
      include: { user: true },
      orderBy: [{ role: 'asc' }, { user: { lastName: 'asc' } }]
    });

    const grouped = {
      INSTRUCTOR: enrollments.filter((e: { role: string }) => e.role === 'INSTRUCTOR'),
      TA: enrollments.filter((e: { role: string }) => e.role === 'TA'),
      STUDENT: enrollments.filter((e: { role: string }) => e.role === 'STUDENT')
    };

    res.json({ ...grouped, currentUserId });
  } catch (error) {
    next(error);
  }
});

router.post('/', requireAuth, loadCourseContext, requireRole('INSTRUCTOR'), async (req, res, next) => {
  try {
    const parsed = addRosterMemberSchema.parse(req.body);
    const { courseId } = res.locals.auth;
    const assignment = parsed.instructorAssignment ?? 'CURRENT_COURSE';

    const user = await prisma.user.upsert({
      where: { email: parsed.email.toLowerCase() },
      update: {
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        enabled: true
      },
      create: {
        email: parsed.email.toLowerCase(),
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        enabled: true
      }
    });

    let targetCourseId = courseId;
    if (parsed.role === 'INSTRUCTOR' && assignment === 'NEW_COURSE') {
      if (!parsed.newCourse) {
        return res.status(400).json({ message: 'newCourse details are required for NEW_COURSE assignment.' });
      }
      const parsedStartsAt = new Date(parsed.newCourse.startsAt);
      if (Number.isNaN(parsedStartsAt.getTime())) {
        return res.status(400).json({ message: 'newCourse.startsAt must be a valid date.' });
      }
      const parsedEndsAt = new Date(parsed.newCourse.endsAt);
      if (Number.isNaN(parsedEndsAt.getTime())) {
        return res.status(400).json({ message: 'newCourse.endsAt must be a valid date.' });
      }

      const createdCourse = await prisma.course.create({
        data: {
          name: parsed.newCourse.name,
          term: parsed.newCourse.term,
          startsAt: parsedStartsAt,
          endsAt: parsedEndsAt
        }
      });
      targetCourseId = createdCourse.id;
    }

    const enrollment = await prisma.enrollment.upsert({
      where: {
        userId_courseId_role: { userId: user.id, courseId: targetCourseId, role: parsed.role }
      },
      update: { enabled: true },
      create: {
        userId: user.id,
        courseId: targetCourseId,
        role: parsed.role,
        enabled: true
      }
    });

    res.status(201).json({ enrollment, targetCourseId });
  } catch (error) {
    next(error);
  }
});

router.patch('/:enrollmentId', requireAuth, loadCourseContext, requireRole('INSTRUCTOR'), async (req, res, next) => {
  try {
    const { enabled } = toggleEnrollmentSchema.parse(req.body);
    const actorUserId = (res.locals.auth.user as { id: string }).id;
    const enrollmentId = String(req.params.enrollmentId);
    const existing = await prisma.enrollment.findUnique({ where: { id: enrollmentId } });
    if (!existing || existing.courseId !== res.locals.auth.courseId) {
      return res.status(404).json({ message: 'Enrollment not found for this course.' });
    }
    if (!enabled && existing.userId === actorUserId) {
      return res.status(400).json({ message: 'You cannot disable your own instructor access.' });
    }

    const enrollment = await prisma.enrollment.update({
      where: { id: enrollmentId },
      data: { enabled }
    });
    res.json(enrollment);
  } catch (error) {
    next(error);
  }
});

router.post('/import-csv', requireAuth, loadCourseContext, requireRole('INSTRUCTOR'), async (req, res, next) => {
  try {
    const { courseId } = res.locals.auth;
    const csv = typeof req.body.csv === 'string' ? req.body.csv : '';
    const records: unknown[] = parse(csv, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    let imported = 0;
    const errors: string[] = [];

    for (const record of records) {
      const row = record as Record<string, string>;
      const normalized = {
        // Support both firstName/lastName/email and first/last/email headers.
        firstName: row.firstName ?? row.first,
        lastName: row.lastName ?? row.last,
        email: row.email
      };

      const result = csvStudentSchema.safeParse(normalized);
      if (!result.success) {
        errors.push(`Invalid row for email ${(record as Record<string, string>).email ?? 'unknown'}`);
        continue;
      }

      const user = await prisma.user.upsert({
        where: { email: result.data.email.toLowerCase() },
        update: {
          firstName: result.data.firstName,
          lastName: result.data.lastName,
          enabled: true
        },
        create: {
          email: result.data.email.toLowerCase(),
          firstName: result.data.firstName,
          lastName: result.data.lastName,
          enabled: true
        }
      });

      await prisma.enrollment.upsert({
        where: {
          userId_courseId_role: { userId: user.id, courseId, role: 'STUDENT' }
        },
        update: { enabled: true },
        create: { userId: user.id, courseId, role: 'STUDENT' }
      });
      imported += 1;
    }

    res.json({ imported, errors });
  } catch (error) {
    next(error);
  }
});

export default router;
