import type { Role } from '@function-planner/shared';

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface AuthedRequestContext {
  user: SessionUser;
  courseId: string;
  roles: Role[];
}
