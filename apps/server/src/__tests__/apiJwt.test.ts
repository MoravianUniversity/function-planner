import { describe, expect, it } from 'vitest';
import { mintCourseApiJwt, verifyCourseApiJwt } from '../auth/apiJwt.js';

describe('course API JWT', () => {
  it('round-trips claims', async () => {
    const claims = { sub: 'teacher@example.com', course: 'course-1', iat: 1_700_000_000 };
    const token = await mintCourseApiJwt(claims);
    const verified = await verifyCourseApiJwt(token);
    expect(verified).toEqual(claims);
  });

  it('rejects tampered tokens', async () => {
    const token = await mintCourseApiJwt({
      sub: 'teacher@example.com',
      course: 'course-1',
      iat: 1_700_000_000
    });
    expect(await verifyCourseApiJwt(`${token}x`)).toBeNull();
  });
});
