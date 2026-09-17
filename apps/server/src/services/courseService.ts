import {
  isCourseReadonly,
  sortCoursesForDisplay,
  type CourseOption
} from '@function-planner/shared';
import { prisma } from '../lib/prisma.js';

export const listCoursesForUser = async (userId: string): Promise<CourseOption[]> => {
  const enrollments = await prisma.enrollment.findMany({
    where: {
      userId,
      enabled: true,
      user: { enabled: true }
    },
    include: {
      course: true
    }
  });

  const byCourse = new Map<string, CourseOption>();
  for (const enrollment of enrollments) {
    const existing = byCourse.get(enrollment.courseId);
    if (existing) {
      existing.roles.push(enrollment.role);
      continue;
    }

    byCourse.set(enrollment.courseId, {
      id: enrollment.course.id,
      name: enrollment.course.name,
      term: enrollment.course.term,
      startsAt: enrollment.course.startsAt.toISOString(),
      endsAt: enrollment.course.endsAt.toISOString(),
      readonly: isCourseReadonly(enrollment.course.endsAt),
      roles: [enrollment.role]
    });
  }

  return sortCoursesForDisplay([...byCourse.values()]);
};
