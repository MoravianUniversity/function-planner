import { Router } from 'express';
import { parse } from 'csv-parse/sync';
import { addRosterMemberSchema, csvStudentSchema, toggleEnrollmentSchema } from '@function-planner/shared';
import { loadCourseContext, requireAuth, requireRole } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';

const router = Router();

function normalizeCsvHeader(value: string): string {
  return value.trim().toLowerCase();
}

function looksLikeEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function csvRowLooksLikeHeaders(cells: string[]): boolean {
  const normalized = cells.map(normalizeCsvHeader);
  const hasEmailHeader = normalized.includes('email');
  const hasEmailValue = cells.some(looksLikeEmailAddress);
  // Headers if an "email" column label is present and the row is not itself a data row.
  return hasEmailHeader && !hasEmailValue;
}

function nameUpdateFromProvided(firstName: string, lastName: string): { firstName?: string; lastName?: string } {
  // Do not wipe existing names when the roster add/import leaves them blank.
  return {
    ...(firstName.trim() ? { firstName: firstName.trim() } : {}),
    ...(lastName.trim() ? { lastName: lastName.trim() } : {})
  };
}

function parseCsvStudentRows(csv: string): Array<{ firstName: string; lastName: string; email: string }> {
  const rows: string[][] = parse(csv, {
    columns: false,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true
  });

  if (rows.length === 0) {
    return [];
  }

  if (csvRowLooksLikeHeaders(rows[0])) {
    const headers = rows[0].map(normalizeCsvHeader);
    const emailIdx = headers.findIndex((h) => h === 'email');
    const firstIdx = headers.findIndex((h) => h === 'first' || h === 'firstname');
    const lastIdx = headers.findIndex((h) => h === 'last' || h === 'lastname');

    return rows.slice(1).map((cells) => ({
      lastName: lastIdx >= 0 ? (cells[lastIdx] ?? '') : '',
      firstName: firstIdx >= 0 ? (cells[firstIdx] ?? '') : '',
      email: emailIdx >= 0 ? (cells[emailIdx] ?? '') : ''
    }));
  }

  // Headerless: last,first,email — or a single email column.
  return rows.map((cells) => {
    if (cells.length === 1) {
      return { lastName: '', firstName: '', email: cells[0] ?? '' };
    }
    return {
      lastName: cells[0] ?? '',
      firstName: cells[1] ?? '',
      email: cells[2] ?? ''
    };
  });
}

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
    const firstName = parsed.firstName.trim();
    const lastName = parsed.lastName.trim();

    const user = await prisma.user.upsert({
      where: { email: parsed.email.toLowerCase() },
      update: {
        ...nameUpdateFromProvided(firstName, lastName),
        enabled: true
      },
      create: {
        email: parsed.email.toLowerCase(),
        firstName,
        lastName,
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
    const records = parseCsvStudentRows(csv);

    let imported = 0;
    const errors: string[] = [];

    for (const record of records) {
      const result = csvStudentSchema.safeParse({
        firstName: record.firstName ?? '',
        lastName: record.lastName ?? '',
        email: record.email
      });
      if (!result.success) {
        errors.push(`Invalid row for email ${record.email || 'unknown'}`);
        continue;
      }

      const firstName = result.data.firstName.trim();
      const lastName = result.data.lastName.trim();

      const user = await prisma.user.upsert({
        where: { email: result.data.email.toLowerCase() },
        update: {
          ...nameUpdateFromProvided(firstName, lastName),
          enabled: true
        },
        create: {
          email: result.data.email.toLowerCase(),
          firstName,
          lastName,
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
