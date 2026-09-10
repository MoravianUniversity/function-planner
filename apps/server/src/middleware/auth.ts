import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@function-planner/shared';
import { roleValues } from '@function-planner/shared';
import { prisma } from '../lib/prisma.js';

const validRoles = new Set<Role>(roleValues);

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }
  next();
};

export const loadCourseContext = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const courseId = (req.query.courseId || req.params.courseId) as string | undefined;
    if (!courseId) {
      res.status(400).json({ message: 'courseId is required.' });
      return;
    }

    const enrollments = await prisma.enrollment.findMany({
      where: {
        courseId,
        userId: (req.user as { id: string }).id,
        enabled: true,
        user: { enabled: true }
      }
    });

    const roles = enrollments
      .map((enrollment: { role: string }) => enrollment.role as Role)
      .filter((role: Role) => validRoles.has(role));

    if (!roles.length) {
      res.status(403).json({ message: 'No access to course.' });
      return;
    }

    res.locals.auth = {
      user: req.user,
      courseId,
      roles
    };
    next();
  } catch (error) {
    next(error);
  }
};

export const requireRole = (...allowedRoles: Role[]) => {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const roles = (res.locals.auth?.roles || []) as Role[];
    const allowed = roles.some((role) => allowedRoles.includes(role));
    if (!allowed) {
      res.status(403).json({ message: 'Forbidden' });
      return;
    }
    next();
  };
};
