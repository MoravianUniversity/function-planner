import type { PlannerCall, PlannerFunction, PlannerModel } from './solutionMerge.js';

/** Top-level compare categories accepted by the API. */
export type CompareCategory = 'structural' | 'types' | 'docs' | 'code';

/** Expanded difference categories in the report. */
export type DiffCategory =
  | 'functions'
  | 'params'
  | 'returns'
  | 'calls'
  | 'io'
  | 'testable'
  | 'types'
  | 'docs'
  | 'code';

export type PlanCompareOptions = {
  compare: CompareCategory[];
};

export type PlanDifference = {
  category: DiffCategory;
  severity: 'major';
  function?: string;
  message: string;
  expected?: unknown;
  actual?: unknown;
};

export type PlanCompareReport = {
  compare: CompareCategory[];
  expected: { functionCount: number };
  actual: { functionCount: number };
  differences: PlanDifference[];
};

type ParamLike = { name?: string; type?: string; desc?: string };
type ReturnLike = { type?: string; desc?: string };

const STRUCTURAL_CHECKS: DiffCategory[] = [
  'functions',
  'params',
  'returns',
  'calls',
  'io',
  'testable'
];

/**
 * Compare an expected planner model to an actual model (e.g. imported from Python).
 * Functions are matched by name, not by key.
 */
export function comparePlans(
  expected: PlannerModel,
  actual: PlannerModel,
  options: PlanCompareOptions
): PlanCompareReport {
  const compare = normalizeCompare(options.compare);
  const active = expandCompare(compare);
  const differences: PlanDifference[] = [];

  const expectedByName = indexByName(expected.functions);
  const actualByName = indexByName(actual.functions);
  const expectedNames = new Set(expectedByName.keys());
  const actualNames = new Set(actualByName.keys());

  if (active.has('functions')) {
    for (const name of expectedNames) {
      if (!actualNames.has(name)) {
        differences.push({
          category: 'functions',
          severity: 'major',
          function: name,
          message: `Missing function "${name}".`,
          expected: name,
          actual: null
        });
      }
    }
    for (const name of actualNames) {
      if (!expectedNames.has(name)) {
        differences.push({
          category: 'functions',
          severity: 'major',
          function: name,
          message: `Extra function "${name}".`,
          expected: null,
          actual: name
        });
      }
    }
  }

  const sharedNames = [...expectedNames].filter((n) => actualNames.has(n)).sort();

  for (const name of sharedNames) {
    const expFn = expectedByName.get(name)!;
    const actFn = actualByName.get(name)!;

    if (active.has('params')) {
      const expParams = paramNames(expFn);
      const actParams = paramNames(actFn);
      if (!sameStringList(expParams, actParams)) {
        differences.push({
          category: 'params',
          severity: 'major',
          function: name,
          message: `Parameter names differ for "${name}".`,
          expected: expParams,
          actual: actParams
        });
      }
    }

    if (active.has('returns')) {
      const expReturns = returnCount(expFn);
      const actReturns = returnCount(actFn);
      if (expReturns !== actReturns) {
        differences.push({
          category: 'returns',
          severity: 'major',
          function: name,
          message: `Return count differs for "${name}".`,
          expected: expReturns,
          actual: actReturns
        });
      }
    }

    if (active.has('io')) {
      const expIo = asString(expFn.io) || 'none';
      const actIo = asString(actFn.io) || 'none';
      if (expIo !== actIo) {
        differences.push({
          category: 'io',
          severity: 'major',
          function: name,
          message: `IO kind differs for "${name}".`,
          expected: expIo,
          actual: actIo
        });
      }
    }

    if (active.has('testable')) {
      const expTestable = Boolean(expFn.testable);
      const actTestable = Boolean(actFn.testable);
      if (expTestable !== actTestable) {
        differences.push({
          category: 'testable',
          severity: 'major',
          function: name,
          message: `Testable flag differs for "${name}".`,
          expected: expTestable,
          actual: actTestable
        });
      }
    }

    if (active.has('types')) {
      compareTypes(name, expFn, actFn, differences);
    }

    if (active.has('docs')) {
      const expDesc = normalizeDocs(asString(expFn.desc));
      const actDesc = normalizeDocs(asString(actFn.desc));
      if (expDesc !== actDesc) {
        differences.push({
          category: 'docs',
          severity: 'major',
          function: name,
          message: `Description differs for "${name}".`,
          expected: expDesc,
          actual: actDesc
        });
      }
    }

    if (active.has('code')) {
      const expCode = normalizeCode(asString(expFn.code));
      const actCode = normalizeCode(asString(actFn.code));
      if (expCode !== actCode) {
        differences.push({
          category: 'code',
          severity: 'major',
          function: name,
          message: `Code differs for "${name}".`,
          expected: expCode,
          actual: actCode
        });
      }
    }
  }

  if (active.has('calls')) {
    const expCalls = callEdgesByName(expected);
    const actCalls = callEdgesByName(actual);
    for (const edge of expCalls) {
      if (!actCalls.has(edge)) {
        const [from, to] = edge.split('->');
        differences.push({
          category: 'calls',
          severity: 'major',
          function: from,
          message: `Missing call ${from} → ${to}.`,
          expected: edge,
          actual: null
        });
      }
    }
    for (const edge of actCalls) {
      if (!expCalls.has(edge)) {
        const [from, to] = edge.split('->');
        differences.push({
          category: 'calls',
          severity: 'major',
          function: from,
          message: `Extra call ${from} → ${to}.`,
          expected: null,
          actual: edge
        });
      }
    }
  }

  if (active.has('docs')) {
    const expDoc = normalizeDocs(asString(expected.documentation));
    const actDoc = normalizeDocs(asString(actual.documentation));
    if (expDoc !== actDoc) {
      differences.push({
        category: 'docs',
        severity: 'major',
        message: 'Module documentation differs.',
        expected: expDoc,
        actual: actDoc
      });
    }
  }

  if (active.has('code')) {
    const expGlobal = normalizeCode(asString(expected.globalCode));
    const actGlobal = normalizeCode(asString(actual.globalCode));
    if (expGlobal !== actGlobal) {
      differences.push({
        category: 'code',
        severity: 'major',
        message: 'Module global code differs.',
        expected: expGlobal,
        actual: actGlobal
      });
    }
  }

  return {
    compare,
    expected: { functionCount: expected.functions.length },
    actual: { functionCount: actual.functions.length },
    differences
  };
}

