import {
  ALL_PARAM_FACETS,
  functionReadOnlyFieldValues,
  functionNameMatchesPattern,
  isFunctionFieldLocked,
  moduleReadOnlyFieldValues,
  resolveFunctionReadOnly,
  type ModuleReadOnly,
  type ModuleReadOnlyField,
  type ParamFacet,
  type PlanConfig,
  type ResolvedFunctionReadOnly,
  type ResolvedParamLock,
  type ResolvedReturnLock,
  type ReturnFacet
} from './planConfig.js';

export type PlannerCall = { from: string; to: string; [key: string]: unknown };

export type PlannerFunction = {
  key?: string;
  name?: string;
  [key: string]: unknown;
};

export type PlannerModel = {
  functions: PlannerFunction[];
  calls: PlannerCall[];
  [key: string]: unknown;
};

type ParamEntry = { name?: string; type?: string; desc?: string; [key: string]: unknown };
type ReturnEntry = { type?: string; desc?: string; [key: string]: unknown };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function isModuleFieldLocked(field: ModuleReadOnlyField, moduleReadOnly: ModuleReadOnly): boolean {
  if (moduleReadOnly === true) {
    return true;
  }
  if (moduleReadOnly === false) {
    return false;
  }
  return moduleReadOnly.includes(field);
}

function asParamList(value: unknown): ParamEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => asRecord(item) ?? {}).map((r) => ({ ...r }));
}

function asReturnList(value: unknown): ReturnEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => asRecord(item) ?? {}).map((r) => ({ ...r }));
}

function isFullParamLocks(locks: ResolvedParamLock[]): boolean {
  return locks.some(
    (lock) =>
      lock.for === '.*' &&
      ALL_PARAM_FACETS.every((f) => lock.facets.includes(f))
  );
}

function isFullReturnLocks(locks: ResolvedReturnLock[]): boolean {
  return locks.some((lock) =>
    (['structure', 'type', 'desc'] as const).every((f) => lock.facets.includes(f))
  );
}

function paramFacetLocked(locks: ResolvedParamLock[], paramName: string, facet: Exclude<ParamFacet, 'structure'>): boolean {
  return locks.some(
    (lock) => lock.facets.includes(facet) && functionNameMatchesPattern(paramName, lock.for)
  );
}

function returnFacetLocked(locks: ResolvedReturnLock[], facet: Exclude<ReturnFacet, 'structure'>): boolean {
  return locks.some((lock) => lock.facets.includes(facet));
}

function mergeParamEntry(baseP: ParamEntry | undefined, solP: ParamEntry | undefined, locks: ResolvedParamLock[]): ParamEntry {
  const base = baseP ? structuredClone(baseP) : {};
  const sol = solP ? structuredClone(solP) : {};
  const nameForMatch = typeof sol.name === 'string' ? sol.name : typeof base.name === 'string' ? base.name : '';
  const merged: ParamEntry = { ...base, ...sol };

  if (paramFacetLocked(locks, nameForMatch, 'name')) {
    if (typeof base.name === 'string') {
      merged.name = base.name;
    } else if ('name' in base) {
      merged.name = base.name;
    }
  }
  if (paramFacetLocked(locks, nameForMatch, 'type')) {
    if ('type' in base) {
      merged.type = base.type;
    }
  }
  if (paramFacetLocked(locks, nameForMatch, 'desc')) {
    if ('desc' in base) {
      merged.desc = base.desc;
    }
  }
  return merged;
}

function mergeParams(
  baseParams: unknown,
  solParams: unknown,
  locks: ResolvedParamLock[]
): ParamEntry[] {
  const baseList = asParamList(baseParams);
  const solList = asParamList(solParams);
  if (locks.length === 0) {
    return solList.length > 0 ? solList : baseList;
  }
  if (isFullParamLocks(locks)) {
    return baseList;
  }
  const structureLocked = locks.some((lock) => lock.facets.includes('structure'));
  if (structureLocked) {
    return baseList.map((baseP, i) => {
      const baseName = typeof baseP.name === 'string' ? baseP.name : '';
      const byName = baseName
        ? solList.find((p) => typeof p.name === 'string' && p.name === baseName)
        : undefined;
      const solP = byName ?? solList[i];
      return mergeParamEntry(baseP, solP, locks);
    });
  }
  return solList.map((solP, i) => {
    const solName = typeof solP.name === 'string' ? solP.name : '';
    const byName = solName
      ? baseList.find((p) => typeof p.name === 'string' && p.name === solName)
      : undefined;
    const baseP = byName ?? baseList[i];
    return mergeParamEntry(baseP, solP, locks);
  });
}

function mergeReturnEntry(baseR: ReturnEntry | undefined, solR: ReturnEntry | undefined, locks: ResolvedReturnLock[]): ReturnEntry {
  const base = baseR ? structuredClone(baseR) : {};
  const sol = solR ? structuredClone(solR) : {};
  const merged: ReturnEntry = { ...base, ...sol };
  if (returnFacetLocked(locks, 'type') && 'type' in base) {
    merged.type = base.type;
  }
  if (returnFacetLocked(locks, 'desc') && 'desc' in base) {
    merged.desc = base.desc;
  }
  return merged;
}

