import {
  functionReadOnlyFieldValues,
  moduleReadOnlyFieldValues,
  resolveFunctionReadOnly,
  type FunctionReadOnlyField,
  type ModuleReadOnly,
  type ModuleReadOnlyField,
  type PlanConfig
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

function isFunctionFieldLocked(
  field: FunctionReadOnlyField,
  policy: boolean | FunctionReadOnlyField[]
): boolean {
  if (policy === true) {
    return true;
  }
  if (policy === false) {
    return false;
  }
  return policy.includes(field);
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
