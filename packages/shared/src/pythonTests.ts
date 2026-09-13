/**
 * Updates a planner model from a pytest-style tests file.
 *
 * Marks functions as testable when the tests file has:
 * - `def test_<name>` or `def test_<name>_…` (matches the planner's test export), or
 * - a call to that function (Name or Attribute) inside any top-level `test_*` function
 *
 * Also fills `testDocumentation` / `testGlobalCode` from the tests module when present,
 * and `testCode` on a function when an exact `test_<name>` body exists.
 */

import {
  getDocstring,
  parse as parsePythonAst,
  walk,
  type FunctionDef,
  type Module,
  type StmtNode
} from 'py-ast';
import type { PlannerModel } from './solutionMerge.js';

/**
 * Mutates `model` in place based on `testsCode`, and returns it.
 * @throws if the tests source cannot be parsed
 */
export function applyPythonTestsToModel(model: PlannerModel, testsCode: string): PlannerModel {
  if (!testsCode.trim()) {
    return model;
  }

  const ast = parsePythonAst(testsCode) as Module;
  const sourceLines = testsCode.split('\n');
  const nodeEndLine = computeNodeEndLines(ast, sourceLines);

  const knownNames = model.functions
    .map((fn) => (typeof fn.name === 'string' ? fn.name : ''))
    .filter((name) => name.length > 0);
  const knownSet = new Set(knownNames);
  const testable = new Set<string>();
  const exactTestBodies = new Map<string, string>();

  const { description } = extractModuleDescription(getDocstring(ast) || '');
  if (description && !asString(model.testDocumentation).trim()) {
    model.testDocumentation = description;
  }

  const testGlobalCode = extractTestGlobalCode(ast, sourceLines, nodeEndLine);
  if (testGlobalCode && !asString(model.testGlobalCode).trim()) {
    model.testGlobalCode = testGlobalCode;
  }

  const testFunctions = (ast.body || []).filter(
    (node): node is FunctionDef =>
      node.nodeType === 'FunctionDef' && node.name.startsWith('test_')
  );

  for (const node of testFunctions) {
    const fromName = functionNameFromTestDef(node.name, knownNames);
    if (fromName) {
      testable.add(fromName);
      if (node.name === `test_${fromName}` && !exactTestBodies.has(fromName)) {
        exactTestBodies.set(
          fromName,
          getFunctionBody(node, sourceLines, nodeEndLine.get(node) ?? sourceLines.length + 1)
        );
      }
    }

    for (const called of calledFunctionNames(node, knownSet)) {
      testable.add(called);
    }

    for (const commented of commentedTestTargets(node, sourceLines, nodeEndLine, knownSet)) {
      testable.add(commented);
    }
  }

  for (const fn of model.functions) {
    const name = typeof fn.name === 'string' ? fn.name : '';
    if (!name || !testable.has(name)) {
      continue;
    }
    fn.testable = true;
    const body = exactTestBodies.get(name);
    if (body != null && !asString(fn.testCode).trim()) {
      fn.testCode = body;
    }
  }

  return model;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function functionNameFromTestDef(testName: string, knownNames: string[]): string | null {
  if (!testName.startsWith('test_')) {
    return null;
  }
  const rest = testName.slice('test_'.length);
  if (!rest) {
    return null;
  }
  const sorted = [...knownNames].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    if (rest === name || rest.startsWith(`${name}_`)) {
      return name;
    }
  }
  return null;
}

function calledFunctionNames(node: FunctionDef, knownSet: Set<string>): Set<string> {
  const found = new Set<string>();
  for (const child of walk(node)) {
    if (child.nodeType !== 'Call') {
      continue;
    }
    const func = child.func;
    if (func?.nodeType === 'Name' && knownSet.has(func.id)) {
      found.add(func.id);
    } else if (func?.nodeType === 'Attribute' && knownSet.has(func.attr)) {
      found.add(func.attr);
    }
  }
  return found;
}

function commentedTestTargets(
  node: FunctionDef,
  sourceLines: string[],
  nodeEndLine: Map<StmtNode, number>,
  knownSet: Set<string>
): Set<string> {
  const found = new Set<string>();
  const end = nodeEndLine.get(node) ?? sourceLines.length + 1;
  const lines = sourceLines.slice(node.lineno - 1, end - 1);
  for (const line of lines) {
    const match = line
      .trim()
      .match(
        /^\s*#\s*Tests?\s+([A-Za-z_][A-Za-z0-9_]*(\(\))?(?:\s*(,|\s|\sand\s)\s*[A-Za-z_][A-Za-z0-9_]*(\(\))?)*)\s*$/i
      );
    if (!match) {
      continue;
    }
    const names = match[1]
      .replace(/\(\)/g, '')
      .replace(/,/g, ' ')
      .replace(/\s+and\s+/gi, ' ')
      .replace(/\s+/g, ' ')
      .split(' ');
    for (const name of names) {
      if (knownSet.has(name)) {
        found.add(name);
      }
    }
  }
  return found;
}

function extractModuleDescription(docstring: string): { description: string } {
  if (!docstring) {
    return { description: '' };
  }
  const descLines: string[] = [];
  for (const line of docstring.split('\n')) {
    if (/^\s*(?:by|authors?|teammates?|teammate names?|names?|contributors?)\s*:?\s*(.+)\s*$/i.test(line)) {
      continue;
    }
    descLines.push(line);
  }
  return { description: descLines.join('\n').trim() };
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

function isDocstringExpr(stmt: StmtNode): boolean {
  if (stmt.nodeType !== 'Expr') {
    return false;
  }
  const value = (stmt as { value?: { nodeType?: string; value?: unknown } }).value;
  return value?.nodeType === 'Constant' && typeof value.value === 'string';
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

function extractTestGlobalCode(
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

  const globals = (ast.body || []).filter((node) => {
    if (
      node.nodeType === 'FunctionDef' ||
      node.nodeType === 'AsyncFunctionDef' ||
      node.nodeType === 'ClassDef' ||
      isDocstringExpr(node) ||
      isMainGuard(node)
    ) {
      return false;
    }
    // Skip bare imports of pytest / the module under test — keep other globals
    if (node.nodeType === 'Import' || node.nodeType === 'ImportFrom') {
      return false;
    }
    return true;
  });

  return globals.map(extractNodeSource).join('\n').trim();
}

function getFunctionBody(funcNode: FunctionDef, sourceLines: string[], funcEndLine: number): string {
  const body = funcNode.body || [];
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
