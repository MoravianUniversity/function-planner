import type { NextFunction, Request, Response } from 'express';
import { verifyCourseApiJwt } from '../auth/apiJwt.js';
import { loadCourseContext, requireAuth, requireRole } from './auth.js';
import { prisma } from '../lib/prisma.js';

/**
 * Authenticate via `Authorization: Bearer <jwt>` course API token.
 * Sets `res.locals.auth = { courseId, via: 'apiToken', sub }` on success.
 */
export const requireCourseApiToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      res.status(401).json({ message: 'Bearer token required.' });
      return;
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      res.status(401).json({ message: 'Bearer token required.' });
      return;
    }

    const claims = await verifyCourseApiJwt(token);
    if (!claims) {
      res.status(401).json({ message: 'Invalid API token.' });
      return;
    }

    const course = await prisma.course.findUnique({
      where: { id: claims.course },
      select: { id: true, apiTokenSub: true, apiTokenIat: true }
    });
    if (!course || course.apiTokenIat == null || course.apiTokenSub == null) {
      res.status(401).json({ message: 'API token is not active for this course.' });
      return;
    }
    if (course.apiTokenIat !== claims.iat || course.apiTokenSub !== claims.sub) {
      res.status(401).json({ message: 'API token has been regenerated.' });
      return;
    }

    res.locals.auth = {
      courseId: course.id,
      via: 'apiToken' as const,
      sub: claims.sub
    };
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Bearer course API JWT, or session cookie for any enrolled course role
 * (STUDENT / TA / INSTRUCTOR; requires `courseId` query).
 * Handler must enforce student-only restrictions (own plan).
 */
export const requireCourseApiTokenOrStaff = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (req.headers.authorization?.startsWith('Bearer ')) {
    void requireCourseApiToken(req, res, next);
    return;
  }
  requireAuth(req, res, (authErr?: unknown) => {
    if (authErr) {
      next(authErr);
      return;
    }
    void loadCourseContext(req, res, (ctxErr?: unknown) => {
      if (ctxErr) {
        next(ctxErr);
        return;
      }
      requireRole('STUDENT', 'TA', 'INSTRUCTOR')(req, res, next);
    });
  });
};
