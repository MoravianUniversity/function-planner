/**
 * Parses Python source into a PlannerModel (functions, params, returns, calls, IO).
 *
 * Intentional limits (planner does not use the omitted info yet):
 * - Only top-level functions (no nested / async / class methods)
 * - Positional-only / keyword-only / *args / **kwargs not distinguished; defaults ignored
 * - Direct I/O via input()/print() (+ try/while as validation); comment overrides
 * - Call edges only for simple Name callees among top-level functions
 *
 * Note: pass a pytest-style tests file via options.tests (or applyPythonTestsToModel)
 * to set testable / testCode / testDocumentation / testGlobalCode. Without tests,
 * testable stays false.
 */

import {
  getDocstring,
  parse as parsePythonAst,
  unparse,
  walk,
  type Arg,
  type ASTNode,
  type ExprNode,
  type FunctionDef,
  type Module,
  type StmtNode
} from 'py-ast';
import { applyPythonTestsToModel } from './pythonTests.js';
import type { PlannerCall, PlannerFunction, PlannerModel } from './solutionMerge.js';

export type PythonImportOptions = {
  /** Optional pytest-style tests source used to mark testable functions. */
  tests?: string;
};

type DocParam = { type?: string; desc?: string };
type DocReturn = { type?: string; desc?: string };

type ParsedDocstring = {
  desc: string;
  docParams: Map<string, DocParam>;
  docReturns: DocReturn[];
};

type ParamEntry = { name: string; type: string; desc: string };
type ReturnEntry = { type: string; desc: string };

type FunctionBuild = PlannerFunction & {
  key: string;
  name: string;
  desc: string;
  code: string;
  params: ParamEntry[];
  returns: ReturnEntry[];
  io: string;
  testCode: string;
  testable: boolean;
  owner: string;
  _callsByName?: string[];
};

/**
 * Converts Python code into a structured planner model.
 * @throws if the Python (or optional tests) source cannot be parsed
 */
export function pythonCodeToModel(code: string, options: PythonImportOptions = {}): PlannerModel {
  const ast = parsePythonAst(code) as Module;
  const sourceLines = code.split('\n');
  const nodeEndLine = computeNodeEndLines(ast, sourceLines);
  const globalCode = extractGlobalCode(ast, sourceLines, nodeEndLine);
  const { authors, description } = extractModuleAuthorsAndDescription(getDocstring(ast) || '');

  const functionNodes = (ast.body || []).filter(
    (node): node is FunctionDef => node.nodeType === 'FunctionDef'
  );
  const functionNames = new Set(functionNodes.map((node) => node.name));
  const nameToKey = new Map(functionNodes.map((node, i) => [node.name, i.toString()]));

  const functions: FunctionBuild[] = functionNodes.map((node, index) => {
    const doc = getDocstring(node) || '';
    const { desc, docParams, docReturns } = parseDocstringParts(doc);
    const codeBody = getFunctionCode(
      node,
      sourceLines,
      nodeEndLine.get(node) ?? sourceLines.length + 1
    );

    const args: Arg[] = [
      ...(node.args?.posonlyargs || []),
      ...(node.args?.args || []),
      ...(node.args?.kwonlyargs || [])
    ];
    if (node.args?.vararg) {
      args.push(node.args.vararg);
    }
    if (node.args?.kwarg) {
      args.push(node.args.kwarg);
    }

    const called = new Set<string>();
    for (const child of walk(node)) {
      if (
        child.nodeType === 'Call' &&
        child.func?.nodeType === 'Name' &&
        functionNames.has(child.func.id)
      ) {
        called.add(child.func.id);
      }
    }
    for (const line of codeBody.split('\n')) {
      const callMatch = line
        .trim()
        .match(
          /^\s*#\s*Calls\s+([A-Za-z_][A-Za-z0-9_]*(\(\))?(?:\s*(,|\s|\sand\s)\s*[A-Za-z_][A-Za-z0-9_]*(\(\))?)*)\s*$/
        );
      if (callMatch) {
        const callLine = callMatch[1]
          .replace(/\(\)/g, '')
          .replace(/,/g, ' ')
          .replace(/\s+and\s+/g, ' ')
          .replace(/\s+/g, ' ');
        for (const calledFunc of callLine.split(' ')) {
          if (functionNames.has(calledFunc)) {
            called.add(calledFunc);
          }
        }
      }
    }

    return {
      key: index.toString(),
      name: node.name,
      desc,
      code: codeBody,
      params: extractParamTypes(args, docParams),
      returns: removeObjectType(extractReturnTypes(node.returns ?? null, docReturns)),
      io: inferDirectIO(node, codeBody.split('\n')),
      _callsByName: Array.from(called),
      testCode: '',
      testable: false,
      owner: ''
    };
  });

  const calls: PlannerCall[] = [];
  const callsByFrom: Record<string, string[]> = {};
  for (const func of functions) {
    callsByFrom[func.key] = [];
    for (const calleeName of func._callsByName || []) {
      const to = nameToKey.get(calleeName);
      if (to == null) {
        continue;
      }
      calls.push({ from: func.key, to });
      callsByFrom[func.key].push(to);
    }
    delete func._callsByName;
  }

  inferIndirectIO(functions, callsByFrom);

  const model: PlannerModel = {
    documentation: description,
    authors,
    globalCode,
    testDocumentation: '',
    testGlobalCode: '',
    functions,
    calls
  };

  if (options.tests?.trim()) {
    applyPythonTestsToModel(model, options.tests);
  }

  return model;
}

