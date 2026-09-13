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

  it('keeps # Calls and IO markers on trivial stub bodies (export roundtrip)', () => {
    const model = pythonCodeToModel(`
def helper(x: int) -> int:
    # TODO: implement this function
    return 0

def main() -> None:
    # TODO: implement this function
    # Calls helper()
    # Has direct user output
    pass

if __name__ == "__main__":
    main()
`);
    expect(model.calls).toEqual([{ from: '1', to: '0' }]);
    expect(model.functions[1].io).toBe('output');
  });

  it('records Attribute callees when the attr matches a top-level function', () => {
    const model = pythonCodeToModel(`
def helper():
    return 1

def main():
    return mod.helper()
`);
    expect(model.calls).toEqual([{ from: '1', to: '0' }]);
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

  it('keeps NumPy return descriptions (default export style)', () => {
    const model = pythonCodeToModel(`
def helper(x: int) -> int:
    """Double x.

    Parameters
    ----------
    x : int
        value to double

    Returns
    -------
    int
        doubled value
    """
    return 0
`);
    expect(model.functions[0].params).toEqual([
      expect.objectContaining({ name: 'x', type: 'int', desc: 'value to double' })
    ]);
    expect(model.functions[0].returns).toEqual([
      expect.objectContaining({ type: 'int', desc: 'doubled value' })
    ]);
  });

  it('keeps NumPy descriptions for each tuple return', () => {
    const model = pythonCodeToModel(`
def split(s: str) -> tuple[str, str]:
    """Split.

    Returns
    -------
    str
        left half
    str
        right half
    """
    return s, s
`);
    expect(model.functions[0].returns).toEqual([
      expect.objectContaining({ type: 'str', desc: 'left half' }),
      expect.objectContaining({ type: 'str', desc: 'right half' })
    ]);
  });

  it('merges Sphinx :return: and :rtype: (and param/type)', () => {
    const model = pythonCodeToModel(`
def helper(x):
    """Double x.

    :param x: value to double
    :type x: int
    :return: doubled value
    :rtype: int
    """
    return x * 2
`);
    expect(model.functions[0].params).toEqual([
      expect.objectContaining({ name: 'x', type: 'int', desc: 'value to double' })
    ]);
    expect(model.functions[0].returns).toEqual([
      expect.objectContaining({ type: 'int', desc: 'doubled value' })
    ]);
  });
});
