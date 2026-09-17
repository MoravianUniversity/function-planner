import { describe, expect, it } from 'vitest';
import { courseHref } from './courseHref';

describe('courseHref', () => {
  it('keeps bare path for a single course', () => {
    expect(
      courseHref('/plans/abc', {
        courseId: 'c1',
        defaultCourseId: 'c1',
        courseCount: 1
      })
    ).toBe('/plans/abc');
  });

  it('keeps bare path when selection matches automatic default', () => {
    expect(
      courseHref('/roster', {
        courseId: 'c1',
        defaultCourseId: 'c1',
        courseCount: 2
      })
    ).toBe('/roster');
  });

  it('appends courseId when selection differs from default', () => {
    expect(
      courseHref('/plans/abc', {
        courseId: 'c2',
        defaultCourseId: 'c1',
        courseCount: 2
      })
    ).toBe('/plans/abc?courseId=c2');
  });

  it('uses & when the path already has a query string', () => {
    expect(
      courseHref('/x?foo=1', {
        courseId: 'c2',
        defaultCourseId: 'c1',
        courseCount: 2
      })
    ).toBe('/x?foo=1&courseId=c2');
  });
});
