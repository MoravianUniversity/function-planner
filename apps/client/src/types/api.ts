import type { BasePlanSummary, CourseOption, StudentPlanSummary, Role } from '@function-planner/shared';

export interface HomeResponse {
  roles: Role[];
  readonly: boolean;
  studentView: {
    myPlans: StudentPlanSummary[];
    availablePublishedPlans: BasePlanSummary[];
  };
  staffView: {
    basePlans: BasePlanSummary[];
    studentPlans: StudentPlanSummary[];
  };
}

export interface CoursesResponse {
  courses: CourseOption[];
  defaultCourseId: string | null;
}

export interface SessionResponse {
  authenticated: boolean;
  user?: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  };
}

export interface PublicAppConfig {
  appName: string;
  allowedEmailDomains: string[];
}

export interface CourseSettingsResponse {
  id: string;
  name: string;
  term: string;
  startsAt: string;
  endsAt: string;
}

export interface BasePlanDetail {
  id: string;
  title: string;
  content: string;
  published: boolean;
  settings: unknown | null;
  updatedAt: string;
  solutionContent: string;
  hasSolution: boolean;
  solutionStale: boolean;
}

export interface StaffStudentPlanRow {
  id: string;
  title: string;
  basePlanId: string;
  members: { user: { firstName: string; lastName: string; email: string } }[];
}
