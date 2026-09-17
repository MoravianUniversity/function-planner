import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { courseHref, readStoredCourseId, writeStoredCourseId } from '../lib/courseHref';

interface CourseContextValue {
  courseId: string | null;
  setCourseId: (courseId: string) => void;
  defaultCourseId: string | null;
  courseCount: number;
  setCourseMeta: (meta: { defaultCourseId: string | null; courseCount: number }) => void;
  coursePath: (path: string) => string;
}

const CourseContext = createContext<CourseContextValue | null>(null);

export function CourseProvider({ children }: { children: React.ReactNode }) {
  const [searchParams] = useSearchParams();
  const [courseId, setCourseIdState] = useState<string | null>(() => readStoredCourseId());
  const [defaultCourseId, setDefaultCourseId] = useState<string | null>(null);
  const [courseCount, setCourseCount] = useState(0);

  // URL wins when present (middle-click / shared links / back-forward).
  useEffect(() => {
    const fromUrl = searchParams.get('courseId');
    if (fromUrl && fromUrl !== courseId) {
      writeStoredCourseId(fromUrl);
      setCourseIdState(fromUrl);
    }
  }, [searchParams, courseId]);

  const setCourseId = useCallback((nextCourseId: string) => {
    writeStoredCourseId(nextCourseId);
    setCourseIdState(nextCourseId);
  }, []);

  const setCourseMeta = useCallback((meta: { defaultCourseId: string | null; courseCount: number }) => {
    setDefaultCourseId(meta.defaultCourseId);
    setCourseCount(meta.courseCount);
  }, []);

  const coursePath = useCallback(
    (path: string) => {
      if (!courseId) {
        return path;
      }
      return courseHref(path, { courseId, defaultCourseId, courseCount });
    },
    [courseId, defaultCourseId, courseCount]
  );

  const value = useMemo(
    () => ({
      courseId,
      setCourseId,
      defaultCourseId,
      courseCount,
      setCourseMeta,
      coursePath
    }),
    [courseId, setCourseId, defaultCourseId, courseCount, setCourseMeta, coursePath]
  );

  return <CourseContext.Provider value={value}>{children}</CourseContext.Provider>;
}

export function useCourseContext() {
  const context = useContext(CourseContext);
  if (!context) {
    throw new Error('useCourseContext must be used within CourseProvider');
  }
  return context;
}
