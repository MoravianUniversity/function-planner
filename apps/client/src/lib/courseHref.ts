const COURSE_STORAGE_KEY = 'fp:currentCourseId';

export function readStoredCourseId(): string | null {
  try {
    return sessionStorage.getItem(COURSE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeStoredCourseId(courseId: string): void {
  try {
    sessionStorage.setItem(COURSE_STORAGE_KEY, courseId);
  } catch {
    // Ignore quota / private-mode failures; in-memory state still works.
  }
}

/**
 * Append ?courseId= only when the user has multiple courses and the selection
 * differs from what a fresh tab would pick automatically.
 */
export function courseHref(
  path: string,
  options: {
    courseId: string;
    defaultCourseId: string | null;
    courseCount: number;
  }
): string {
  const { courseId, defaultCourseId, courseCount } = options;
  if (courseCount <= 1 || !defaultCourseId || courseId === defaultCourseId) {
    return path;
  }

  const hashIndex = path.indexOf('#');
  const withoutHash = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : '';
  const sep = withoutHash.includes('?') ? '&' : '?';
  return `${withoutHash}${sep}courseId=${encodeURIComponent(courseId)}${hash}`;
}
