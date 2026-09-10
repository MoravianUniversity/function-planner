import { z } from 'zod';

export const docStyleValues = ['numpy', 'google', 'sphinx', 'epydoc'] as const;
export type DocStyle = (typeof docStyleValues)[number];

export const planConfigSchema = z.object({
  title: z.string().optional(),
  allowedTypes: z.array(z.string()).optional(),
  minFunctions: z.number().nonnegative().optional(),
  minTestable: z.number().nonnegative().optional(),
  minModuleDescLength: z.number().nonnegative().optional(),
  minFuncDescLength: z.number().nonnegative().optional(),
  minParamDescLength: z.number().nonnegative().optional(),
  minReturnDescLength: z.number().nonnegative().optional(),
  docStyle: z.enum(docStyleValues).optional(),
  canClaimFuncs: z.boolean().optional(),
  callGraphOnly: z.boolean().optional(),
  showSaveJSON: z.boolean().optional()
});

export type PlanConfig = {
  title: string;
  allowedTypes: string[];
  minFunctions: number;
  minTestable: number;
  minModuleDescLength: number;
  minFuncDescLength: number;
  minParamDescLength: number;
  minReturnDescLength: number;
  docStyle: DocStyle;
  canClaimFuncs: boolean;
  callGraphOnly: boolean;
  showSaveJSON: boolean;
};

export const DEFAULT_PLAN_CONFIG: PlanConfig = {
  title: '',
  allowedTypes: ['int', 'float', 'str', 'bool', 'list', 'tuple', 'dict', 'set'],
  minFunctions: 1,
  minTestable: 0,
  minModuleDescLength: 25,
  minFuncDescLength: 20,
  minParamDescLength: 12,
  minReturnDescLength: 12,
  docStyle: 'numpy',
  canClaimFuncs: false,
  callGraphOnly: false,
  showSaveJSON: false
};

function toStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const next = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return next.length > 0 ? next : fallback;
}

function toNonNegativeNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) {
      return n;
    }
  }
  return fallback;
}

function toDocStyle(value: unknown, fallback: DocStyle): DocStyle {
  if (typeof value === 'string' && (docStyleValues as readonly string[]).includes(value)) {
    return value as DocStyle;
  }
  return fallback;
}

/** Normalize sparse BasePlan.settings JSON into a full PlanConfig with defaults. */
export function parsePlanConfig(raw: unknown): PlanConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_PLAN_CONFIG };
  }

  const value = raw as Record<string, unknown>;
  return {
    title: typeof value.title === 'string' ? value.title : DEFAULT_PLAN_CONFIG.title,
    allowedTypes: toStringArray(value.allowedTypes, DEFAULT_PLAN_CONFIG.allowedTypes),
    minFunctions: toNonNegativeNumber(value.minFunctions, DEFAULT_PLAN_CONFIG.minFunctions),
    minTestable: toNonNegativeNumber(value.minTestable, DEFAULT_PLAN_CONFIG.minTestable),
    minModuleDescLength: toNonNegativeNumber(value.minModuleDescLength, DEFAULT_PLAN_CONFIG.minModuleDescLength),
    minFuncDescLength: toNonNegativeNumber(value.minFuncDescLength, DEFAULT_PLAN_CONFIG.minFuncDescLength),
    minParamDescLength: toNonNegativeNumber(value.minParamDescLength, DEFAULT_PLAN_CONFIG.minParamDescLength),
    minReturnDescLength: toNonNegativeNumber(value.minReturnDescLength, DEFAULT_PLAN_CONFIG.minReturnDescLength),
    docStyle: toDocStyle(value.docStyle, DEFAULT_PLAN_CONFIG.docStyle),
    canClaimFuncs: typeof value.canClaimFuncs === 'boolean' ? value.canClaimFuncs : DEFAULT_PLAN_CONFIG.canClaimFuncs,
    callGraphOnly: typeof value.callGraphOnly === 'boolean' ? value.callGraphOnly : DEFAULT_PLAN_CONFIG.callGraphOnly,
    showSaveJSON: typeof value.showSaveJSON === 'boolean' ? value.showSaveJSON : DEFAULT_PLAN_CONFIG.showSaveJSON
  };
}

/**
 * Best-effort parse of base-plan textarea JSON into a planner initialModel.
 * Expects export shape with `functions` and `calls` arrays.
 */
export function parsePlannerInitialModel(content: string | null | undefined): {
  functions: unknown[];
  calls: unknown[];
  [key: string]: unknown;
} | null {
  if (!content || !content.trim()) {
    return null;
  }
  try {
    const data = JSON.parse(content) as Record<string, unknown>;
    if (!Array.isArray(data.functions) || !Array.isArray(data.calls)) {
      return null;
    }
    return data as { functions: unknown[]; calls: unknown[]; [key: string]: unknown };
  } catch {
    return null;
  }
}
