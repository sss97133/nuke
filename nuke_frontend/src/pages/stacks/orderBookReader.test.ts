import { beforeEach, describe, expect, it, vi } from 'vitest';

// The reader's gate is tested against a recording supabase double; everything else is pure shaping over synthetic rows.
const fixture = vi.hoisted(() => ({ reads: [] as Array<{ table: string; calls: Array<[string, unknown[]]> }>, parent: null as unknown, lots: [] as unknown[], bidPages: [] as unknown[][], bidError: false }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({}) }));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const read = { table, calls: [] as Array<[string, unknown[]]> };
      fixture.reads.push(read);
      const q: Record<string, (...args: unknown[]) => unknown> = {
        then: (fn: unknown) => Promise.resolve(table === 'vehicles' ? { data: fixture.parent, error: null }
          : table === 'auction_events' ? { data: fixture.lots, error: null }
          : table === 'auction_comments' ? { data: fixture.bidPages.shift() ?? [], error: fixture.bidError ? new Error('read failed') : null, count: 0 }
          : { data: [], error: null, count: 0 })
          .then(fn as (v: unknown) => unknown),
      };
      for (const m of ['select', 'eq', 'is', 'or', 'in', 'order', 'limit', 'gt', 'abortSignal']) {
        q[m] = (...args: unknown[]) => { read.calls.push([m, args]); return q; };
      }
      q.maybeSingle = () => q;
      return q;
    },
  },
}));

import {
  LOT_WINDOW_DAYS, bidEvents, chooseLot, depthAt, foldOrderBook, frameCoverage, lotWindow, partitionWindow,
  readOrderBook, readBidBook, bidBookReading, shapeOrderBook, type CommentRow, type LotRow, type OrderBookRead,
} from './orderBookReader';

const VEHICLE = '00000000-0000-4000-8000-000000000001';
const LOT = '00000000-0000-4000-8000-0000000000a1';
const ID_A = '00000000-0000-4000-8000-00000000aaaa';
const ID_B = '00000000-0000-4000-8000-00000000bbbb';
const CLOSE = Date.parse('2026-10-12T20:30:00Z');
const URL = 'https://bringatrailer.com/listing/synthetic-lot-1';
const at = (minutesBeforeClose: number) => new Date(CLOSE - minutesBeforeClose * 60_000).toISOString();

let n = 0;
function row(changes: Partial<CommentRow>): CommentRow {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, posted_at: at(600), created_at: at(500), comment_type: 'observation',
    bid_amount: null, author_username: 'synthetic', external_identity_id: null, is_seller: false, bat_comment_id: n,
    source_url: `${URL}/`, comment_text: 'text', ...changes,
  };
}
function bid(minutes: number, amount: number, identity: string | null, handle = 'synthetic', extra: Partial<CommentRow> = {}) {
  return row({ comment_type: 'bid', bid_amount: amount, posted_at: at(minutes), external_identity_id: identity, author_username: handle, ...extra });
}
function lot(changes: Partial<LotRow> = {}): LotRow {
  return {
    id: LOT, source: 'bat', source_url: URL, lot_number: '1', outcome: 'live', auction_end_date: new Date(CLOSE).toISOString(),
    high_bid: null, winning_bid: null, total_bids: null, seller_name: null, seller_external_identity_id: null, winning_bidder: null,
    winning_bidder_external_identity_id: null, updated_at: at(400),
    ...changes,
  };
}
const identities = { [ID_A]: { id: ID_A, platform: 'bat', handle: 'bidder-a' }, [ID_B]: { id: ID_B, platform: 'bat', handle: 'bidder-b' } };

beforeEach(() => { n = 0; fixture.reads = []; fixture.parent = null; fixture.lots = []; fixture.bidPages = []; fixture.bidError = false; });

