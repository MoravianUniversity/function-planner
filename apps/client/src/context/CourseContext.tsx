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

  // Apply courseId from the URL only when the URL itself changes (middle-click,
  // shared links, back/forward). Do not re-run on courseId changes — otherwise
  // selecting the default while ?courseId= still holds the previous course
  // snaps the selection back before URL sync can strip the param.
  useEffect(() => {
    const fromUrl = searchParams.get('courseId');
    if (!fromUrl) {
      return;
    }
    setCourseIdState((current) => {
      if (current === fromUrl) {
        return current;
      }
      writeStoredCourseId(fromUrl);
      return fromUrl;
    });
  }, [searchParams]);

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
