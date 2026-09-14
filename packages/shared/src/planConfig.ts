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

/** Facets for param list locking (structure = cannot add/remove/reorder). */
export const paramFacetValues = ['structure', 'name', 'type', 'desc'] as const;
export type ParamFacet = (typeof paramFacetValues)[number];

/** Facets for return list locking (no name; returns are unnamed). */
export const returnFacetValues = ['structure', 'type', 'desc'] as const;
export type ReturnFacet = (typeof returnFacetValues)[number];

export const ALL_PARAM_FACETS: readonly ParamFacet[] = paramFacetValues;
export const ALL_RETURN_FACETS: readonly ReturnFacet[] = returnFacetValues;

/**
 * One rule: regex `for` matched against function names; `fields` is all (`true`) or a custom subset.
 * When multiple rules match, fields are unioned (`true` wins).
 * Optional paramLock/returnLock refine `params`/`returns` when those are in fields.
 */
export type FunctionReadOnlyRule = {
  for: string;
  fields: true | FunctionReadOnlyField[];
  /** Present only when `params` is in fields and lock is not “entire params”. */
  paramLock?: { for?: string; facets: ParamFacet[] };
  /** Present only when `returns` is in fields and lock is not “entire returns”. */
  returnLock?: { facets: ReturnFacet[] };
};

export type ResolvedParamLock = { for: string; facets: ParamFacet[] };
export type ResolvedReturnLock = { facets: ReturnFacet[] };

/**
 * Effective per-function policy after merging matching rules.
 * Structured form never includes bare `params`/`returns` in `fields` — use `params`/`returns` locks.
 */
export type ResolvedFunctionReadOnly =
  | false
  | true
  | {
      fields: FunctionReadOnlyField[];
      params: ResolvedParamLock[];
      returns: ResolvedReturnLock[];
    };

const paramLockSchema = z.object({
  for: z.string().optional(),
  facets: z.array(z.enum(paramFacetValues))
});

const returnLockSchema = z.object({
  facets: z.array(z.enum(returnFacetValues))
});

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
  showImportPython: z.boolean().optional(),
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
        fields: z.union([z.literal(true), z.array(z.enum(functionReadOnlyFieldValues))]),
        paramLock: paramLockSchema.optional(),
        returnLock: returnLockSchema.optional()
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
  showImportPython: boolean;
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
  showImportPython: false,
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

/** Collapse callsInto+callsOutOf (or bare calls) to a single `calls` token. */
export function normalizeCallReadOnlyFields(fields: FunctionReadOnlyField[]): FunctionReadOnlyField[] {
  const hasCalls = fields.includes('calls');
  const hasInto = fields.includes('callsInto');
  const hasOut = fields.includes('callsOutOf');
  const rest = fields.filter((f) => f !== 'calls' && f !== 'callsInto' && f !== 'callsOutOf');
  if (hasCalls || (hasInto && hasOut)) {
    return [...rest, 'calls'];
  }
  if (hasInto) {
    return [...rest, 'callsInto'];
  }
  if (hasOut) {
    return [...rest, 'callsOutOf'];
  }
  return rest;
}

function equalFacetArrays(left: string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const set = new Set(left);
  return right.every((f) => set.has(f));
}

function parseParamFacets(value: unknown): ParamFacet[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is ParamFacet => typeof item === 'string' && (paramFacetValues as readonly string[]).includes(item)
  );
}

function parseReturnFacets(value: unknown): ReturnFacet[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is ReturnFacet => typeof item === 'string' && (returnFacetValues as readonly string[]).includes(item)
  );
}

function isFullParamLockStored(lock: { for?: string; facets: ParamFacet[] } | undefined): boolean {
  if (!lock) {
    return true;
  }
  const forPat = typeof lock.for === 'string' ? lock.for.trim() : '';
  if (forPat && forPat !== '.*') {
    return false;
  }
  return equalFacetArrays(lock.facets, ALL_PARAM_FACETS);
}

function isFullReturnLockStored(lock: { facets: ReturnFacet[] } | undefined): boolean {
  if (!lock) {
    return true;
  }
  return equalFacetArrays(lock.facets, ALL_RETURN_FACETS);
}