describe('lot window', () => {
  it('leaves rows posted more than the window before close out of the lot, and keeps undated rows in it', () => {
    const inside = bid(LOT_WINDOW_DAYS * 1440 - 1, 100, ID_A);
    const outside = bid(LOT_WINDOW_DAYS * 1440 + 1, 100, ID_A);
    const undated = row({ posted_at: null });
    const p = partitionWindow([inside, outside, undated], CLOSE);
    expect(p.inWindow.map((r) => r.id)).toEqual([inside.id, undated.id]);
    expect(p.outside.map((r) => r.id)).toEqual([outside.id]);
    expect(partitionWindow([outside], null).outside).toEqual([]);
  });

  it('measures minutes live from the first comment held to the close, or to the read while open', () => {
    const rows = [row({ posted_at: at(120) }), row({ posted_at: at(60) })];
    const closed = lotWindow(lot(), rows, CLOSE + 3_600_000);
    expect(closed).toMatchObject({ open: false, minutesLive: 120, firstHeldAt: CLOSE - 120 * 60_000, liveUntil: CLOSE });
    const open = lotWindow(lot(), rows, CLOSE - 30 * 60_000);
    expect(open).toMatchObject({ open: true, minutesLive: 90 });
  });
});

describe('fold', () => {
  it('orders bids by posted time, then BaT comment id, and drops undated, amountless and non-bid rows', () => {
    const rows = [
      bid(10, 300, ID_A, 'a', { bat_comment_id: 9 }), bid(10, 250, ID_B, 'b', { bat_comment_id: 3 }), bid(20, 100, ID_A),
      row({ comment_type: 'bid', bid_amount: null }), row({ comment_type: 'bid', posted_at: null, bid_amount: 5 }), row({ bid_amount: 7 }),
    ];
    const bids = bidEvents(rows, identities);
    expect(bids.map((b) => b.amount)).toEqual([100, 250, 300]);
    expect(bids[1].handle).toBe('bidder-b');
  });

  it('is point-in-time: the book at a bid holds only bids posted at or before it', () => {
    const bids = bidEvents([bid(30, 100, ID_A), bid(20, 200, ID_B), bid(10, 300, ID_A)], identities);
    const states = foldOrderBook(bids, CLOSE);
    expect(states.map((s) => s.price)).toEqual([100, 200, 300]);
    expect(states[0].book.map((e) => [e.handle, e.max])).toEqual([['bidder-a', 100]]);
    expect(states[1].book.map((e) => [e.handle, e.max])).toEqual([['bidder-b', 200], ['bidder-a', 100]]);
    expect(states[2].book.map((e) => [e.handle, e.max, e.bids])).toEqual([['bidder-a', 300, 2], ['bidder-b', 200, 1]]);
    // the earlier state's snapshot is not changed by later bids
    expect(states[1].book.find((e) => e.handle === 'bidder-a')?.max).toBe(100);
    expect(states[2].msToClose).toBe(10 * 60_000);
    expect(depthAt(states[2].book, 150)).toBe(2);
    expect(depthAt(states[2].book, 250)).toBe(1);
  });

  it('never unifies unkeyed bids by handle', () => {
    const bids = bidEvents([bid(30, 100, null, 'same-text'), bid(20, 200, null, 'same-text'), bid(10, 300, ID_A)], identities);
    const last = foldOrderBook(bids, CLOSE)[2];
    expect(last.identities).toBe(1);
    expect(last.unresolved).toBe(2);
    expect(last.book).toHaveLength(3);
  });
});

describe('frames', () => {
  it('counts distinct receipt minutes inside the live window only', () => {
    const win = lotWindow(lot(), [row({ posted_at: at(60) })], CLOSE + 1);
    const frame = (minutes: number, seconds = 0) => ({
      id: `f-${minutes}-${seconds}`, kind: 'listing', observed_at: null, event: 'stats-updated',
      received_at: new Date(CLOSE - minutes * 60_000 + seconds * 1000).toISOString(),
    });
    const cov = frameCoverage([frame(10), frame(10, 20), frame(9), frame(-1), { ...frame(5), kind: 'bid', received_at: null }], win);
    expect(cov.frames).toBe(5);
    expect(cov.minutesWithFrame).toBe(2);
    expect(cov.byKind).toEqual([{ kind: 'listing', count: 4 }, { kind: 'bid', count: 1 }]);
  });
});

