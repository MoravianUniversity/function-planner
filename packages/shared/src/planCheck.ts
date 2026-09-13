import type { PlanConfig } from './planConfig.js';
import type { PlannerFunction, PlannerModel } from './solutionMerge.js';

export type ProblemSeverity = 'error' | 'warning';

export type Problem = {
  severity: ProblemSeverity;
  field: string;
  message: string;
};

export type FunctionProblemsEntry = {
  name: string;
  /** Parameter names in order, when present on the model. */
  params: string[];
  problems: Problem[];
};

export type CallProblemsEntry = {
  from: string;
  to: string;
  fromName: string;
  toName: string;
  problems: Problem[];
};

export type PlanProblemsReport = {
  model: Problem[];
  /** Keyed by function key. */
  functions: Record<string, FunctionProblemsEntry>;
  /** Keyed by function key. */
  functionLinks: Record<string, FunctionProblemsEntry>;
  /** Keyed by `"from-to"` call key. */
  calls: Record<string, CallProblemsEntry>;
};

/** Options for full-pass plan checking (API / eventual UI merge). */
export type PlanCheckOptions = {
  callGraphOnly?: boolean;
  adminMode?: boolean;
  canClaimFuncs?: boolean;
  /** When non-null, authors come from course members (collaborative). */
  externalAuthors?: string[] | null;
  minModuleDescLength?: number;
  minFuncDescLength?: number;
  minParamDescLength?: number;
  minReturnDescLength?: number;
  minFunctions?: number;
  maxFunctions?: number;
  minTestable?: number;
  maxTestable?: number;
  minInputFuncs?: number;
  maxInputFuncs?: number;
  minOutputFuncs?: number;
  maxOutputFuncs?: number;
};

const PYTHON_KEYWORDS = new Set([
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield'
]);

const PYTHON_BUILTINS = new Set([
  'abs',
  'all',
  'any',
  'ascii',
  'bin',
  'bool',
  'bytearray',
  'bytes',
  'callable',
  'chr',
  'classmethod',
  'compile',
  'complex',
  'delattr',
  'dict',
  'dir',
  'divmod',
  'enumerate',
  'eval',
  'exec',
  'filter',
  'float',
  'format',
  'frozenset',
  'getattr',
  'globals',
  'hasattr',
  'hash',
  'help',
  'hex',
  'id',
  'input',
  'int',
  'isinstance',
  'issubclass',
  'iter',
  'len',
  'list',
  'locals',
  'map',
  'max',
  'memoryview',
  'min',
  'next',
  'object',
  'oct',
  'open',
  'ord',
  'pow',
  'print',
  'property',
  'range',
  'repr',
  'reversed',
  'round',
  'set',
  'setattr',
  'slice',
  'sorted',
  'staticmethod',
  'str',
  'sum',
  'super',
  'tuple',
  'type',
  'vars',
  'zip'
]);

const COUNT_DISPLAY_NAME: Record<string, string> = {
  count: 'functions',
  testable: 'testable functions',
  'input-funcs': 'input functions',
  'output-funcs': 'output-only functions'
};

type ParamOrReturn = { name?: string; type?: string; desc?: string; [key: string]: unknown };

type Index = {
  byKey: Map<string, PlannerFunction>;
  calledFunctions: Record<string, string[]>;
  callingFunctions: Record<string, string[]>;
  callKeys: string[];
};

function asString(value: unknown): string {
  if (value == null) {
    return '';
  }
  return String(value);
}

function functionKey(fn: PlannerFunction, index: number): string {
  const key = typeof fn.key === 'string' ? fn.key.trim() : '';
  return key || String(index + 1);
}

function buildIndex(model: PlannerModel): Index {
  const byKey = new Map<string, PlannerFunction>();
  model.functions.forEach((fn, i) => {
    byKey.set(functionKey(fn, i), fn);
  });

  const calledFunctions: Record<string, string[]> = {};
  const callingFunctions: Record<string, string[]> = {};
  const callKeys: string[] = [];

  for (const call of model.calls) {
    const from = asString(call.from).trim();
    const to = asString(call.to).trim();
    if (!from || !to) {
      continue;
    }
    callKeys.push(`${from}-${to}`);
    if (!calledFunctions[from]) {
      calledFunctions[from] = [];
    }
    calledFunctions[from].push(to);
    if (!callingFunctions[to]) {
      callingFunctions[to] = [];
    }
    callingFunctions[to].push(from);
  }

  return { byKey, calledFunctions, callingFunctions, callKeys };
}

