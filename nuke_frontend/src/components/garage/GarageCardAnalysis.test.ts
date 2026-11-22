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
    expect(byKey.amount.value).toBe('$1,200');
    expect([byKey.amount.label, byKey.amount.cite]).toEqual(['On 3 receipts', 'Jan 2024 – Feb 2025']);
    expect(byKey.amount.cite).not.toContain('vehicle_build_reconstruction');
    expect(byKey.amount.title).toContain('vehicle_build_reconstruction, as of Nov 20, 2026');
    expect(['paper-hours', 'reference-hours', 'stage-hours'].map(key => byKey[key].group)).toEqual(['hours', 'hours', 'hours']);
  });

  it('states an amount only when the reader says amounts are visible', () => {
    const lines = analysisLines({ build: build({}, false) });
    expect(lines.some(line => line.key === 'amount')).toBe(false);
    expect(lines.find(line => line.key === 'receipts')?.group).toBe('record');
  });

  it('states quoted money beside the receipts, never added to them', () => {
    const quoted = { documents: 1, first_day: '2024-05-01', last_day: '2024-05-01', amount: null, amount_basis: 'options_not_added',
      rule: 'quote rule', quotes: [{ options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }] }] };
    const lines = analysisLines({ build: { ...build({}), quoted } as BuildReconstruction });
    const keys = lines.filter(line => line.group === 'money').map(line => line.key);
    expect(keys).toEqual(['amount', 'quoted']);
    const line = lines.find(l => l.key === 'quoted')!;
    expect([line.label, line.value, line.cite]).toEqual(['Quoted', '3 options', 'May 2024']);
    expect(line.title).toBe('quote rule. vehicle_build_reconstruction, as of Nov 20, 2026');
    expect(lines.find(l => l.key === 'amount')!.value).toBe('$1,200');
  });

  it('states the accepted option, a single quote amount, and only a count for several quotes', () => {
    const accepted = analysisLines({ build: { ...build({ lines: 0 }), quoted: { documents: 1, first_day: '2024-08-15', last_day: '2024-08-15',
      amount: '1800', amount_basis: 'accepted_option', quotes: [{ options: [{}, {}] }] } } as BuildReconstruction });
    expect(accepted.map(l => [l.key, l.value, l.cite])).toEqual([['quoted', '$1,800', 'Aug 2024 · accepted of 2']]);
    const single = analysisLines({ build: { ...build({}), quoted: { documents: 1, first_day: '2024-03-01', last_day: '2024-03-01',
      amount: 800, amount_basis: 'printed_total', quotes: [{ options: [] }] } } as BuildReconstruction });
    expect(single.find(l => l.key === 'quoted')!.value).toBe('$800');
    const several = analysisLines({ build: { ...build({}), quoted: { documents: 2, first_day: '2024-03-01', last_day: '2024-09-01',
      amount: null, amount_basis: 'documents_not_added', quotes: [{ options: [] }, { options: [] }] } } as BuildReconstruction });
    expect(several.find(l => l.key === 'quoted')).toMatchObject({ group: 'money', value: '2 quotes', cite: 'Mar 2024 – Sep 2024' });
  });

  it('shows a visitor the quote count in the record line, with no amount, and nothing when the reader has no quotes', () => {
    const lines = analysisLines({ build: { ...build({}, false), quoted: { documents: 1, first_day: '2024-05-01', last_day: '2024-05-01',
      amount: null, quotes: [{ options: [] }] } } as BuildReconstruction });
    expect(lines.filter(l => l.group === 'record').map(l => [l.key, l.value])).toEqual([['receipts', '3 receipts · Jan 2024 – Feb 2025'],
      ['quoted', '1 quote · May 2024']]);
    expect(analysisLines({ build: build({}) }).some(l => l.key === 'quoted')).toBe(false);
    expect(analysisLines({ build: { ...build({}), quoted: null } as BuildReconstruction }).some(l => l.key === 'quoted')).toBe(false);
  });

  it('splits owner-confirmed from inferred work and cites the sessions', () => {
    const lines = analysisLines({ sessions: [
      { session_date: '2026-04-24', duration_minutes: 30, owner_confirmed_at: '2026-04-25T00:00:00Z' },
      { session_date: '2025-10-06', duration_minutes: 120, owner_confirmed_at: null },
      { session_date: '2025-10-08', duration_minutes: null, owner_confirmed_at: null },
    ] });
    expect(lines.map(line => [line.key, line.value])).toEqual([['work-confirmed', '0.5 h'], ['work-inferred', '2 h']]);
    expect(lines[1].cite).toBe('1 of 2 sessions timed · Oct 6, 2025 – Oct 8, 2025');
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
    expect(lines.map(line => line.value)).toEqual(['12', '13 of 15']);
    expect(lines[0].title).toContain('condition 9 · work record 3');
    expect(lines[1].title).toBe('2 days · Oct 6, 2025 – Nov 2, 2026 · get_vehicle_day_depth');
  });

  it('states the stored class value with its band and comp count, the computed date in the tooltip', () => {
    const [line] = analysisLines({ classPrice: { vehicle_id: 'car', status: 'priced', value: '46200', value_low: '35100',
      value_high: '76850', n: 35, subject_class: 'build', computed_at: '2026-11-21T08:00:00Z',
      basis: 'median of 35 sold comps of the same build class (build) in the 1973 Pontiac Firebird cohort' } });
    expect([line.key, line.label, line.value, line.cite]).toEqual(['class-value', 'Class · 35 comps', '$46,200',
      '$35,100 – $76,850']);
    expect(line.title).toBe('median of 35 sold comps of the same build class (build) in the 1973 Pontiac Firebird cohort. '
      + 'computed Nov 21, 2026. get_vehicle_class_prices');
  });

  it('leaves the line out when the stored price is blocked or absent, never falling back to another estimate', () => {
    expect(analysisLines({ classPrice: { vehicle_id: 'car', status: 'blocked', blocked_reason: 'cohort not yet classified (40 of 6281)',
      computed_at: '2026-11-21T08:00:00Z' } })).toEqual([]);
    expect(analysisLines({ classPrice: null })).toEqual([]);
  });
});
