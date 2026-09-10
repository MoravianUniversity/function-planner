import { createContext, useContext, useMemo, useState } from 'react';

interface CourseContextValue {
  courseId: string | null;
  setCourseId: (courseId: string) => void;
}

const CourseContext = createContext<CourseContextValue | null>(null);

export function CourseProvider({ children }: { children: React.ReactNode }) {
  const [courseId, setCourseId] = useState<string | null>(null);
  const value = useMemo(() => ({ courseId, setCourseId }), [courseId]);

  return <CourseContext.Provider value={value}>{children}</CourseContext.Provider>;
}

export function useCourseContext() {
  const context = useContext(CourseContext);
  if (!context) {
    throw new Error('useCourseContext must be used within CourseProvider');
  }
  return context;
}
