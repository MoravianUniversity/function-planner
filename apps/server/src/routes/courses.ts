import { Router } from 'express';
import { createCourseSchema, updateCourseSchema } from '@function-planner/shared';
import { requireAuth } from '../middleware/auth.js';
import { listCoursesForUser } from '../services/courseService.js';
import { prisma } from '../lib/prisma.js';

const router = Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const userId = (req.user as { id: string }).id;
    const courses = await listCoursesForUser(userId);
    res.json({
      courses,
      defaultCourseId: courses[0]?.id ?? null
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:courseId', requireAuth, async (req, res, next) => {
  try {
    const userId = (req.user as { id: string }).id;
    const courseId = String(req.params.courseId);
    const enrollment = await prisma.enrollment.findFirst({
      where: {
        userId,
        courseId,
        role: 'INSTRUCTOR',
        enabled: true
      },
      include: { course: true }
    });

    if (!enrollment) {
      return res.status(403).json({ message: 'Instructor access required for course settings.' });
    }

    return res.json({
      id: enrollment.course.id,
      name: enrollment.course.name,
      term: enrollment.course.term,
      startsAt: enrollment.course.startsAt.toISOString(),
      endsAt: enrollment.course.endsAt.toISOString()
    });
  } catch (error) {
    next(error);
  }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const userId = (req.user as { id: string }).id;
    const payload = createCourseSchema.parse(req.body);
    const startsAt = new Date(payload.startsAt);
    if (Number.isNaN(startsAt.getTime())) {
      return res.status(400).json({ message: 'startsAt must be a valid date.' });
    }
    const endsAt = new Date(payload.endsAt);
    if (Number.isNaN(endsAt.getTime())) {
      return res.status(400).json({ message: 'endsAt must be a valid date.' });
    }

    const createdCourse = await prisma.course.create({
      data: {
        name: payload.name,
        term: payload.term,
        startsAt,
        endsAt
      }
    });

    await prisma.enrollment.create({
      data: {
        userId,
        courseId: createdCourse.id,
        role: 'INSTRUCTOR',
        enabled: true
      }
    });

    return res.status(201).json({
      id: createdCourse.id,
      name: createdCourse.name,
      term: createdCourse.term,
      startsAt: createdCourse.startsAt.toISOString(),
      endsAt: createdCourse.endsAt.toISOString()
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/:courseId', requireAuth, async (req, res, next) => {
  try {
    const userId = (req.user as { id: string }).id;
    const courseId = String(req.params.courseId);
    const payload = updateCourseSchema.parse(req.body);
    const startsAt = new Date(payload.startsAt);
    if (Number.isNaN(startsAt.getTime())) {
      return res.status(400).json({ message: 'startsAt must be a valid date.' });
    }
    const endsAt = new Date(payload.endsAt);
    if (Number.isNaN(endsAt.getTime())) {
      return res.status(400).json({ message: 'endsAt must be a valid date.' });
    }

    const enrollment = await prisma.enrollment.findFirst({
      where: {
        userId,
        courseId,
        role: 'INSTRUCTOR',
        enabled: true
      }
    });
    if (!enrollment) {
      return res.status(403).json({ message: 'Instructor access required to edit course.' });
    }

    const updated = await prisma.course.update({
      where: { id: courseId },
      data: {
        name: payload.name,
        term: payload.term,
        startsAt,
        endsAt
      }
    });

    return res.json({
      id: updated.id,
      name: updated.name,
      term: updated.term,
      startsAt: updated.startsAt.toISOString(),
      endsAt: updated.endsAt.toISOString()
    });
  } catch (error) {
    next(error);
  }
});

export default router;
