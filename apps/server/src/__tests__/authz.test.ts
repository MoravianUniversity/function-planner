import { describe, expect, it } from 'vitest';
import { isCourseReadonly } from '@function-planner/shared';

describe('readonly helper', () => {
  it('returns true for past end date', () => {
    const endsAt = new Date(Date.now() - 60_000);
    expect(isCourseReadonly(endsAt)).toBe(true);
  });

  it('returns false for future end date', () => {
    const endsAt = new Date(Date.now() + 60_000);
    expect(isCourseReadonly(endsAt)).toBe(false);
  });
});
