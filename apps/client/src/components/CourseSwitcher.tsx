import type { CourseOption } from '@function-planner/shared';

interface Props {
  courses: CourseOption[];
  selectedCourseId: string | null;
  onSelect: (courseId: string) => void;
}

export function CourseSwitcher({ courses, selectedCourseId, onSelect }: Props) {
  if (courses.length <= 1) {
    return null;
  }

  return (
    <select value={selectedCourseId ?? ''} onChange={(event) => onSelect(event.target.value)} id="course-switcher" aria-label="Course switcher">
      {courses.map((course) => (
        <option key={course.id} value={course.id}>
          {course.name} ({course.term}) {course.readonly ? '- readonly' : ''}
        </option>
      ))}
    </select>
  );
}