function authorsFromModel(model: PlannerModel): string[] {
  const raw = model.authors;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((a) => asString(a));
}

/**
 * Checks for problems with a specific name.
 * @returns a Problem if found, otherwise null
 */
export function checkName(
  name: string,
  type = 'Function',
  field = 'name'
): Problem | null {
  if (!name) {
    return { severity: 'error', field, message: `${type} name is required.` };
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    return {
      severity: 'error',
      field,
      message: `${type} name must start with a letter or underscore and contain only letters, numbers, and underscores.`
    };
  }
  if (PYTHON_KEYWORDS.has(name)) {
    return { severity: 'error', field, message: `${type} name cannot be a Python keyword.` };
  }
  if (PYTHON_BUILTINS.has(name)) {
    return {
      severity: 'error',
      field,
      message: `${type} name cannot be a Python built-in function or type.`
    };
  }
  if (name.startsWith('_') || name.endsWith('_')) {
    return {
      severity: 'warning',
      field,
      message: `${type} name should not start or end with an underscore.`
    };
  }
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    return {
      severity: 'warning',
      field,
      message: `${type} names should be in lowercase with underscores separating words.`
    };
  }
  return null;
}

function isFunctionNameNotUnique(index: Index, key: string, name: string): boolean {
  if (!name) {
    return false;
  }
  for (const [otherKey, fn] of index.byKey) {
    if (otherKey !== key && asString(fn.name).trim() === name) {
      return true;
    }
  }
  return false;
}

function findCycles(index: Index, startingKey: string | null = null): string[][] {
  let cycles: string[][] = [];
  const callGraph: Record<string, string[]> = {};
  for (const [from, tos] of Object.entries(index.calledFunctions)) {
    callGraph[from] = [...tos];
  }
  const keys = new Set(index.byKey.keys());
  const stack: string[] = [];

  const dfs = (key: string): void => {
    if (!keys.has(key)) {
      return;
    }
    keys.delete(key);
    stack.push(key);
    for (const to of callGraph[key] || []) {
      if (stack.includes(to)) {
        cycles.push(stack.slice(stack.lastIndexOf(to)));
      } else {
        dfs(to);
      }
    }
    stack.pop();
  };

  if (startingKey) {
    dfs(startingKey);
    cycles = cycles.filter((cycle) => cycle.includes(startingKey));
  } else {
    while (keys.size > 0) {
      dfs(keys.values().next().value as string);
    }
  }
  return cycles;
}

function cyclesToMap(cycles: string[][]): Map<string, string[]> {
  const links = new Map<string, string[]>();
  for (const cycle of cycles) {
    for (let i = 0; i < cycle.length; i++) {
      const from = cycle[i];
      const to = cycle[(i + 1) % cycle.length];
      if (!links.has(from)) {
        links.set(from, []);
      }
      links.get(from)!.push(to);
    }
  }
  return links;
}

function treeHasIO(index: Index, key: string, checked = new Set<string>()): boolean {
  if (checked.has(key)) {
    return false;
  }
  checked.add(key);
  const io = asString(index.byKey.get(key)?.io);
  if (['validation', 'input', 'output'].includes(io)) {
    return true;
  }
  return (index.calledFunctions[key] || []).some((child) => treeHasIO(index, child, checked));
}

function linkProblems(index: Index, fromKey: string, toKey: string): Problem[] {
  const problems: Problem[] = [];
  const to = index.byKey.get(toKey);
  if (asString(to?.name).trim() === 'main') {
    problems.push({
      severity: 'error',
      field: 'link',
      message: 'Main function should not be called by other functions.'
    });
  } else if (toKey === fromKey) {
    problems.push({
      severity: 'warning',
      field: 'link',
      message: 'Recursive functions are tricky, be careful if this is what you intended.'
    });
  }
  return problems;
}

function funcLinkProblems(index: Index, key: string): Problem[] {
  const problems: Problem[] = [];
  const isMain = asString(index.byKey.get(key)?.name).trim() === 'main';
  const callsInto = index.callingFunctions[key] || [];
  const callsOutOf = index.calledFunctions[key] || [];
  if (isMain) {
    if (callsInto.length !== 0) {
      problems.push({
        severity: 'error',
        field: 'callsInto',
        message: 'Main function should not be called by other functions.'
      });
    }
    if (callsOutOf.length === 0) {
      problems.push({
        severity: 'warning',
        field: 'callsOutOf',
        message: 'Main function should call at least one other function.'
      });
    }
  } else if (callsInto.length === 0) {
    problems.push({
      severity: 'error',
      field: 'callsInto',
      message: 'Non-main functions must be called by at least one other function.'
    });
  } else if (callsInto.includes(key)) {
    problems.push({
      severity: 'warning',
      field: 'callsInto',
      message: 'Recursive functions are tricky, be careful if this is what you intended.'
    });
  }
  return problems;
}

