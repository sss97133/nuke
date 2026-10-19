import { describe, expect, it } from 'vitest';
import { LAYER_ORDER, toLayers, type ScoreboardRow } from './harnessScoreboard';

const AT = '2026-10-14T23:00:00Z';
const rows: ScoreboardRow[] = [
  { layer: 'outcome', measure: 'segments measured as cut', numerator: 0, denominator: 638, grain: 'segments' },
  { layer: 'key', measure: 'wire ends keyed to a cavity', numerator: 344, denominator: 884, grain: 'wire ends' },
  { layer: 'key', measure: 'wire ends keyed to a crimp tool', numerator: 403, denominator: 884, grain: 'wire ends' },
  { layer: 'fold', measure: 'nets that join a supply to ground (must be 0)', numerator: 0, denominator: 400, grain: 'nets' },
  { layer: 'mystery', measure: 'something new', numerator: 1, denominator: 2, grain: null },
];

describe('toLayers', () => {
  const layers = toLayers(rows, AT);

  it('orders layers as the stack runs, unknown layers last', () => {
    expect(layers.map(l => l.layer)).toEqual(['key', 'fold', 'outcome', 'mystery']);
    expect(LAYER_ORDER.indexOf('key')).toBeLessThan(LAYER_ORDER.indexOf('outcome'));
  });

  it('keeps every number with its denominator and grain, never a percentage', () => {
    const cavity = layers[0].items.find(m => m.label === 'wire ends keyed to a cavity')!;
    expect(cavity.value).toBe(344);
    expect(cavity.unit).toBe('wire ends');
    expect(cavity.coverage).toEqual({ n: 344, of: 884, grain: 'wire ends', as_of: AT });
    expect(cavity.rank).toBeNull();
    for (const l of layers) for (const m of l.items) expect(m.unit).not.toBe('%');
  });

  it('states each layer\'s coverage as measures with data', () => {
    expect(layers[0].coverage).toEqual({ n: 2, of: 2, grain: 'measures with data', as_of: AT });
    expect(layers.find(l => l.layer === 'outcome')!.coverage.n).toBe(0);
  });

  it('does not drop a row that names no grain', () => {
    const m = layers.find(l => l.layer === 'mystery')!.items[0];
    expect(m.unit).toBe('members');
    expect(m.coverage.grain).toBe('members');
  });

  it('returns no layers for a vehicle without a harness model', () => {
    expect(toLayers([], AT)).toEqual([]);
  });
});