/** Compact paramLock/returnLock and normalize call fields for storage. */
export function compactFunctionReadOnlyRule(rule: FunctionReadOnlyRule): FunctionReadOnlyRule {
  if (rule.fields === true) {
    return { for: rule.for, fields: true };
  }
  let fields = normalizeCallReadOnlyFields([...rule.fields]);
  const hasParams = fields.includes('params');
  const hasReturns = fields.includes('returns');
  const next: FunctionReadOnlyRule = { for: rule.for, fields };

  if (hasParams && rule.paramLock && !isFullParamLockStored(rule.paramLock)) {
    const facets = parseParamFacets(rule.paramLock.facets);
    if (facets.length > 0) {
      const forPat = typeof rule.paramLock.for === 'string' ? rule.paramLock.for.trim() : '';
      next.paramLock = forPat ? { for: forPat, facets } : { facets };
    }
  }

  if (hasReturns && rule.returnLock && !isFullReturnLockStored(rule.returnLock)) {
    const facets = parseReturnFacets(rule.returnLock.facets);
    if (facets.length > 0) {
      next.returnLock = { facets };
    }
  }

  // Drop params/returns from fields if locks ended up empty (no facets).
  if (hasParams && next.paramLock && next.paramLock.facets.length === 0) {
    delete next.paramLock;
    fields = fields.filter((f) => f !== 'params');
    next.fields = fields;
  }
  if (hasReturns && next.returnLock && next.returnLock.facets.length === 0) {
    delete next.returnLock;
    fields = (Array.isArray(next.fields) ? next.fields : fields).filter((f) => f !== 'returns');
    next.fields = fields;
  }

  return next;
}

function asStructuredPolicy(
  policy: ResolvedFunctionReadOnly
): Exclude<ResolvedFunctionReadOnly, boolean> | null {
  if (policy === true || policy === false) {
    return null;
  }
  return policy;
}

/**
 * Effective per-function read-only policy from PlanConfig rules.
 * Matching rules merge: `true` wins; otherwise field names are unioned and param/return locks append.
 */
export function resolveFunctionReadOnly(
  name: string,
  rules: FunctionReadOnlyRule[] | null | undefined
): ResolvedFunctionReadOnly {
  if (!Array.isArray(rules) || rules.length === 0) {
    return false;
  }
  const fields = new Set<FunctionReadOnlyField>();
  const params: ResolvedParamLock[] = [];
  const returns: ResolvedReturnLock[] = [];

  for (const rule of rules) {
    if (!rule || typeof rule.for !== 'string' || !functionNameMatchesPattern(name, rule.for)) {
      continue;
    }
    if (rule.fields === true) {
      return true;
    }
    if (!Array.isArray(rule.fields)) {
      continue;
    }
    for (const field of rule.fields) {
      if (field === 'params' || field === 'returns') {
        continue;
      }
      if ((functionReadOnlyFieldValues as readonly string[]).includes(field)) {
        fields.add(field);
      }
    }
    if (rule.fields.includes('params')) {
      if (rule.paramLock && !isFullParamLockStored(rule.paramLock)) {
        const facets = parseParamFacets(rule.paramLock.facets);
        if (facets.length > 0) {
          const forPat = typeof rule.paramLock.for === 'string' ? rule.paramLock.for.trim() : '';
          params.push({ for: forPat || '.*', facets });
        }
      } else {
        params.push({ for: '.*', facets: [...ALL_PARAM_FACETS] });
      }
    }
    if (rule.fields.includes('returns')) {
      if (rule.returnLock && !isFullReturnLockStored(rule.returnLock)) {
        const facets = parseReturnFacets(rule.returnLock.facets);
        if (facets.length > 0) {
          returns.push({ facets });
        }
      } else {
        returns.push({ facets: [...ALL_RETURN_FACETS] });
      }
    }
  }

  const normalizedFields = normalizeCallReadOnlyFields([...fields]);
  if (normalizedFields.length === 0 && params.length === 0 && returns.length === 0) {
    return false;
  }
  return { fields: normalizedFields, params, returns };
}

/** Whether a top-level function field (not param/return facets) is locked. */
export function isFunctionFieldLocked(
  field: FunctionReadOnlyField,
  policy: ResolvedFunctionReadOnly
): boolean {
  if (policy === true) {
    return true;
  }
  if (policy === false) {
    return false;
  }
  if (field === 'params') {
    return (
      policy.params.length > 0 &&
      policy.params.some(
        (lock) => lock.for === '.*' && equalFacetArrays(lock.facets, ALL_PARAM_FACETS)
      )
    );
  }
  if (field === 'returns') {
    return (
      policy.returns.length > 0 &&
      policy.returns.some((lock) => equalFacetArrays(lock.facets, ALL_RETURN_FACETS))
    );
  }
  if (field === 'callsInto') {
    return policy.fields.includes('callsInto') || policy.fields.includes('calls');
  }
  if (field === 'callsOutOf') {
    return policy.fields.includes('callsOutOf') || policy.fields.includes('calls');
  }
  return policy.fields.includes(field);
}