function funcIOProblems(index: Index, key: string, func: PlannerFunction): Problem[] {
  const problems: Problem[] = [];
  const io = asString(func.io || 'none');
  if (asString(func.name).trim() === 'main') {
    if (!['none', 'indirect'].includes(io)) {
      problems.push({
        severity: 'warning',
        field: 'io',
        message: 'Main function should not have any direct user input or output.'
      });
    }
  }
  if (func.testable && io !== 'none') {
    problems.push({
      severity: 'error',
      field: 'testable,io',
      message: 'We cannot test functions that have direct or indirect user input or output.'
    });
  }
  if (io === 'indirect' || io === 'none') {
    const hasChildIO = treeHasIO(index, key);
    if (io === 'indirect') {
      if (!hasChildIO) {
        problems.push({
          severity: 'error',
          field: 'io',
          message:
            'Function is marked as having indirect user I/O but no function it calls has user input/output.'
        });
      }
    } else if (hasChildIO) {
      problems.push({
        severity: 'error',
        field: 'io',
        message:
          "Function is marked as having no user input/output but calls another function with user input/output; it should be marked as 'indirect'."
      });
    }
  }
  return problems;
}

function asParamList(value: unknown): ParamOrReturn[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is ParamOrReturn => Boolean(item) && typeof item === 'object');
}

function funcProblems(
  index: Index,
  key: string,
  options: PlanCheckOptions,
  authors: string[]
): Problem[] {
  const problems: Problem[] = [];
  const func = index.byKey.get(key);
  if (!func) {
    return problems;
  }

  const name = asString(func.name).trim();
  const nameProblem = checkName(name, 'Function', 'name');
  if (nameProblem) {
    problems.push(nameProblem);
  }
  if (isFunctionNameNotUnique(index, key, name)) {
    problems.push({ severity: 'error', field: 'name', message: 'Function name must be unique.' });
  }
  if (options.callGraphOnly) {
    return problems;
  }

  const isMain = name === 'main';
  const desc = asString(func.desc).trim();
  const params = asParamList(func.params);
  const returns = asParamList(func.returns);
  const testable = Boolean(func.testable);

  if (isMain) {
    if (desc.length > 0) {
      problems.push({
        severity: 'warning',
        field: 'desc',
        message: 'Main function does not need a description.'
      });
    }
    if (params.length > 0) {
      problems.push({
        severity: 'error',
        field: 'params',
        message: 'Main function should not have parameters.'
      });
    }
    if (returns.length > 0) {
      problems.push({
        severity: 'error',
        field: 'returns',
        message: 'Main function should not return values.'
      });
    }
  } else {
    if (desc.length === 0) {
      problems.push({
        severity: 'warning',
        field: 'desc',
        message: 'Function description is required.'
      });
    } else if (desc.length < (options.minFuncDescLength ?? 20)) {
      problems.push({
        severity: 'warning',
        field: 'desc',
        message: 'Function description is too short - be more descriptive!'
      });
    }

    const names: string[] = [];
    for (let i = 0; i < params.length; i++) {
      const param = params[i];
      const problem = checkName(asString(param.name), 'Parameter', `params[${i}].name`);
      if (problem) {
        problems.push(problem);
      }
      if (names.includes(asString(param.name))) {
        const dupIndex = names.indexOf(asString(param.name));
        problems.push({
          severity: 'error',
          field: `params[${dupIndex}].name`,
          message: 'Parameter name must be unique within a function.'
        });
        problems.push({
          severity: 'error',
          field: `params[${i}].name`,
          message: 'Parameter name must be unique within a function.'
        });
      }
      names.push(asString(param.name));
      if (!param.type) {
        problems.push({
          severity: 'error',
          field: `params[${i}].type`,
          message: 'Parameter type is required.'
        });
      }
      if (!param.desc) {
        problems.push({
          severity: 'error',
          field: `params[${i}].desc`,
          message: 'Parameter description is required.'
        });
      } else if (asString(param.desc).length < (options.minParamDescLength ?? 12)) {
        problems.push({
          severity: 'warning',
          field: `params[${i}].desc`,
          message: 'Parameter description is too short - be more descriptive!'
        });
      }
    }
    for (let i = 0; i < returns.length; i++) {
      const ret = returns[i];
      if (!ret.type) {
        problems.push({
          severity: 'error',
          field: `returns[${i}].type`,
          message: 'Return value type is required.'
        });
      }
      if (!ret.desc) {
        problems.push({
          severity: 'error',
          field: `returns[${i}].desc`,
          message: 'Return value description is required.'
        });
      } else if (asString(ret.desc).length < (options.minReturnDescLength ?? 12)) {
        problems.push({
          severity: 'warning',
          field: `returns[${i}].desc`,
          message: 'Return value description is too short - be more descriptive!'
        });
      }
    }
  }

  if (testable && params.length === 0) {
    problems.push({
      severity: 'warning',
      field: 'testable,params',
      message: 'Testable functions should have at least one parameter.'
    });
  }
  if (testable && returns.length === 0) {
    problems.push({
      severity: 'warning',
      field: 'testable,returns',
      message: 'Testable functions should have at least one return value.'
    });
  }
  if (options.canClaimFuncs && func.owner && !authors.includes(asString(func.owner))) {
    problems.push({
      severity: 'error',
      field: 'owner',
      message: 'Function owner must be one of the module authors.'
    });
  }
  problems.push(...funcIOProblems(index, key, func));
  return problems;
}

