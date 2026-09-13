import { describe, expect, it } from 'vitest';
import { checkName, checkPlan } from '../src/planCheck.js';
import type { PlannerModel } from '../src/solutionMerge.js';

describe('checkName', () => {
  it('requires a name', () => {
    expect(checkName('')).toMatchObject({ severity: 'error', field: 'name' });
  });

  it('rejects Python keywords', () => {
    expect(checkName('class')).toMatchObject({ severity: 'error' });
  });

  it('accepts a valid snake_case name', () => {
    expect(checkName('helper_fn')).toBeNull();
  });
});

describe('checkPlan', () => {
  it('flags missing main and documentation', () => {
    const model: PlannerModel = {
      functions: [{ key: '1', name: 'helper', desc: 'A reasonably long description here' }],
      calls: [],
      documentation: '',
      authors: ['Alice']
    };
    const report = checkPlan(model, { externalAuthors: null });
    expect(report.model.some((p) => p.field === 'main')).toBe(true);
    expect(report.model.some((p) => p.field === 'documentation' && p.severity === 'error')).toBe(
      true
    );
    expect(report.functionLinks['1']?.problems.some((p) => p.field === 'callsInto')).toBe(true);
    expect(report.functions['1']?.name).toBe('helper');
    expect(report.functionLinks['1']?.name).toBe('helper');
  });

  it('accepts a minimal valid main + helper call graph', () => {
    const model: PlannerModel = {
      functions: [
        { key: '1', name: 'main', io: 'none' },
        {
          key: '2',
          name: 'helper',
          desc: 'A reasonably long description here',
          params: [{ name: 'x', type: 'int', desc: 'The input value' }],
          returns: [{ type: 'int', desc: 'The output value' }],
          io: 'none'
        }
      ],
      calls: [{ from: '1', to: '2' }],
      documentation: 'Module documentation that is long enough for the checker.',
      authors: ['Alice']
    };
    const report = checkPlan(model, { externalAuthors: null, minFunctions: 1 });
    expect(report.model.filter((p) => p.severity === 'error')).toEqual([]);
    expect(report.functions['1']?.problems.filter((p) => p.severity === 'error') ?? []).toEqual([]);
    expect(report.functions['2']?.problems.filter((p) => p.severity === 'error') ?? []).toEqual([]);
    expect(report.functions['2']?.name).toBe('helper');
    expect(report.functions['2']?.params).toEqual(['x']);
    expect(report.calls['1-2']?.problems ?? []).toEqual([]);
    expect(report.calls['1-2']).toMatchObject({
      from: '1',
      to: '2',
      fromName: 'main',
      toName: 'helper'
    });
  });

  it('warns on recursive cycles', () => {
    const model: PlannerModel = {
      functions: [
        { key: '1', name: 'main', io: 'none' },
        { key: '2', name: 'a', desc: 'Function a description text', io: 'none' },
        { key: '3', name: 'b', desc: 'Function b description text', io: 'none' }
      ],
      calls: [
        { from: '1', to: '2' },
        { from: '2', to: '3' },
        { from: '3', to: '2' }
      ],
      documentation: 'Module documentation that is long enough for the checker.',
      authors: ['Alice']
    };
    const report = checkPlan(model, { callGraphOnly: true });
    expect(report.calls['2-3']?.problems.some((p) => p.message.includes('cycle'))).toBe(true);
  });

  it('skips docs/authors when callGraphOnly', () => {
    const model: PlannerModel = {
      functions: [{ key: '1', name: 'main' }],
      calls: [],
      documentation: '',
      authors: []
    };
    const report = checkPlan(model, { callGraphOnly: true });
    expect(report.model.some((p) => p.field === 'documentation')).toBe(false);
    expect(report.model.some((p) => p.field === 'authors')).toBe(false);
  });
});
