import type { NextFunction, Request, Response } from 'express';
import { isCourseReadonly } from '@function-planner/shared';
import { prisma } from '../lib/prisma.js';

export const rejectReadonlyCourseWrites = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  const courseId = res.locals.auth?.courseId as string | undefined;
  if (!courseId) {
    res.status(400).json({ message: 'No course context loaded.' });
    return;
  }

  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) {
    res.status(404).json({ message: 'Course not found.' });
    return;
  }

  if (isCourseReadonly(course.endsAt)) {
    res.status(403).json({ message: 'Course is readonly.' });
    return;
  }

  next();
};