function normalizeCompare(compare: CompareCategory[] | undefined): CompareCategory[] {
  if (!compare || compare.length === 0) {
    return ['structural'];
  }
  return [...new Set(compare)];
}

function expandCompare(compare: CompareCategory[]): Set<DiffCategory> {
  const active = new Set<DiffCategory>();
  for (const cat of compare) {
    if (cat === 'structural') {
      for (const c of STRUCTURAL_CHECKS) {
        active.add(c);
      }
    } else {
      active.add(cat);
    }
  }
  return active;
}

function indexByName(functions: PlannerFunction[]): Map<string, PlannerFunction> {
  const map = new Map<string, PlannerFunction>();
  for (const fn of functions) {
    const name = asString(fn.name);
    if (!name) {
      continue;
    }
    if (!map.has(name)) {
      map.set(name, fn);
    }
  }
  return map;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function asParamList(value: unknown): ParamLike[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((p): p is ParamLike => Boolean(p) && typeof p === 'object');
}

function asReturnList(value: unknown): ReturnLike[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((r): r is ReturnLike => Boolean(r) && typeof r === 'object');
}

function paramNames(fn: PlannerFunction): string[] {
  return asParamList(fn.params).map((p) => asString(p.name));
}

function returnCount(fn: PlannerFunction): number {
  const returns = asReturnList(fn.returns);
  // Empty type+desc often means "no meaningful return" in planner templates
  const meaningful = returns.filter((r) => asString(r.type) || asString(r.desc));
  return meaningful.length > 0 ? meaningful.length : returns.length > 0 ? returns.length : 0;
}

function sameStringList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((v, i) => v === b[i]);
}

function normalizeType(type: string): string {
  const t = type.trim().replace(/\s+/g, ' ');
  if (!t || t === 'None' || t === 'none' || t === 'object') {
    return '';
  }
  return t;
}

function normalizeDocs(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function normalizeCode(text: string): string {
  return text
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function compareTypes(
  name: string,
  expFn: PlannerFunction,
  actFn: PlannerFunction,
  differences: PlanDifference[]
): void {
  const expParams = asParamList(expFn.params);
  const actParams = asParamList(actFn.params);
  const len = Math.max(expParams.length, actParams.length);
  for (let i = 0; i < len; i++) {
    const exp = normalizeType(asString(expParams[i]?.type));
    const act = normalizeType(asString(actParams[i]?.type));
    const paramName = asString(expParams[i]?.name) || asString(actParams[i]?.name) || `#${i}`;
    if (exp !== act) {
      differences.push({
        category: 'types',
        severity: 'major',
        function: name,
        message: `Parameter type differs for "${name}.${paramName}".`,
        expected: exp,
        actual: act
      });
    }
  }

  const expReturns = asReturnList(expFn.returns);
  const actReturns = asReturnList(actFn.returns);
  const retLen = Math.max(expReturns.length, actReturns.length);
  for (let i = 0; i < retLen; i++) {
    const exp = normalizeType(asString(expReturns[i]?.type));
    const act = normalizeType(asString(actReturns[i]?.type));
    if (exp !== act) {
      differences.push({
        category: 'types',
        severity: 'major',
        function: name,
        message: `Return type differs for "${name}" (index ${i}).`,
        expected: exp,
        actual: act
      });
    }
  }
}

function keyToName(functions: PlannerFunction[]): Map<string, string> {
  const map = new Map<string, string>();
  functions.forEach((fn, i) => {
    const key = asString(fn.key) || String(i);
    const name = asString(fn.name) || key;
    map.set(key, name);
  });
  return map;
}

function callEdgesByName(model: PlannerModel): Set<string> {
  const keyNames = keyToName(model.functions);
  const edges = new Set<string>();
  for (const call of model.calls as PlannerCall[]) {
    const from = keyNames.get(asString(call.from)) || asString(call.from);
    const to = keyNames.get(asString(call.to)) || asString(call.to);
    if (from && to) {
      edges.add(`${from}->${to}`);
    }
  }
  return edges;
}
