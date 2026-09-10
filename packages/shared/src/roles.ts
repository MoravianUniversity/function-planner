export const roleValues = ['INSTRUCTOR', 'TA', 'STUDENT'] as const;
export type Role = (typeof roleValues)[number];