function mergeReturns(
  baseReturns: unknown,
  solReturns: unknown,
  locks: ResolvedReturnLock[]
): ReturnEntry[] {
  const baseList = asReturnList(baseReturns);
  const solList = asReturnList(solReturns);
  if (locks.length === 0) {
    return solList.length > 0 ? solList : baseList;
  }
  if (isFullReturnLocks(locks)) {
    return baseList;
  }
  const structureLocked = locks.some((lock) => lock.facets.includes('structure'));
  if (structureLocked) {
    return baseList.map((baseR, i) => mergeReturnEntry(baseR, solList[i], locks));
  }
  return solList.map((solR, i) => mergeReturnEntry(baseList[i], solR, locks));
}

function paramLocksOf(policy: ResolvedFunctionReadOnly): ResolvedParamLock[] {
  if (policy === true) {
    return [{ for: '.*', facets: [...ALL_PARAM_FACETS] }];
  }
  if (policy === false) {
    return [];
  }
  return policy.params;
}

function returnLocksOf(policy: ResolvedFunctionReadOnly): ResolvedReturnLock[] {
  if (policy === true) {
    return [{ facets: ['structure', 'type', 'desc'] }];
  }
  if (policy === false) {
    return [];
  }
  return policy.returns;
}

/**
 * Parse planner export JSON into a model, or null if invalid/empty.
 */
export function parsePlannerModel(content: string | null | undefined): PlannerModel | null {
  if (!content || !content.trim()) {
    return null;
  }
  try {
    const data = JSON.parse(content) as unknown;
    const record = asRecord(data);
    if (!record || !Array.isArray(record.functions) || !Array.isArray(record.calls)) {
      return null;
    }
    return {
      ...record,
      functions: record.functions.filter((f): f is PlannerFunction => Boolean(asRecord(f))),
      calls: record.calls.filter((c): c is PlannerCall => Boolean(asRecord(c)))
    };
  } catch {
    return null;
  }
}

/**
 * Merge base template model into an existing solution model.
 * Template owns structure (function keys + call edges). Student-readonly fields
 * take base values; unlocked fields keep solution values when present.
 */
export function mergeBaseIntoSolution(
  base: PlannerModel,
  solution: PlannerModel | null,
  config: Pick<PlanConfig, 'moduleReadOnly' | 'functionReadOnly'>
): PlannerModel {
  if (!solution) {
    return structuredClone(base);
  }

  const solutionByKey = new Map<string, PlannerFunction>();
  for (const fn of solution.functions) {
    const key = typeof fn.key === 'string' ? fn.key : '';
    if (key) {
      solutionByKey.set(key, fn);
    }
  }

  const mergedFunctions: PlannerFunction[] = base.functions.map((baseFn) => {
    const key = typeof baseFn.key === 'string' ? baseFn.key : '';
    const solFn = key ? solutionByKey.get(key) : undefined;
    if (!solFn) {
      return structuredClone(baseFn);
    }

    const name = typeof baseFn.name === 'string' ? baseFn.name : typeof solFn.name === 'string' ? solFn.name : '';
    const policy = resolveFunctionReadOnly(name, config.functionReadOnly);
    const merged: PlannerFunction = { ...structuredClone(baseFn) };

    for (const field of functionReadOnlyFieldValues) {
      if (field === 'name') {
        // Name is structural identity for matching rules; keep base when present.
        if (typeof baseFn.name === 'string') {
          merged.name = baseFn.name;
        }
        continue;
      }
      if (field === 'params') {
        merged.params = mergeParams(baseFn.params, solFn.params, paramLocksOf(policy));
        continue;
      }
      if (field === 'returns') {
        merged.returns = mergeReturns(baseFn.returns, solFn.returns, returnLocksOf(policy));
        continue;
      }
      if (field === 'calls' || field === 'callsInto' || field === 'callsOutOf') {
        // Call graph is owned by the template below; skip per-function call fields.
        continue;
      }
      if (isFunctionFieldLocked(field, policy)) {
        if (field in baseFn) {
          merged[field] = structuredClone(baseFn[field]);
        }
      } else if (field in solFn) {
        merged[field] = structuredClone(solFn[field]);
      }
    }

    // Preserve any extra solution-only keys that are not known function fields,
    // but do not reintroduce keys for functions removed from the template.
    for (const [extraKey, value] of Object.entries(solFn)) {
      if (
        extraKey === 'key' ||
        (functionReadOnlyFieldValues as readonly string[]).includes(extraKey) ||
        extraKey in merged
      ) {
        continue;
      }
      merged[extraKey] = structuredClone(value);
    }

    if (key) {
      merged.key = key;
    }
    return merged;
  });

  // Template owns call-graph structure.
  const mergedCalls = structuredClone(base.calls);

  const merged: PlannerModel = {
    ...structuredClone(base),
    functions: mergedFunctions,
    calls: mergedCalls
  };

  for (const field of moduleReadOnlyFieldValues) {
    if (isModuleFieldLocked(field, config.moduleReadOnly)) {
      if (field in base) {
        merged[field] = structuredClone(base[field]);
      } else {
        delete merged[field];
      }
    } else if (field in solution) {
      merged[field] = structuredClone(solution[field]);
    }
  }

  // Non-module layout/model keys already come from structuredClone(base).
  return merged;
}

/** Serialize a planner model to the JSON string stored in content / solutionContent. */
export function stringifyPlannerModel(model: PlannerModel): string {
  return JSON.stringify(model);
}
