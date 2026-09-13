import { describe, expect, it } from 'vitest';
import { pythonCodeToModel } from './pythonImport.js';

describe('pythonCodeToModel', () => {
  it('extracts functions, params, returns, and call edges', () => {
    const model = pythonCodeToModel(`
"""Module docs.

Authors: Alice
"""

def helper(x: int) -> int:
    """Double x.

    Args:
        x (int): value
    Returns:
        int: doubled
    """
    return x * 2

def main() -> None:
    helper(1)

if __name__ == "__main__":
    main()
`);
    expect(model.documentation).toContain('Module docs');
    expect(model.authors).toEqual(['Alice']);
    expect(model.functions.map((f) => f.name)).toEqual(['helper', 'main']);
    const helper = model.functions[0];
    expect(helper.params).toEqual([
      expect.objectContaining({ name: 'x', type: 'int' })
    ]);
    expect(helper.returns).toEqual([expect.objectContaining({ type: 'int' })]);
    expect(model.functions[1].returns).toEqual([]);
    expect(model.calls).toEqual([{ from: '1', to: '0' }]);
  });

  it('treats -> None as no returns', () => {
    const model = pythonCodeToModel(`
def noop() -> None:
    pass
`);
    expect(model.functions[0].returns).toEqual([]);
  });

  it('infers IO and indirect IO via the call graph', () => {
    const model = pythonCodeToModel(`
def read_name():
    return input("name")

def greet():
    name = read_name()
    print(name)
`);
    const byName = Object.fromEntries(model.functions.map((f) => [f.name, f]));
    expect(byName.read_name?.io).toBe('input');
    expect(byName.greet?.io).toBe('output');
  });

  it('parses Google-style docstrings for params', () => {
    const model = pythonCodeToModel(`
def add(a, b):
    """Add two numbers.

    Args:
        a (int): first
        b (int): second
    Returns:
        int: sum
    """
    return a + b
`);
    const fn = model.functions[0];
    expect(fn.params).toEqual([
      expect.objectContaining({ name: 'a', type: 'int', desc: 'first' }),
      expect.objectContaining({ name: 'b', type: 'int', desc: 'second' })
    ]);
    expect(fn.returns).toEqual([expect.objectContaining({ type: 'int', desc: 'sum' })]);
  });
});