function extractModuleAuthorsAndDescription(docstring: string): {
  authors: string[];
  description: string;
} {
  if (!docstring) {
    return { authors: [], description: '' };
  }
  const authors: string[] = [];
  const descLines: string[] = [];
  for (const line of docstring.split('\n')) {
    const authorMatch = line.match(
      /^\s*(?:by|authors?|teammates?|teammate names?|names?|contributors?)\s*:?\s*(.+)\s*$/i
    );
    if (authorMatch) {
      authors.push(...splitAuthorNames(authorMatch[1]));
    } else {
      descLines.push(line);
    }
  }
  return {
    authors: Array.from(new Set(authors)),
    description: descLines.join('\n').trim()
  };
}

function splitAuthorNames(authorsText: string): string[] {
  if (authorsText.trim() === 'TODO' || authorsText.trim().startsWith('TODO:')) {
    return [];
  }
  return authorsText
    .replace(/\s+and\s+/gi, ',')
    .replace(/\s*&\s*/g, ',')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

function computeNodeEndLines(ast: Module, sourceLines: string[]): Map<StmtNode, number> {
  const sortedTopLevel = [...(ast.body || [])].sort((a, b) => a.lineno - b.lineno);
  const nodeEndLine = new Map<StmtNode, number>();
  for (let i = 0; i < sortedTopLevel.length; i++) {
    const endLine =
      i + 1 < sortedTopLevel.length ? sortedTopLevel[i + 1].lineno : sourceLines.length + 1;
    nodeEndLine.set(sortedTopLevel[i], endLine);
  }
  return nodeEndLine;
}

function extractGlobalCode(
  ast: Module,
  sourceLines: string[],
  nodeEndLine: Map<StmtNode, number>
): string {
  const extractNodeSource = (node: StmtNode) => {
    const endLine = nodeEndLine.get(node) ?? sourceLines.length + 1;
    const lines = sourceLines.slice(node.lineno - 1, endLine - 1);
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines.pop();
    }
    return lines.join('\n');
  };
  const globalStatements = (ast.body || []).filter(
    (node) =>
      node.nodeType !== 'FunctionDef' &&
      node.nodeType !== 'AsyncFunctionDef' &&
      node.nodeType !== 'ClassDef' &&
      !isDocstringExpr(node) &&
      !isMainGuard(node)
  );
  return globalStatements.map(extractNodeSource).join('\n').trim();
}

