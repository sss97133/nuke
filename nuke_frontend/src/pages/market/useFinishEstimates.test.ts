import { describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
import { decodeFinishAnalogs, decodeFinishBoard, decodeFinishTrack, trackFor, trackSentence } from './useFinishEstimates';

const columns = ['vehicle_id', 'estimate', 'low', 'high', 'grade', 'coverage', 'sentence', 'estimated_at', 'bid_at_estimate', 'comps_through'];
const row = ['v1', 33000, 25500, 45100, 'A', 0.775, '8 in 10 cars like this finished inside this range. Half finished within 15%.',
  '2026-10-15T02:50:00Z', 25000, '2026-09-27'];

describe('reading the finish estimates', () => {
  it('reads each estimate by column name', () => {
    const b = decodeFinishBoard({ fresh: true, writer_at: '2026-10-15T02:50:00Z', columns, rows: [row] });
    expect(b.fresh).toBe(true);
    expect(b.byId.get('v1')).toEqual({ vehicleId: 'v1', estimate: 33000, low: 25500, high: 45100, grade: 'A', coverage: 0.775,
      sentence: row[6], estimatedAt: Date.parse('2026-10-15T02:50:00Z'), bidAtEstimate: 25000, compsThrough: '2026-09-27', model: null });
  });
  it('is not shifted by a reordered payload', () => {
    const order = [...columns].reverse();
    const b = decodeFinishBoard({ fresh: true, columns: order, rows: [[...row].reverse()] });
    expect(b.byId.get('v1')?.estimate).toBe(33000);
    expect(b.byId.get('v1')?.low).toBe(25500);
  });
  it('shows nothing from a stopped writer, and nothing that lacks its range or time', () => {
    expect(decodeFinishBoard({ fresh: false, columns, rows: [row] }).byId.size).toBe(0);
    const bad = [
      ['v2', 33000, null, 45100, 'A', 0.8, null, '2026-10-15T02:50:00Z', 1, null],
      ['v3', 33000, 34000, 45100, 'A', 0.8, null, '2026-10-15T02:50:00Z', 1, null],
      ['v4', 33000, 25500, 45100, 'A', 0.8, null, 'not a time', 1, null],
    ];
    expect([...decodeFinishBoard({ fresh: true, columns, rows: bad }).byId.keys()]).toEqual([]);
    expect(decodeFinishBoard(null).byId.size).toBe(0);
  });
  it('keeps an unknown grade unknown', () => {
    const b = decodeFinishBoard({ fresh: true, columns, rows: [['v5', 10, 5, 20, 'Z', null, null, '2026-10-15T02:50:00Z', null, null]] });
    expect(b.byId.get('v5')?.grade).toBeNull();
  });
  it('links an analog only to a BaT listing, and drops one without a title', () => {
    const raw = { analogs: { v1: [
      { url: 'https://bringatrailer.com/listing/1965-ford-mustang-convertible-55/', title: '1965 Ford Mustang Convertible', closed: '2026-02-22', bid: 25000, final: 38250 },
      { url: 'javascript:alert(1)', title: 'Bad link', closed: null, bid: null, final: null },
      { url: null, title: '', closed: null, bid: 1, final: 2 },
    ] } };
    const a = decodeFinishAnalogs(raw, 'v1');
    expect(a).toHaveLength(2);
    expect(a[0].url).toContain('bringatrailer.com/listing/');
    expect(a[1].url).toBeNull();
    expect(decodeFinishAnalogs(raw, 'other')).toEqual([]);
  });
});

describe('the track record beside an estimate', () => {
  const trackColumns = ['model', 'from_hours', 'to_hours', 'lots', 'inside', 'below', 'above', 'sold', 'median_miss_pct', 'first_close', 'last_close'];
  const raw = { columns: trackColumns, rows: [
    [33, 0, 1, 145, 109, 14, 22, 106, 13.1, '2026-10-16T17:00:00Z', '2026-10-17T19:01:00Z'],
    [33, 24, 72, 555, 448, 53, 54, 408, 16.6, '2026-10-17T17:00:00Z', '2026-10-20T21:08:00Z'],
    [33, 72, null, 1099, 867, 98, 134, 800, 18.4, '2026-10-19T17:00:00Z', '2026-10-24T19:32:00Z'],
    [32, 24, 72, 721, 575, 76, 70, 529, 20.0, '2026-10-16T17:00:00Z', '2026-10-20T21:08:00Z'],
    [33, 6, 24, 0, 0, 0, 0, 0, null, '2026-10-16T17:00:00Z', '2026-10-18T17:49:00Z'],
  ] };
  const track = decodeFinishTrack(raw);
  const at = Date.parse('2026-11-08T12:00:00Z');
  it('reads the graded windows by column name and drops an empty one', () => {
    expect(track).toHaveLength(4);
    expect(decodeFinishTrack({ columns: [...trackColumns].reverse(), rows: raw.rows.map(r => [...r].reverse()) })[1].inside).toBe(448);
    expect(decodeFinishTrack(null)).toEqual([]);
  });
  it('picks the same model, made as far from the close as the estimate was', () => {
    expect(trackFor(track, { model: 33, estimatedAt: at }, at + 30 * 3_600_000)?.lots).toBe(555);
    expect(trackFor(track, { model: 32, estimatedAt: at }, at + 30 * 3_600_000)?.lots).toBe(721);
    expect(trackFor(track, { model: 33, estimatedAt: at }, at + 200 * 3_600_000)?.lots).toBe(1099);
    expect(trackFor(track, { model: 33, estimatedAt: at }, at + 10 * 3_600_000)).toBeNull(); // window with no grades
    expect(trackFor(track, { model: null, estimatedAt: at }, at + 30 * 3_600_000)).toBeNull();
    expect(trackFor(track, { model: 33, estimatedAt: at }, null)).toBeNull();
  });
  it('says it as counts, the median miss and the close dates', () => {
    expect(trackSentence(trackFor(track, { model: 33, estimatedAt: at }, at + 30 * 3_600_000)!))
      .toBe('So far, estimated 1–3 days out: 448 of 555 finished inside the range, half within 17% (lots closed Oct 17–Oct 20).');
    expect(trackSentence(track[2])).toContain('over 3 days out: 867 of 1,099');
  });
});