describe('coverage', () => {
  function read(changes: Partial<OrderBookRead> = {}): OrderBookRead {
    return {
      vehicle: { id: VEHICLE, year: 2000, make: 'Synthetic', model: 'Coupe', listing_url: URL, sale_status: 'auction_live' },
      lots: [lot({ total_bids: 3 })], lot: lot({ total_bids: 3 }),
      comments: [bid(30, 100, ID_A), bid(20, 200, null, 'unkeyed'), bid(10, 300, ID_A), row({ posted_at: at(5) })],
      unkeyedOnUrl: 1, frames: [], identities, readAt: new Date(CLOSE - 60_000).toISOString(), ...changes,
    };
  }

  it('gives every number its denominator and clock, and adds key conflicts only when there are some', () => {
    const view = shapeOrderBook(read())!;
    const byId = Object.fromEntries(view.coverage.map((c) => [c.id, c]));
    expect(byId.bids_keyed).toMatchObject({ numerator: 2, denominator: 3 });
    expect(byId.bids_held).toMatchObject({ numerator: 3, denominator: 3, asOfBasis: 'lot row last written' });
    expect(byId.comments_keyed).toMatchObject({ numerator: 4, denominator: 5 });
    expect(byId.frames).toMatchObject({ numerator: 0, denominator: 29 });
    expect(byId.key_conflicts).toBeUndefined();
    for (const c of view.coverage) expect(c.asOfBasis).toBeTruthy();

    const conflicted = shapeOrderBook(read({ comments: [...read().comments, bid(LOT_WINDOW_DAYS * 1440 + 60, 99_000, ID_B)] }))!;
    expect(conflicted.coverage.find((c) => c.id === 'key_conflicts')).toMatchObject({ numerator: 1, denominator: 5 });
    // the conflicting bid is out of the fold and out of the bid counts
    expect(conflicted.states[conflicted.states.length - 1].price).toBe(300);
    expect(conflicted.coverage.find((c) => c.id === 'bids_held')?.numerator).toBe(3);
  });

  it('reports the key-conflict check as not run when the lot has no close time', () => {
    const view = shapeOrderBook(read({ lot: lot({ auction_end_date: null, total_bids: 3 }) }))!;
    expect(view.coverage.find((c) => c.id === 'key_conflicts')).toMatchObject({ numerator: null, denominator: 4 });
    expect(view.coverage.find((c) => c.id === 'frames')?.denominator).toBeNull();
    expect(view.states.every((s) => s.msToClose === null)).toBe(true);
  });

  it('keeps an unknown source count unknown instead of inventing one', () => {
    const view = shapeOrderBook(read({ lot: lot({ total_bids: null }) }))!;
    expect(view.coverage.find((c) => c.id === 'bids_held')?.denominator).toBeNull();
  });

  it('returns no view without a lot', () => {
    expect(shapeOrderBook(read({ lot: null }))).toBeNull();
  });
});

describe('lot choice and the public gate', () => {
  it('takes the asked lot, else the listing URL with or without a slash, else the newest', () => {
    const a = lot({ id: 'a', source_url: 'https://bringatrailer.com/listing/old' });
    const b = lot({ id: 'b', source_url: URL });
    expect(chooseLot([a, b], `${URL}/`, null)?.id).toBe('b');
    expect(chooseLot([a, b], `${URL}/`, 'a')?.id).toBe('a');
    expect(chooseLot([a, b], `${URL}/`, 'latest')?.id).toBe('a');
    expect(chooseLot([a, b], null, 'missing')?.id).toBe('a');
    expect(chooseLot([], URL, null)).toBeNull();
  });

  it('reads nothing past a vehicle that is not public', async () => {
    fixture.parent = null;
    expect(await readOrderBook(VEHICLE, null)).toBeNull();
    expect(fixture.reads.map((r) => r.table)).toEqual(['vehicles']);
    const gate = fixture.reads[0].calls;
    expect(gate).toContainEqual(['eq', ['is_public', true]]);
    expect(gate).toContainEqual(['is', ['deleted_at', null]]);
  });

  it('refuses a malformed id without reading', async () => {
    expect(await readOrderBook('not-a-uuid', null)).toBeNull();
    expect(fixture.reads).toEqual([]);
  });
});