function getFunctionCode(funcNode: FunctionDef, sourceLines: string[], funcEndLine: number): string {
  const body = funcNode.body || [];
  if (isTrivialFunctionBody(body)) {
    return '';
  }
  const firstNonDoc = body.find((stmt) => !isDocstringExpr(stmt));
  if (!firstNonDoc) {
    return '';
  }

  const firstSourceLine = sourceLines[firstNonDoc.lineno - 1] || '';
  const indent = (firstSourceLine.match(/^(\s*)/) || ['', ''])[1].length;

  let startLine = firstNonDoc.lineno;
  let scanLine = firstNonDoc.lineno - 1;
  while (scanLine > funcNode.lineno) {
    const srcLine = sourceLines[scanLine - 1] || '';
    const trimmed = srcLine.trim();
    const lineIndent = (srcLine.match(/^(\s*)/) || ['', ''])[1].length;
    if ((trimmed === '' || trimmed.startsWith('#')) && lineIndent >= indent) {
      startLine = scanLine;
    } else {
      break;
    }
    scanLine--;
  }

  const lines = sourceLines.slice(startLine - 1, funcEndLine - 1);
  const deindented = lines.map((line) => (line.trim() === '' ? '' : line.slice(indent)));
  return deindented.join('\n').trim();
}

function parseDocstringParts(docstring: string): ParsedDocstring {
  if (!docstring) {
    return {
      desc: '',
      docParams: new Map(),
      docReturns: []
    };
  }

  const normalized = deindentLines(docstring.split('\n')).join('\n').trim();
  const lines = normalized.split('\n');

  if (/^\s*[:@](param\s|type\s|return\s*:|rtype\s*:)/m.test(normalized)) {
    return parseSphinxDocstring(lines);
  }
  if (/^\s*(Parameters|Returns)\s*\n[-=]+\s*\n/m.test(normalized)) {
    return parseNumpyDocstring(lines);
  }
  if (/^\s*(Args|Arguments|Parameters|Params|Returns)\s*:\s*$/m.test(normalized)) {
    return parseGoogleDocstring(lines);
  }
  return {
    desc: normalized,
    docParams: new Map(),
    docReturns: []
  };
}

function deindentLines(lines: string[]): string[] {
  const nonEmptyLines = lines.filter((line) => line.trim() !== '');
  if (nonEmptyLines.length === 0) {
    return lines;
  }
  const forIndent = [...nonEmptyLines];
  if (!/^\s/.test(forIndent[0])) {
    forIndent.shift();
  }
  if (forIndent.length === 0) {
    return lines;
  }
  const indent = Math.min(
    ...forIndent.map((line) => (line.match(/^(\s*)/) || ['', ''])[1].length)
  );
  return lines.map((line) => (line.startsWith(' '.repeat(indent)) ? line.slice(indent) : line));
}

function cleanupDescMap(params: Map<string, DocParam>): Map<string, DocParam> {
  for (const param of params.values()) {
    if (param.desc === 'TODO' || (param.desc && param.desc.startsWith('TODO:'))) {
      param.desc = '';
    }
  }
  return params;
}

function cleanupDescList(items: DocReturn[]): DocReturn[] {
  for (const item of items) {
    if (item.desc === 'TODO' || (item.desc && item.desc.startsWith('TODO:'))) {
      item.desc = '';
    }
  }
  return items;
}

function removeObjectType(returns: ReturnEntry[]): ReturnEntry[] {
  for (const ret of returns) {
    if (ret.type === 'object') {
      ret.type = '';
    }
  }
  return returns;
}

