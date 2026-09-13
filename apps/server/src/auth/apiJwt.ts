import { SignJWT, jwtVerify, errors as JoseErrors } from 'jose';

export type CourseApiJwtClaims = {
  sub: string;
  course: string;
  iat: number;
};

function getSecretKey(): Uint8Array {
  const secret =
    process.env.API_JWT_SECRET ?? process.env.SESSION_SECRET ?? 'development-only-secret';
  return new TextEncoder().encode(secret);
}

/** Sign a course API JWT with the given claims (iat in unix seconds). */
export async function mintCourseApiJwt(claims: CourseApiJwtClaims): Promise<string> {
  return new SignJWT({ course: claims.course })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt(claims.iat)
    .sign(getSecretKey());
}

/** Verify signature and required claims. Does not check DB current-iat. */
export async function verifyCourseApiJwt(token: string): Promise<CourseApiJwtClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      algorithms: ['HS256']
    });
    const sub = typeof payload.sub === 'string' ? payload.sub : null;
    const course = typeof payload.course === 'string' ? payload.course : null;
    const iat = typeof payload.iat === 'number' ? payload.iat : null;
    if (!sub || !course || iat == null) {
      return null;
    }
    return { sub, course, iat };
  } catch (error) {
    if (error instanceof JoseErrors.JOSEError) {
      return null;
    }
    throw error;
  }
}
