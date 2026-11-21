import { describe, expect, it } from 'vitest';
import { analysisLines } from './GarageCardAnalysis';
import type { BuildReconstruction } from '../../pages/vehicle-profile/hooks/useBuildReconstruction';

const build = (totals: Partial<BuildReconstruction['totals']>, amounts_visible = true): BuildReconstruction => ({
  version: 1, as_of: '2026-11-20T10:00:00Z', amounts_visible, rule: 'reader rule', systems_without_paper: [], systems: [],
  totals: { lines: 10, placed_lines: 10, receipts: 3, first_day: '2024-01-05', last_day: '2025-02-01', part_lines: 8,
    paper_work_lines: 2, paper_hours: 4.5, reference_hours: 6, reference_operations: 3, parts_without_reference: 5,
    recorded_amount: 1200, stage_hours: { typical: 20, min: 10, max: 30, stages: 2 }, stage_images: 4, ...totals },
});

describe('garage card analysis lines', () => {
  it('keeps paper, reference and stage hours on their own rows, each cited, never summed', () => {
    const lines = analysisLines({ build: build({}) });
    const byKey = Object.fromEntries(lines.map(line => [line.key, line]));
    expect(byKey['paper-hours'].value).toBe('4.5 h');
    expect(byKey['reference-hours'].value).toBe('6 h');
    expect(byKey['stage-hours'].value).toBe('20 h (10–30)');
    expect(lines.some(line => line.value === '30.5 h' || line.value === '10.5 h')).toBe(false);
    expect(byKey.receipts.cite).toContain('vehicle_build_reconstruction');
    expect(byKey.receipts.cite).toContain('Nov 20, 2026');
    expect(byKey.amount.value).toBe('$1,200');
  });

  it('states an amount only when the reader says amounts are visible', () => {
    expect(analysisLines({ build: build({}, false) }).some(line => line.key === 'amount')).toBe(false);
  });

  it('splits owner-confirmed from inferred work and cites the sessions', () => {
    const lines = analysisLines({ sessions: [
      { session_date: '2026-04-24', duration_minutes: 30, owner_confirmed_at: '2026-04-25T00:00:00Z' },
      { session_date: '2025-10-06', duration_minutes: 120, owner_confirmed_at: null },
      { session_date: '2025-10-08', duration_minutes: null, owner_confirmed_at: null },
    ] });
    expect(lines.map(line => [line.key, line.value])).toEqual([['work-confirmed', '0.5 h'], ['work-inferred', '2 h']]);
    expect(lines[1].cite).toBe('work_sessions · 1 of 2 sessions timed · Oct 6, 2025 – Oct 8, 2025');
  });

  it('leaves out a reader with nothing to say, and a car with no lines has none', () => {
    expect(analysisLines({ build: build({ lines: 0 }), sessions: [], testimony: { total: 0 }, depth: [], questions: { counts: { questions: 0 } } })).toEqual([]);
  });

  it('dates a family index by its fit and states its verdict and sales', () => {
    const lines = analysisLines({ family: { brand: 'Pontiac', index: {
      verdict: 'flat', change: 0.01, lo: -0.03, hi: 0.04, nPrior: 40, nLast: 35, periodKind: 'quarter', series: [], segments: [],
      rawChange: null, pairs: null, repeatChange: null, fittedAt: '2026-10-01T00:00:00Z', stale: true } } });
    expect(lines[0].value).toBe('Flat: within ±4% in 12 months');
    expect(lines[0].cite).toContain('75 sales in the two years');
    expect(lines[0].cite).toContain('fitted Oct 1, 2026');
  });

  it('reads testimony kinds and photo depth with their spans', () => {
    const lines = analysisLines({
      testimony: { total: 12, by_kind: { condition: 9, work_record: 3 }, first_observed: '2020-10-05T12:00:00Z', last_observed: '2026-11-18T00:00:00Z' },
      depth: [{ day: '2025-10-06', photos: 10, seen: 8, placed: 7 }, { day: '2026-11-02', photos: 5, seen: 5, placed: 5 }],
    });
    expect(lines.map(line => line.value)).toEqual(['12 · condition 9 · work record 3', '13 of 15 photos']);
    expect(lines[1].cite).toBe('get_vehicle_day_depth · 2 days · Oct 6, 2025 – Nov 2, 2026');
  });
});
