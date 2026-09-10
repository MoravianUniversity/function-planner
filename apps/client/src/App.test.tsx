import { describe, expect, it } from 'vitest';
import { isCourseReadonly } from '@function-planner/shared';

describe('readonly behavior utility', () => {
  it('flags finished classes as readonly', () => {
    expect(isCourseReadonly(new Date(Date.now() - 1_000))).toBe(true);
  });
});
