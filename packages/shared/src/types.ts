import type { Role } from './roles.js';

export interface CourseOption {
  id: string;
  name: string;
  term: string;
  startsAt: string;
  endsAt: string;
  readonly: boolean;
  roles: Role[];
}

export interface UserProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface BasePlanSummary {
  id: string;
  title: string;
  published: boolean;
  updatedAt: string;
}

export interface StudentPlanSummary {
  id: string;
  basePlanId: string;
  title: string;
  state: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE';
  readonly: boolean;
}

/** Result of GET /api/plans/entry/:identifier — how to render /plans/:identifier for the current user. */
export type PlanEntryResponse =
  | { kind: 'student'; studentPlanId: string; title: string; basePlanId: string }
  | { kind: 'start-published'; basePlanId: string; title: string }
  | { kind: 'staff-base'; basePlanId: string; title: string };

export interface PlanMemberInfo {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  active: boolean;
}

export interface JoinableStudentPlan {
  id: string;
  title: string;
  members: PlanMemberInfo[];
  activeUserIds: string[];
}

export interface JoinableStudentPlansResponse {
  plans: JoinableStudentPlan[];
}

export type MyJoinRequestStatus =
  | { status: 'none' }
  | { status: 'pending'; joinRequestId: string; studentPlanId: string }
  | { status: 'accepted'; studentPlanId: string }
  | { status: 'rejected' };

export interface PendingJoinRequest {
  id: string;
  studentPlanId: string;
  createdAt: string;
  requester: UserProfile;
}

export interface PendingJoinRequestsResponse {
  requests: PendingJoinRequest[];
}
