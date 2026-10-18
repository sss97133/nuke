import { describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
import { activityRows, weigh, type ActivityReceipt } from './useLotMovement';
import { sourceReadClock } from '../../../../supabase/functions/extract-bat-core/sourceReadClock';

const AS_OF = '2026-10-04T12:00:00Z';
function receipt(): ActivityReceipt {
  return { as_of: AS_OF, max_lots: 8, per_lot_limit: 40, input_truncated: false, eligible_lots: 2,
    scope: 'posted interactions', lots: [
      { vehicle_id: 'a', source_url: 'https://bringatrailer.com/listing/a/', source_read_at: '2026-10-03T12:00:00Z',
        source_read_basis: 'cached_snapshot', activity_rows: 2, has_more: false,
        activity: [
          { vehicle_id: 'a', posted_at: '2026-10-04T11:59:00Z', comment_type: 'bid', bid_amount: 1100, sequence_number: 2 },
          { vehicle_id: 'a', posted_at: '2026-10-04T11:58:00Z', comment_type: 'bid', bid_amount: 1000, sequence_number: 1 },
        ] },
      { vehicle_id: 'b', source_url: 'https://bringatrailer.com/listing/b/', source_read_at: null,
        source_read_basis: 'unknown', activity_rows: 1, has_more: true,
        activity: [{ vehicle_id: 'b', posted_at: '2026-10-04T11:57:00Z', comment_type: 'question', bid_amount: null, sequence_number: 4 }] },
    ] };
}

describe('existing minute-refresh activity reader receipt', () => {
  it('keeps row compatibility and distinct per-lot coverage/source clocks', () => {
    const rows = activityRows(receipt());
    expect(rows).toHaveLength(3);
    const result = weigh(rows, new Map(), Date.parse(AS_OF) + 2 * 3600_000);
    expect(result.get('a')).toMatchObject({ lastHour: 2, lastHourFloor: false, sourceReadBasis: 'cached_snapshot',
      sourceReadAt: Date.parse('2026-10-03T12:00:00Z'), readAsOf: Date.parse(AS_OF), steps: 1, medianStep: null });
    expect(result.get('b')).toMatchObject({ lastHour: 1, lastHourFloor: true, sourceReadAt: null, sourceReadBasis: 'unknown' });
    expect(result.get('a')?.items[0]).toMatchObject({ amount: 1100, step: 100 });
  });
  it('does not turn a complete 40-row window or another lot truncation into an incomplete hour', () => {
    const r = receipt();
    r.lots[0].activity = Array.from({ length: 40 }, (_, i) => ({ vehicle_id: 'a', posted_at: '2026-10-04T11:59:00Z',
      comment_type: 'observation', bid_amount: null, sequence_number: i + 1 }));
    expect(weigh(activityRows(r), new Map(), Date.parse(AS_OF)).get('a')?.lastHourFloor).toBe(false);
    expect(weigh(activityRows(r), new Map(), Date.parse(AS_OF)).get('b')?.lastHourFloor).toBe(true);
  });
  it('keeps empty captured activity empty without inventing a bid', () => {
    const r = receipt(); r.lots.forEach(l => { l.activity = []; l.activity_rows = 0; l.has_more = false; });
    expect(activityRows(r)).toEqual([]);
    expect(weigh(activityRows(r), new Map(), Date.parse(AS_OF)).size).toBe(0);
    expect(r.eligible_lots).toBe(2);
  });
});

describe('actual extraction source clock', () => {
  it('binds a positive live source bid to its direct or cached page read without changing legacy clocks', () => {
    expect(sourceReadClock('direct', AS_OF, 1100).source_read).toMatchObject({
      at: '2026-10-04T12:00:00.000Z', basis: 'direct_fetch', bid_amount_version: 1, bid_amount: 1100, bid_currency: null,
    });
    expect(sourceReadClock('snapshot', '2024-01-02T15:14:13Z', 1000).source_read).toMatchObject({
      at: '2024-01-02T15:14:13.000Z', basis: 'cached_snapshot', bid_amount: 1000,
    });
    expect(sourceReadClock('direct', AS_OF).source_read).not.toHaveProperty('bid_amount');
  });
  it('leaves missing, zero, invalid amounts and unknown read clocks unproved', () => {
    for (const bid of [null, 0, -1, Infinity, NaN]) expect(sourceReadClock('direct', AS_OF, bid).source_read.bid_amount).toBeNull();
    expect(sourceReadClock('snapshot', null, 1100).source_read).toMatchObject({ at: null, basis: 'unknown', bid_amount: null });
  });
  it('advances repeated direct reads with response clocks', () => {
    expect(sourceReadClock('direct', AS_OF).source_read).toMatchObject({ at: '2026-10-04T12:00:00.000Z', basis: 'direct_fetch' });
    expect(sourceReadClock('direct', '2026-10-04T12:01:00Z').scraped_at).toBe('2026-10-04T12:01:00.000Z');
  });
  it('replays cached pages at their original source read time', () => {
    const clock = sourceReadClock('snapshot', '2024-01-02T15:14:13Z');
    expect(clock).toEqual(sourceReadClock('snapshot', '2024-01-02T15:14:13Z'));
    expect(clock.source_read).toMatchObject({ basis: 'cached_snapshot', at: '2024-01-02T15:14:13.000Z' });
  });
  it('preserves unknown clocks', () => {
    for (const at of [null, 'invalid']) expect(sourceReadClock('snapshot', at)).toMatchObject({
      scraped_at: null, source_read: { clock_version: 1, at: null, basis: 'unknown' },
    });
  });
});