export function isParamStructureReadOnly(policy: ResolvedFunctionReadOnly): boolean {
  if (policy === true) {
    return true;
  }
  if (policy === false) {
    return false;
  }
  return policy.params.some((lock) => lock.facets.includes('structure'));
}

export function isReturnStructureReadOnly(policy: ResolvedFunctionReadOnly): boolean {
  if (policy === true) {
    return true;
  }
  if (policy === false) {
    return false;
  }
  return policy.returns.some((lock) => lock.facets.includes('structure'));
}

export function isParamFacetReadOnly(
  policy: ResolvedFunctionReadOnly,
  paramName: string | null | undefined,
  facet: Exclude<ParamFacet, 'structure'>
): boolean {
  if (policy === true) {
    return true;
  }
  if (policy === false) {
    return false;
  }
  const name = paramName?.toString() ?? '';
  return policy.params.some(
    (lock) => lock.facets.includes(facet) && functionNameMatchesPattern(name, lock.for)
  );
}

export function isReturnFacetReadOnly(
  policy: ResolvedFunctionReadOnly,
  facet: Exclude<ReturnFacet, 'structure'>
): boolean {
  if (policy === true) {
    return true;
  }
  if (policy === false) {
    return false;
  }
  return policy.returns.some((lock) => lock.facets.includes(facet));
}

/**
 * Checks if a particular part of a read-only policy applies.
 * Accepts module policies (boolean | string[]) or resolved function policies.
 */
export function isReadOnly(
  policy: ResolvedFunctionReadOnly | ModuleReadOnly | FunctionReadOnlyField[] | boolean,
  type: string,
  options: { adminMode?: boolean } = {}
): boolean {
  if (options.adminMode) {
    return false;
  }
  if (policy === true) {
    return true;
  }
  if (policy === false || policy == null) {
    return false;
  }
  if (Array.isArray(policy)) {
    return policy.includes(type as FunctionReadOnlyField & ModuleReadOnlyField);
  }
  const structured = asStructuredPolicy(policy as ResolvedFunctionReadOnly);
  if (!structured) {
    return false;
  }
  if (type === 'params') {
    return isFunctionFieldLocked('params', structured);
  }
  if (type === 'returns') {
    return isFunctionFieldLocked('returns', structured);
  }
  if (type === 'callsInto') {
    return isFunctionFieldLocked('callsInto', structured);
  }
  if (type === 'callsOutOf') {
    return isFunctionFieldLocked('callsOutOf', structured);
  }
  // Legacy path tokens still supported if present in fields (should not be).
  if (structured.fields.includes(type as FunctionReadOnlyField)) {
    return true;
  }
  return false;
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
      const fields = normalizeCallReadOnlyFields(
        raw.fields.filter(
          (f): f is FunctionReadOnlyField =>
            typeof f === 'string' && (functionReadOnlyFieldValues as readonly string[]).includes(f)
        )
      );
      const rule: FunctionReadOnlyRule = { for: pattern, fields };
      if (fields.includes('params') && raw.paramLock && typeof raw.paramLock === 'object' && !Array.isArray(raw.paramLock)) {
        const pl = raw.paramLock as Record<string, unknown>;
        const facets = parseParamFacets(pl.facets);
        if (facets.length > 0 && !isFullParamLockStored({ for: typeof pl.for === 'string' ? pl.for : undefined, facets })) {
          const forPat = typeof pl.for === 'string' ? pl.for.trim() : '';
          rule.paramLock = forPat ? { for: forPat, facets } : { facets };
        }
      }
      if (fields.includes('returns') && raw.returnLock && typeof raw.returnLock === 'object' && !Array.isArray(raw.returnLock)) {
        const rl = raw.returnLock as Record<string, unknown>;
        const facets = parseReturnFacets(rl.facets);
        if (facets.length > 0 && !isFullReturnLockStored({ facets })) {
          rule.returnLock = { facets };
        }
      }
      rules.push(compactFunctionReadOnlyRule(rule));
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
    showImportPython:
      typeof value.showImportPython === 'boolean'
        ? value.showImportPython
        : DEFAULT_PLAN_CONFIG.showImportPython,
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