function parseSphinxDocstring(lines: string[]): ParsedDocstring {
  const descLines: string[] = [];
  const params = new Map<string, DocParam>();
  const returns: DocReturn[] = [];

  let key: 'type' | 'desc' | null = null;
  let currentParam: DocParam | null = null;
  let currentReturn: DocReturn | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    let result: RegExpMatchArray | null;
    if (trimmed === '') {
      if (currentParam != null || currentReturn != null) {
        currentParam = null;
        currentReturn = null;
      } else {
        descLines.push(line.trimEnd());
      }
    } else if (
      (result = trimmed.match(/^[:@](param|type)\s+([*]{0,2}[A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/))
    ) {
      key = result[1] === 'type' ? 'type' : 'desc';
      currentParam = {};
      params.set(result[2].replace(/^\*+/, ''), currentParam);
      currentParam[key] = result[3].trim();
      currentReturn = null;
    } else if ((result = trimmed.match(/^[:@](return|rtype)\s*:\s*(.*)$/))) {
      key = result[1] === 'rtype' ? 'type' : 'desc';
      currentReturn = {};
      returns.push(currentReturn);
      currentReturn[key] = result[2].trim();
      currentParam = null;
    } else if (currentParam && key) {
      currentParam[key] = `${currentParam[key] || ''} ${trimmed}`.trim();
    } else if (currentReturn && key) {
      currentReturn[key] = `${currentReturn[key] || ''} ${trimmed}`.trim();
    } else {
      descLines.push(line.trimEnd());
    }
  }

  return {
    desc: descLines.join('\n'),
    docParams: cleanupDescMap(params),
    docReturns: cleanupDescList(returns)
  };
}

function parseNumpyDocstring(lines: string[]): ParsedDocstring {
  const descLines: string[] = [];
  const params = new Map<string, DocParam>();
  const returns: DocReturn[] = [];

  let skipNext = false;
  let section = '';
  let currentParam: DocParam | null = null;
  let currentReturn: DocReturn | null = null;

  for (const [index, line] of lines.entries()) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    const trimmed = line.trimEnd();
    let result: RegExpMatchArray | null;
    if (trimmed === '') {
      if (currentParam != null || currentReturn != null) {
        currentParam = null;
        currentReturn = null;
      } else if (section !== '') {
        section = '';
      } else {
        descLines.push(trimmed);
      }
    } else if (index + 1 < lines.length && /^[=-]{3,}$/.test(lines[index + 1].trimEnd())) {
      if (trimmed === 'Parameters' || trimmed === 'Returns') {
        section = trimmed.toLowerCase();
        skipNext = true;
      } else {
        section = '';
        descLines.push(trimmed);
      }
      currentParam = null;
      currentReturn = null;
    } else if (section === 'parameters') {
      if ((result = line.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*(.+))?\s*$/))) {
        currentParam = { type: result[2] ? result[2].trim() : '', desc: '' };
        params.set(result[1], currentParam);
      } else if (currentParam) {
        currentParam.desc = `${currentParam.desc || ''} ${trimmed.trim()}`.trim();
      }
    } else if (section === 'returns') {
      // Optional name: type, or bare type
      if ((result = line.match(/^(?:([A-Za-z_][A-Za-z0-9_]*)\s*:\s*)?(.+)\s*$/))) {
        currentReturn = { type: (result[2] || '').trim(), desc: '' };
        returns.push(currentReturn);
      } else if (currentReturn) {
        currentReturn.desc = `${currentReturn.desc || ''} ${trimmed.trim()}`.trim();
      }
    } else {
      descLines.push(trimmed);
    }
  }

  return {
    desc: descLines.join('\n'),
    docParams: cleanupDescMap(params),
    docReturns: cleanupDescList(returns)
  };
}

function parseGoogleDocstring(lines: string[]): ParsedDocstring {
  const descLines: string[] = [];
  const params = new Map<string, DocParam>();
  const returns: DocReturn[] = [];

  let section = '';
  let currentParam: DocParam | null = null;
  let currentReturn: DocReturn | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    let result: RegExpMatchArray | null;
    if (trimmed === '') {
      if (currentParam != null || currentReturn != null) {
        currentParam = null;
        currentReturn = null;
      } else if (section !== '') {
        section = '';
      } else {
        descLines.push(line.trimEnd());
      }
    } else if (/^(Args|Arguments|Params|Parameters)\s*:$/.test(trimmed)) {
      section = 'params';
      currentParam = null;
      currentReturn = null;
    } else if (/^Returns\s*:$/.test(trimmed)) {
      section = 'returns';
      currentParam = null;
      currentReturn = null;
    } else if (section === 'params') {
      if ((result = trimmed.match(/^([A-Za-z_]+)(\s+\([^)]+\))?\s*:\s*(.+)$/))) {
        currentParam = {
          desc: result[3].trim(),
          type: result[2] ? result[2].trim().replace(/^\(|\)$/g, '') : ''
        };
        params.set(result[1], currentParam);
      } else if (currentParam) {
        currentParam.desc = `${currentParam.desc || ''} ${trimmed}`.trim();
      }
    } else if (section === 'returns') {
      if ((result = trimmed.match(/^([^:]+)\s*:\s*(.+)$/))) {
        currentReturn = { desc: result[2].trim(), type: result[1].trim() };
        returns.push(currentReturn);
      } else if (currentReturn) {
        currentReturn.desc = `${currentReturn.desc || ''} ${trimmed}`.trim();
      } else {
        currentReturn = { desc: trimmed, type: '' };
        returns.push(currentReturn);
      }
    } else {
      descLines.push(line.trimEnd());
    }
  }

  return {
    desc: descLines.join('\n'),
    docParams: cleanupDescMap(params),
    docReturns: cleanupDescList(returns)
  };
}