describe('compact Stack A reading', () => {
  const reading = (rows: CommentRow[], total = rows.length) => bidBookReading({
    vehicle: { id: VEHICLE, year: 2000, make: 'Synthetic', model: 'Coupe', listing_url: URL, sale_status: 'auction_live' },
    lot: lot({ total_bids: total }), bids: rows, readAt: at(1),
  });
  it('distinguishes a repeated leader raise from another competing bidder', () => {
    const r = reading([bid(30, 800, ID_A), bid(20, 900, ID_B), bid(10, 950, ID_A), bid(5, 1000, ID_A)]);
    expect(r).toMatchObject({ bidders: 2, near: 2, held: 4, reported: 4, exact: true, gap: 10 });
    expect(r.lastRaise).toBeCloseTo(100 * 50 / 950);
    expect(r.states[0].book).toHaveLength(1);
    expect(r.states[1].price).toBe(900);
  });
  it('withholds separation and sequential raise when the source count exceeds retained bids', () => {
    const r = reading([bid(20, 900, ID_B), bid(10, 1000, ID_A)], 5);
    expect(r).toMatchObject({ bidders: 2, near: 2, exact: false, gap: null, lastRaise: null });
  });
  it('does not count repeated unknown handles as distinct bidders', () => {
    const r = reading([bid(30, 800, null, 'same'), bid(20, 950, null, 'same'), bid(10, 1000, ID_A)]);
    expect(r).toMatchObject({ bidders: 1, near: 1, allIdentified: false, gap: null, exact: false });
  });
  it('refuses another episode, undated bids, future events, post-close events and duplicate source events', () => {
    const good = bid(10, 1000, ID_A);
    const r = reading([good, { ...good, id: 'duplicate' }, bid(20, 900, ID_B, 'b', { source_url: URL + '-relisted' }),
      bid(LOT_WINDOW_DAYS * 1440 + 1, 100, ID_B), bid(0, 1100, ID_B), bid(-1, 1200, ID_B),
      bid(20, 500, ID_B, 'b', { posted_at: null })]);
    expect(r).toMatchObject({ held: 1, rejected: 6, exact: false, gap: null, lastRaise: null });
  });
  it('requires a clock and increasing sequence for a last-raise reading', () => {
    const r = reading([bid(30, 800, ID_A), bid(20, 700, ID_B), bid(10, 900, ID_A)]);
    expect(r.lastRaise).toBeNull();
    expect(bidBookReading({ vehicle: {} as any, lot: lot({ auction_end_date: null }),
      bids: [bid(10, 1000, ID_A)], readAt: at(1) }).held).toBe(0);
  });
  it('refuses a relisting before reading any child relation', async () => {
    fixture.parent = { id: VEHICLE, listing_url: URL + '-new' };
    expect(await readBidBook(VEHICLE, URL)).toBeNull();
    expect(fixture.reads.map(r => r.table)).toEqual(['vehicles']);
  });
});


it('reads the compact projection to an empty page, with public gates and no prose/frame/identity reads', async () => {
  fixture.parent = { id: VEHICLE, listing_url: URL };
  fixture.lots = [lot()];
  fixture.bidPages = [[bid(20, 900, ID_A)], [bid(10, 1000, ID_B)], []];
  const read = await readBidBook(VEHICLE, URL);
  expect(read?.bids).toHaveLength(2);
  expect(fixture.reads.map(r => r.table)).toEqual(['vehicles', 'auction_events', 'auction_comments', 'auction_comments', 'auction_comments']);
  const reads = fixture.reads.filter(r => r.table === 'auction_comments');
  for (const r of reads) {
    expect(r.calls).toContainEqual(['eq', ['comment_type', 'bid']]);
    expect(r.calls).toContainEqual(['eq', ['auction_event_id', LOT]]);
    expect(r.calls).toContainEqual(['eq', ['vehicles.is_public', true]]);
    expect(String(r.calls.find(([m]) => m === 'select')?.[1][0])).not.toContain('comment_text');
  }
  expect(reads[1].calls.some(([m]) => m === 'gt')).toBe(true);
});
it('refuses duplicate episode ownership and failures instead of returning partial bid depth', async () => {
  fixture.parent = { id: VEHICLE, listing_url: URL };
  fixture.lots = [lot(), lot({ id: 'duplicate' })];
  expect(await readBidBook(VEHICLE, URL)).toBeNull();
  expect(fixture.reads.map(r => r.table)).toEqual(['vehicles', 'auction_events']);
  fixture.lots = [lot()]; fixture.bidError = true;
  await expect(readBidBook(VEHICLE, URL)).rejects.toThrow('could not be read completely');
});