function checkModuleDocumentation(model: PlannerModel, options: PlanCheckOptions): Problem[] {
  const problems: Problem[] = [];
  const docLen = asString(model.documentation).trim().length;
  if (docLen === 0) {
    problems.push({
      severity: 'error',
      field: 'documentation',
      message: 'Module documentation is missing.'
    });
  } else if (docLen < (options.minModuleDescLength ?? 25)) {
    problems.push({
      severity: 'warning',
      field: 'documentation',
      message: 'Module documentation is too short.'
    });
  }
  return problems;
}

function checkModuleAuthors(model: PlannerModel, options: PlanCheckOptions): Problem[] {
  if (options.adminMode && options.externalAuthors == null) {
    return [];
  }
  const authors = authorsFromModel(model);
  const lengths = authors.map((name) => name.trim().length);
  if (options.externalAuthors != null) {
    if (authors.length === 0 || lengths.every((len) => len === 0)) {
      return [
        {
          severity: 'error',
          field: 'authors',
          message: 'Plan must have at least one member.'
        }
      ];
    }
    return [];
  }
  if (authors.length === 0 || lengths.every((len) => len === 0)) {
    return [
      {
        severity: 'error',
        field: 'authors',
        message: 'Author name(s) are required.'
      }
    ];
  }
  if (lengths.some((len) => len < 3)) {
    return [
      {
        severity: 'warning',
        field: 'authors',
        message: 'Author name(s) seem too short.'
      }
    ];
  }
  return [];
}

function checkCountsAndMain(index: Index, options: PlanCheckOptions): Problem[] {
  const problems: Problem[] = [];
  const functions = Array.from(index.byKey.values());
  const hasMain = functions.some((n) => asString(n.name).trim() === 'main');
  if (!hasMain) {
    problems.push({
      severity: 'error',
      field: 'main',
      message: 'There must be a main() function.'
    });
  }

  const minFunctions = options.minFunctions ?? 1;
  const maxFunctions = options.maxFunctions ?? Infinity;
  const minTestable = options.minTestable ?? 0;
  const maxTestable = options.maxTestable ?? Infinity;
  const minInputFuncs = options.minInputFuncs ?? 0;
  const maxInputFuncs = options.maxInputFuncs ?? Infinity;
  const minOutputFuncs = options.minOutputFuncs ?? 0;
  const maxOutputFuncs = options.maxOutputFuncs ?? Infinity;

  const pushCount = (n: number, field: string, min: number, max: number): void => {
    const label = COUNT_DISPLAY_NAME[field] || field;
    if (n < min) {
      problems.push({
        severity: 'error',
        field,
        message: `There must be at least ${min} ${label}.`
      });
    }
    if (n > max) {
      problems.push({
        severity: 'error',
        field,
        message: `There must be at most ${max} ${label}.`
      });
    }
  };

  pushCount(functions.length, 'count', minFunctions, maxFunctions);
  pushCount(
    functions.filter((n) => Boolean(n.testable)).length,
    'testable',
    minTestable,
    maxTestable
  );
  pushCount(
    functions.filter((n) => asString(n.io) === 'output').length,
    'output-funcs',
    minOutputFuncs,
    maxOutputFuncs
  );
  pushCount(
    functions.filter((n) => ['input', 'validation'].includes(asString(n.io))).length,
    'input-funcs',
    minInputFuncs,
    maxInputFuncs
  );

  return problems;
}