function inferDirectIO(funcNode: FunctionDef, funcSourceLines: string[]): string {
  let hasInput = false;
  let hasOutput = false;
  let hasValidationStructure = false;

  for (const node of walk(funcNode)) {
    if (node.nodeType === 'Call' && node.func?.nodeType === 'Name') {
      if (node.func.id === 'input') {
        hasInput = true;
      }
      if (node.func.id === 'print') {
        hasOutput = true;
      }
    }
    if (node.nodeType === 'Try' || node.nodeType === 'While') {
      hasValidationStructure = true;
    }
  }

  for (const line of funcSourceLines || []) {
    const trimmed = line.trim();
    if (/#\s*Has direct user input that requires validation/i.test(trimmed)) {
      hasInput = true;
      hasValidationStructure = true;
      break;
    }
    if (/#\s*Has direct user input/i.test(trimmed)) {
      hasInput = true;
    } else if (/#\s*Has direct user output/i.test(trimmed)) {
      hasOutput = true;
    }
  }

  return hasInput
    ? hasValidationStructure
      ? 'validation'
      : 'input'
    : hasOutput
      ? 'output'
      : 'none';
}

function inferIndirectIO(
  functions: FunctionBuild[],
  callsByFrom: Record<string, string[]>
): void {
  const direct = Object.fromEntries(functions.map((func) => [func.key, func.io]));
  const memo: Record<string, boolean> = {};
  const hasIOPath = (key: string, seen = new Set<string>()): boolean => {
    if (seen.has(key)) {
      return false;
    }
    if (!['none', 'indirect'].includes(direct[key] || 'none')) {
      return true;
    }
    if (memo[key] !== undefined) {
      return memo[key];
    }
    seen.add(key);
    const result = (callsByFrom[key] || []).some((to) => hasIOPath(to, seen));
    seen.delete(key);
    memo[key] = result;
    return result;
  };

  for (const func of functions) {
    if ((direct[func.key] || 'none') === 'none' && hasIOPath(func.key)) {
      func.io = 'indirect';
    }
  }
}

function isTrivialFunctionBody(body: StmtNode[]): boolean {
  const statements = (body || []).filter((stmt) => !isDocstringExpr(stmt));
  if (statements.length === 0) {
    return true;
  }
  return statements.every((stmt) => stmt.nodeType === 'Pass' || isDummyReturn(stmt));
}

function isDocstringExpr(stmt: StmtNode | ASTNode | null | undefined): boolean {
  if (!stmt || stmt.nodeType !== 'Expr') {
    return false;
  }
  const value = (stmt as { value?: ExprNode }).value;
  return value?.nodeType === 'Constant' && typeof value.value === 'string';
}

function isDummyReturn(stmt: StmtNode): boolean {
  return stmt.nodeType === 'Return' && isConstantExpression(stmt.value ?? null);
}

function isConstantExpression(node: ExprNode | null | undefined): boolean {
  if (!node) {
    return true;
  }
  if (node.nodeType === 'Constant') {
    return true;
  }
  if (node.nodeType === 'Tuple' || node.nodeType === 'List' || node.nodeType === 'Set') {
    return (node.elts || []).every(isConstantExpression);
  }
  if (node.nodeType === 'Dict') {
    const keys = node.keys || [];
    const values = node.values || [];
    return (
      keys.every((k) => k == null || isConstantExpression(k)) &&
      values.every(isConstantExpression)
    );
  }
  return false;
}

