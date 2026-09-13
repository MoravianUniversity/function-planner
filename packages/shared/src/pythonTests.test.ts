import { describe, expect, it } from 'vitest';
import { pythonCodeToModel } from './pythonImport.js';
import { applyPythonTestsToModel } from './pythonTests.js';
import type { PlannerModel } from './solutionMerge.js';

describe('applyPythonTestsToModel', () => {
  const baseModel = (): PlannerModel =>
    pythonCodeToModel(`
def helper(x: int) -> int:
    return x * 2

def helper_extra(x: int) -> int:
    return x

def main() -> None:
    helper(1)
`);

  it('marks testable from test_<name> defs (longest name wins)', () => {
    const model = baseModel();
    applyPythonTestsToModel(
      model,
      `
import pytest
import demo

def test_helper():
    assert demo.helper(2) == 4

def test_helper_extra_edge():
    assert demo.helper_extra(1) == 1
`
    );
    const byName = Object.fromEntries(model.functions.map((f) => [f.name, f]));
    expect(byName.helper?.testable).toBe(true);
    expect(byName.helper_extra?.testable).toBe(true);
    expect(byName.main?.testable).toBe(false);
    expect(byName.helper?.testCode).toContain('demo.helper(2)');
  });

  it('marks testable from Attribute calls inside unrelated test names', () => {
    const model = baseModel();
    applyPythonTestsToModel(
      model,
      `
import demo

def test_something_random():
    assert demo.main() is None
`
    );
    const byName = Object.fromEntries(model.functions.map((f) => [f.name, f]));
    expect(byName.main?.testable).toBe(true);
    expect(byName.helper?.testable).toBe(false);
  });

  it('is available via pythonCodeToModel options.tests', () => {
    const model = pythonCodeToModel(
      `
def helper(x: int) -> int:
    return x
`,
      {
        tests: `
def test_helper():
    assert helper(1) == 1
`
      }
    );
    expect(model.functions[0].testable).toBe(true);
  });
});
