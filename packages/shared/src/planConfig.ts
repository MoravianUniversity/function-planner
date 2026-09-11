import { z } from 'zod';

export const docStyleValues = ['numpy', 'google', 'sphinx', 'epydoc'] as const;
export type DocStyle = (typeof docStyleValues)[number];

/** Module fields that can be locked via PlanConfig.moduleReadOnly (same as prior admin UI). */
export const moduleReadOnlyFieldValues = [
  'documentation',
  'testDocumentation',
  'globalCode',
  'testGlobalCode'
] as const;
export type ModuleReadOnlyField = (typeof moduleReadOnlyFieldValues)[number];

/**
 * Module-level read-only policy for students:
 * - `true` — all module fields locked
 * - `false` — none locked
 * - string[] — custom subset of {@link moduleReadOnlyFieldValues}
 */
export type ModuleReadOnly = boolean | ModuleReadOnlyField[];

/** Function fields that can be locked via PlanConfig.functionReadOnly rules. */
export const functionReadOnlyFieldValues = [
  'name',
  'params',
  'returns',
  'desc',
  'io',
  'testable',
  'owner',
  'code',
  'testCode',
  'calls',
  'callsInto',
  'callsOutOf'
] as const;
export type FunctionReadOnlyField = (typeof functionReadOnlyFieldValues)[number];

/**
 * One rule: regex `for` matched against function names; `fields` is all (`true`) or a custom subset.
 * When multiple rules match, fields are unioned (`true` wins).
 */
export type FunctionReadOnlyRule = {
  for: string;
  fields: true | FunctionReadOnlyField[];
};

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
  showSaveJSON: z.boolean().optional(),
  showTestDocumentation: z.boolean().optional(),
  showGlobalCode: z.boolean().optional(),
  showTestGlobalCode: z.boolean().optional(),
  /** Regex matched against function names; empty = show for none. */
  showCodeFor: z.string().optional(),
  /** Regex matched against function names; empty = show for none. */
  showTestCodeFor: z.string().optional(),
  moduleReadOnly: z
    .union([z.boolean(), z.array(z.enum(moduleReadOnlyFieldValues))])
    .optional(),
  functionReadOnly: z
    .array(
      z.object({
        for: z.string(),
        fields: z.union([z.literal(true), z.array(z.enum(functionReadOnlyFieldValues))])
      })
    )
    .optional()
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
  showTestDocumentation: boolean;
  showGlobalCode: boolean;
  showTestGlobalCode: boolean;
  showCodeFor: string;
  showTestCodeFor: string;
  moduleReadOnly: ModuleReadOnly;
  functionReadOnly: FunctionReadOnlyRule[];
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
  showSaveJSON: false,
  showTestDocumentation: false,
  showGlobalCode: false,
  showTestGlobalCode: false,
  showCodeFor: '',
  showTestCodeFor: '',
  moduleReadOnly: false,
  functionReadOnly: []
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

export function parseModuleReadOnly(value: unknown, fallback: ModuleReadOnly = false): ModuleReadOnly {
  if (typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    // Keep arrays as custom mode even when empty or complete — do not collapse to booleans.
    return value.filter(
      (item): item is ModuleReadOnlyField =>
        typeof item === 'string' && (moduleReadOnlyFieldValues as readonly string[]).includes(item)
    );
  }
  return fallback;
}

/** True when `name` matches the regex `pattern`. Empty/invalid patterns match nothing. */
export function functionNameMatchesPattern(name: string, pattern: string | null | undefined): boolean {
  const raw = typeof pattern === 'string' ? pattern.trim() : '';
  if (!raw) {
    return false;
  }
  try {
    return new RegExp(raw).test(name);
  } catch {
    return false;
  }
}

/**
 * Effective per-function read-only policy from PlanConfig rules.
 * Matching rules merge: `true` wins; otherwise field names are unioned.
 */
export function resolveFunctionReadOnly(
  name: string,
  rules: FunctionReadOnlyRule[] | null | undefined
): boolean | FunctionReadOnlyField[] {
  if (!Array.isArray(rules) || rules.length === 0) {
    return false;
  }
  const fields = new Set<FunctionReadOnlyField>();
  for (const rule of rules) {
    if (!rule || typeof rule.for !== 'string' || !functionNameMatchesPattern(name, rule.for)) {
      continue;
    }
    if (rule.fields === true) {
      return true;
    }
    if (Array.isArray(rule.fields)) {
      for (const field of rule.fields) {
        if ((functionReadOnlyFieldValues as readonly string[]).includes(field)) {
          fields.add(field);
        }
      }
    }
  }
  return fields.size === 0 ? false : [...fields];
}

export function parseFunctionReadOnly(value: unknown, fallback: FunctionReadOnlyRule[] = []): FunctionReadOnlyRule[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const rules: FunctionReadOnlyRule[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    const raw = item as Record<string, unknown>;
    const pattern = typeof raw.for === 'string' ? raw.for : '';
    if (!pattern.trim()) {
      continue;
    }
    if (raw.fields === true) {
      rules.push({ for: pattern, fields: true });
      continue;
    }
    if (Array.isArray(raw.fields)) {
      const fields = raw.fields.filter(
        (f): f is FunctionReadOnlyField =>
          typeof f === 'string' && (functionReadOnlyFieldValues as readonly string[]).includes(f)
      );
      rules.push({ for: pattern, fields });
    }
  }
  return rules;
}

function toPatternString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
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
    showSaveJSON: typeof value.showSaveJSON === 'boolean' ? value.showSaveJSON : DEFAULT_PLAN_CONFIG.showSaveJSON,
    showTestDocumentation:
      typeof value.showTestDocumentation === 'boolean'
        ? value.showTestDocumentation
        : DEFAULT_PLAN_CONFIG.showTestDocumentation,
    showGlobalCode:
      typeof value.showGlobalCode === 'boolean' ? value.showGlobalCode : DEFAULT_PLAN_CONFIG.showGlobalCode,
    showTestGlobalCode:
      typeof value.showTestGlobalCode === 'boolean'
        ? value.showTestGlobalCode
        : DEFAULT_PLAN_CONFIG.showTestGlobalCode,
    showCodeFor: toPatternString(value.showCodeFor, DEFAULT_PLAN_CONFIG.showCodeFor),
    showTestCodeFor: toPatternString(value.showTestCodeFor, DEFAULT_PLAN_CONFIG.showTestCodeFor),
    moduleReadOnly: parseModuleReadOnly(value.moduleReadOnly, DEFAULT_PLAN_CONFIG.moduleReadOnly),
    functionReadOnly: parseFunctionReadOnly(value.functionReadOnly, DEFAULT_PLAN_CONFIG.functionReadOnly)
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
