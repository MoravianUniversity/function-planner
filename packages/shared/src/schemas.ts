import { z } from 'zod';
import { roleValues } from './roles.js';

export const roleSchema = z.enum(roleValues);

export const createCourseContextSchema = z.object({
  courseId: z.string().min(1)
});

export const createCourseSchema = z.object({
  name: z.string().min(1),
  term: z.string().min(1),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1)
});

export const updateCourseSchema = z.object({
  name: z.string().min(1),
  term: z.string().min(1),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1)
});

export const addRosterMemberSchema = z.object({
  email: z.email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  role: roleSchema,
  instructorAssignment: z.enum(['CURRENT_COURSE', 'NEW_COURSE']).optional(),
  newCourse: z
    .object({
      name: z.string().min(1),
      term: z.string().min(1),
      startsAt: z.string().min(1),
      endsAt: z.string().min(1)
    })
    .optional()
});

export const toggleEnrollmentSchema = z.object({
  enabled: z.boolean()
});

export const createBasePlanSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Plan id must use lowercase letters, numbers, and hyphens.'),
  title: z.string().min(1),
  content: z.string().default('')
});

export const updateBasePlanSchema = z.object({
  title: z.string().min(1).optional(),
  content: z.string().optional(),
  published: z.boolean().optional(),
  settings: z.any().nullable().optional()
});

export const startStudentPlanSchema = z.object({
  basePlanId: z.string().min(1),
  memberUserIds: z.array(z.string().min(1)).default([])
});

export const csvStudentSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.email()
});

export const importBasePlansSchema = z.object({
  sourceBasePlans: z
    .array(
      z.object({
        sourceCourseId: z.string().min(1),
        sourceBasePlanId: z.string().min(1)
      })
    )
    .min(1)
});

export const collabBasePlanTicketSchema = z.object({
  courseId: z.string().min(1),
  basePlanId: z.string().min(1)
});

export const collabStudentPlanTicketSchema = z.object({
  courseId: z.string().min(1),
  studentPlanId: z.string().min(1)
});

export const collabSolutionPlanTicketSchema = z.object({
  courseId: z.string().min(1),
  basePlanId: z.string().min(1)
});

export const solutionMergeSchema = z.object({
  mode: z.enum(['merge', 'reset'])
});

export const compareCategorySchema = z.enum(['structural', 'types', 'docs', 'code']);

export const compareToSchema = z.enum(['student', 'solution', 'base']);

export const comparePythonSchema = z
  .object({
    python: z.string().min(1),
    tests: z.string().optional().default(''),
    compareTo: compareToSchema.default('student'),
    email: z.string().optional(),
    compare: z.array(compareCategorySchema).default(['structural'])
  })
  .superRefine((value, ctx) => {
    if (value.compareTo === 'student') {
      const email = value.email?.trim();
      if (!email) {
        ctx.addIssue({
          code: 'custom',
          path: ['email'],
          message: 'email is required when compareTo is "student".'
        });
      }
    }
  });
