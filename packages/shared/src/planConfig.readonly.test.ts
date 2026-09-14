import { describe, expect, it } from 'vitest';
import {
  compactFunctionReadOnlyRule,
  normalizeCallReadOnlyFields,
  parseFunctionReadOnly,
  resolveFunctionReadOnly,
  isParamFacetReadOnly,
  isParamStructureReadOnly,
  isReturnFacetReadOnly,
  isFunctionFieldLocked
} from './planConfig.js';
import { mergeBaseIntoSolution, type PlannerModel } from './solutionMerge.js';

describe('normalizeCallReadOnlyFields', () => {
  it('collapses into+outOf to calls', () => {
    expect(normalizeCallReadOnlyFields(['name', 'callsInto', 'callsOutOf'])).toEqual([
      'name',
      'calls'
    ]);
  });

  it('keeps bare calls and strips redundant directions', () => {
    expect(normalizeCallReadOnlyFields(['calls', 'callsInto'])).toEqual(['calls']);
  });
});

describe('parseFunctionReadOnly / compactFunctionReadOnlyRule', () => {
  it('keeps full params lock without paramLock', () => {
    const rules = parseFunctionReadOnly([
      { for: '^helper$', fields: ['params', 'desc'] }
    ]);
    expect(rules).toEqual([{ for: '^helper$', fields: ['params', 'desc'] }]);
  });

  it('keeps partial paramLock and normalizes calls', () => {
    const rules = parseFunctionReadOnly([
      {
        for: '.*',
        fields: ['params', 'callsInto', 'callsOutOf'],
        paramLock: { for: '^n$', facets: ['name', 'type'] }
      }
    ]);
    expect(rules).toEqual([
      {
        for: '.*',
        fields: ['params', 'calls'],
        paramLock: { for: '^n$', facets: ['name', 'type'] }
      }
    ]);
  });

  it('omits full paramLock on compact', () => {
    const rule = compactFunctionReadOnlyRule({
      for: '.*',
      fields: ['params'],
      paramLock: { facets: ['structure', 'name', 'type', 'desc'] }
    });
    expect(rule).toEqual({ for: '.*', fields: ['params'] });
  });
});

describe('resolveFunctionReadOnly', () => {
  it('returns structured policy with full param lock', () => {
    const policy = resolveFunctionReadOnly('helper', [
      { for: '^helper$', fields: ['params', 'name'] }
    ]);
    expect(policy).toEqual({
      fields: ['name'],
      params: [{ for: '.*', facets: ['structure', 'name', 'type', 'desc'] }],
      returns: []
    });
    expect(isFunctionFieldLocked('params', policy)).toBe(true);
    expect(isParamStructureReadOnly(policy)).toBe(true);
  });

  it('applies param facets and for regex', () => {
    const policy = resolveFunctionReadOnly('helper', [
      {
        for: '^helper$',
        fields: ['params'],
        paramLock: { for: '^n$', facets: ['name', 'type'] }
      }
    ]);
    expect(isParamStructureReadOnly(policy)).toBe(false);
    expect(isParamFacetReadOnly(policy, 'n', 'name')).toBe(true);
    expect(isParamFacetReadOnly(policy, 'n', 'type')).toBe(true);
    expect(isParamFacetReadOnly(policy, 'n', 'desc')).toBe(false);
    expect(isParamFacetReadOnly(policy, 'count', 'name')).toBe(false);
  });

  it('resolves return facets', () => {
    const policy = resolveFunctionReadOnly('main', [
      { for: '^main$', fields: ['returns'], returnLock: { facets: ['structure', 'type'] } }
    ]);
    expect(isReturnFacetReadOnly(policy, 'type')).toBe(true);
    expect(isReturnFacetReadOnly(policy, 'desc')).toBe(false);
  });
});

describe('mergeBaseIntoSolution param/return facets', () => {
  const base: PlannerModel = {
    functions: [
      {
        key: '1',
        name: 'helper',
        params: [
          { name: 'n', type: 'int', desc: 'base n' },
          { name: 'label', type: 'str', desc: 'base label' }
        ],
        returns: [{ type: 'bool', desc: 'base ret' }],
        desc: 'base desc'
      }
    ],
    calls: []
  };

  const solution: PlannerModel = {
    functions: [
      {
        key: '1',
        name: 'helper',
        params: [
          { name: 'n', type: 'float', desc: 'student n' },
          { name: 'label', type: 'str', desc: 'student label' },
          { name: 'extra', type: 'int', desc: 'extra' }
        ],
        returns: [{ type: 'str', desc: 'student ret' }],
        desc: 'student desc'
      }
    ],
    calls: [{ from: '1', to: '1' }]
  };

  it('locks name+type for matching params but keeps student desc and list shape', () => {
    const merged = mergeBaseIntoSolution(base, solution, {
      moduleReadOnly: false,
      functionReadOnly: [
        {
          for: '^helper$',
          fields: ['params'],
          paramLock: { for: '^n$', facets: ['name', 'type'] }
        }
      ]
    });
    const fn = merged.functions[0];
    expect(fn.params).toEqual([
      { name: 'n', type: 'int', desc: 'student n' },
      { name: 'label', type: 'str', desc: 'student label' },
      { name: 'extra', type: 'int', desc: 'extra' }
    ]);
    expect(fn.desc).toBe('student desc');
    expect(merged.calls).toEqual(base.calls);
  });

  it('structure lock restores base arity and order', () => {
    const merged = mergeBaseIntoSolution(base, solution, {
      moduleReadOnly: false,
      functionReadOnly: [
        {
          for: '^helper$',
          fields: ['params'],
          paramLock: { facets: ['structure'] }
        }
      ]
    });
    const fn = merged.functions[0];
    expect(fn.params).toHaveLength(2);
    expect((fn.params as { name: string }[]).map((p) => p.name)).toEqual(['n', 'label']);
    expect((fn.params as { desc: string }[])[0].desc).toBe('student n');
  });

  it('return type lock keeps student desc', () => {
    const merged = mergeBaseIntoSolution(base, solution, {
      moduleReadOnly: false,
      functionReadOnly: [
        {
          for: '^helper$',
          fields: ['returns'],
          returnLock: { facets: ['type'] }
        }
      ]
    });
    expect(merged.functions[0].returns).toEqual([{ type: 'bool', desc: 'student ret' }]);
  });
});