function isMainGuard(stmt: StmtNode): boolean {
  if (stmt.nodeType !== 'If') {
    return false;
  }
  const test = stmt.test;
  if (test?.nodeType !== 'Compare') {
    return false;
  }
  const left = test.left;
  const comparator = (test.comparators || [])[0];
  const op = (test.ops || [])[0];
  return (
    op?.nodeType === 'Eq' &&
    left?.nodeType === 'Name' &&
    left.id === '__name__' &&
    comparator?.nodeType === 'Constant' &&
    comparator.value === '__main__'
  );
}

function extractParamTypes(args: Arg[], docParams: Map<string, DocParam>): ParamEntry[] {
  return args.map((arg) => ({
    name: arg.arg,
    type: getType(arg.annotation ?? null, docParams.get(arg.arg)?.type),
    desc: docParams.get(arg.arg)?.desc || ''
  }));
}

function isEllipsisConstant(elt: ExprNode): boolean {
  return elt.nodeType === 'Constant' && elt.value === '...';
}

function isNoneReturnAnnotation(node: ExprNode): boolean {
  // `-> None` parses as Constant(value=null)
  return node.nodeType === 'Constant' && node.value === null;
}

function isNoneTypeString(type: string): boolean {
  const t = type.trim().toLowerCase();
  return t === '' || t === 'none';
}

function extractReturnTypes(
  returnNode: ExprNode | null,
  docReturns: DocReturn[]
): ReturnEntry[] {
  if (returnNode && isNoneReturnAnnotation(returnNode)) {
    return [];
  }
  if (!returnNode) {
    return docReturns
      .map((r) => ({
        type: parseWrittenType(r.type || ''),
        desc: r.desc || ''
      }))
      .filter((r) => !isNoneTypeString(r.type));
  }
  if (
    returnNode.nodeType === 'Subscript' &&
    returnNode.value?.nodeType === 'Name' &&
    returnNode.value.id === 'tuple'
  ) {
    const slice = returnNode.slice;
    const elements: ExprNode[] =
      slice?.nodeType === 'Tuple'
        ? slice.elts || []
        : slice
          ? [slice]
          : [];
    if (
      elements.every(
        (elt) => elt.nodeType !== 'Starred' && (elt.nodeType !== 'Constant' || !isEllipsisConstant(elt))
      ) &&
      (docReturns.length !== 1 || elements.length === 1)
    ) {
      return elements.map((elt, index) => ({
        type: annotationToType(elt),
        desc: docReturns[index]?.desc || ''
      }));
    }
  }
  const type = annotationToType(returnNode);
  if (isNoneTypeString(type)) {
    return [];
  }
  return [
    {
      type,
      desc: docReturns[0]?.desc || ''
    }
  ];
}

function getType(annotation: ExprNode | null, docType: string | undefined): string {
  if (annotation) {
    return annotationToType(annotation);
  }
  if (docType) {
    return parseWrittenType(docType);
  }
  return '';
}

function parseWrittenType(typeStr: string): string {
  // TODO: optionally run through the UI type parser; treat as raw annotation for now
  return normalizeString(typeStr);
}

function annotationToType(annotation: ExprNode | null | undefined): string {
  if (!annotation) {
    return '';
  }
  try {
    return normalizeString(unparse(annotation));
  } catch {
    return '';
  }
}

function normalizeString(text: string): string {
  return removeOuterParens(text.trim().replace(/\s+/g, ' '));
}

function removeOuterParens(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    const [part, rest] = splitOnMatchingParen(trimmed);
    if (rest === '') {
      return part ?? trimmed;
    }
  }
  return trimmed;
}

function splitOnMatchingParen(str: string): [string | null, string] {
  const stack: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === '(') {
      stack.push(i);
    } else if (char === ')') {
      const matchIndex = stack.pop();
      if (matchIndex === 0) {
        return [str.slice(1, i).trim(), str.slice(i + 1).trim()];
      }
    }
  }
  return [null, str];
}