/** Build PlanCheckOptions from stored PlanConfig plus API-specific flags. */
export function planCheckOptionsFromConfig(
  config: Pick<
    PlanConfig,
    | 'callGraphOnly'
    | 'canClaimFuncs'
    | 'minModuleDescLength'
    | 'minFuncDescLength'
    | 'minParamDescLength'
    | 'minReturnDescLength'
    | 'minFunctions'
    | 'minTestable'
  >,
  extras: Pick<PlanCheckOptions, 'adminMode' | 'externalAuthors' | 'maxFunctions' | 'maxTestable' | 'minInputFuncs' | 'maxInputFuncs' | 'minOutputFuncs' | 'maxOutputFuncs'> = {}
): PlanCheckOptions {
  return {
    callGraphOnly: config.callGraphOnly,
    canClaimFuncs: config.canClaimFuncs,
    minModuleDescLength: config.minModuleDescLength,
    minFuncDescLength: config.minFuncDescLength,
    minParamDescLength: config.minParamDescLength,
    minReturnDescLength: config.minReturnDescLength,
    minFunctions: config.minFunctions,
    minTestable: config.minTestable,
    adminMode: extras.adminMode ?? false,
    externalAuthors: extras.externalAuthors ?? null,
    maxFunctions: extras.maxFunctions,
    maxTestable: extras.maxTestable,
    minInputFuncs: extras.minInputFuncs,
    maxInputFuncs: extras.maxInputFuncs,
    minOutputFuncs: extras.minOutputFuncs,
    maxOutputFuncs: extras.maxOutputFuncs
  };
}

function paramNames(func: PlannerFunction | undefined): string[] {
  if (!func) {
    return [];
  }
  return asParamList(func.params).map((p) => asString(p.name));
}

function functionDisplayName(index: Index, key: string): string {
  return asString(index.byKey.get(key)?.name).trim();
}

/**
 * Full-pass, evaluate-only problem check over a planner JSON model.
 * Does not mutate the model.
 */
export function checkPlan(model: PlannerModel, options: PlanCheckOptions = {}): PlanProblemsReport {
  const index = buildIndex(model);
  const report: PlanProblemsReport = {
    model: [],
    functions: {},
    functionLinks: {},
    calls: {}
  };

  const authors = authorsFromModel(model);

  for (const key of index.byKey.keys()) {
    const fn = index.byKey.get(key);
    const name = functionDisplayName(index, key);
    const params = paramNames(fn);
    report.functions[key] = {
      name,
      params,
      problems: funcProblems(index, key, options, authors)
    };
    report.functionLinks[key] = {
      name,
      params,
      problems: funcLinkProblems(index, key)
    };
  }

  for (const callKey of index.callKeys) {
    const [from, to] = callKey.split('-');
    report.calls[callKey] = {
      from,
      to,
      fromName: functionDisplayName(index, from),
      toName: functionDisplayName(index, to),
      problems: linkProblems(index, from, to)
    };
  }

  // Cycle warnings on multi-node cycles.
  const cycles = findCycles(index).filter((cycle) => cycle.length > 1);
  const cycleMap = cyclesToMap(cycles);
  for (const callKey of index.callKeys) {
    const [from, to] = callKey.split('-');
    if (cycleMap.has(from) && cycleMap.get(from)!.includes(to)) {
      const entry = report.calls[callKey];
      if (entry && !entry.problems.some((p) => p.message.includes('cycle'))) {
        entry.problems.push({
          severity: 'warning',
          field: 'link',
          message:
            'Part of a recursive cycle. Recursive functions are tricky, be careful if this is what you intended.'
        });
      }
    }
  }
  for (const key of index.byKey.keys()) {
    if (cycleMap.has(key)) {
      const entry = report.functionLinks[key];
      if (entry && !entry.problems.some((p) => p.message.includes('cycle'))) {
        entry.problems.push({
          severity: 'warning',
          field: 'callsInto',
          message:
            'Part of a recursive cycle. Recursive functions are tricky, be careful if this is what you intended.'
        });
      }
    }
  }

  report.model.push(...checkCountsAndMain(index, options));
  if (!options.callGraphOnly) {
    report.model.push(...checkModuleDocumentation(model, options));
    report.model.push(...checkModuleAuthors(model, options));
  }

  return report;
}
