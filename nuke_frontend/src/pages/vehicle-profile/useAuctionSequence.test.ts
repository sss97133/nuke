import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/query-core';

const fixture = vi.hoisted(() => ({ options: null as any, result: {} as any, rows: {} as Record<string, any[]>, reads: [] as string[] }));
vi.mock('react', async () => ({ ...await vi.importActual('react'), useMemo: (fn: () => unknown) => fn() }));
vi.mock('@tanstack/react-query', () => ({ useQuery: (options: any) => { fixture.options = options; return fixture.result; } }));
vi.mock('../../lib/supabase', () => ({ supabase: { from: (table: string) => {
  fixture.reads.push(table);
  const q: any = { then: (fn: any) => Promise.resolve({ data: fixture.rows[table] ?? [], error: null }).then(fn) };
  for (const method of ['select', 'eq', 'order', 'limit', 'not']) q[method] = () => q;
  return q;
} } }));
import { useAuctionSequence } from './useAuctionSequence';

const url = 'https://bringatrailer.com/listing/synthetic-closing-lot';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
beforeEach(() => {
  fixture.reads = []; fixture.result = {};
  fixture.rows = {
    auction_comments: [{ id: 'bid-1', posted_at: '2026-10-04T17:37:08Z', comment_type: 'bid', bid_amount: 122000,
      author_username: 'bidder', source_url: url, bat_comment_id: 1 }],
    auction_events: [{ id: 'auction', source: 'bat', source_url: url, outcome: 'live', total_bids: 1 }],
    vehicle_events: [{ id: 'event', source_platform: 'bat', source_url: url, started_at: '2026-09-27T17:36:00Z',
      ended_at: '2026-10-04T17:39:00Z', event_status: 'active' }],
    vehicle_images: [],
  };
});
afterEach(() => client.clear());

it('refreshes an already-read lot through shared query invalidation and shows the native final result', async () => {
  useAuctionSequence('vehicle', { listing_url: url }, []);
  const observer = new QueryObserver(client, fixture.options);
  const stop = observer.subscribe(() => {});
  await observer.refetch();
  fixture.result = observer.getCurrentResult();
  expect(useAuctionSequence('vehicle', { listing_url: url }, []).auctions[0].outcome).toBe('live');

  fixture.rows.auction_comments.push({ id: 'bid-2', posted_at: '2026-10-04T17:37:28Z', comment_type: 'bid',
    bid_amount: 123000, author_username: 'winner', source_url: url, bat_comment_id: 2 });
  fixture.rows.auction_events[0] = { ...fixture.rows.auction_events[0], outcome: 'sold', winning_bid: 123000, winning_bidder: 'winner', total_bids: 2 };
  fixture.rows.vehicle_events[0] = { ...fixture.rows.vehicle_events[0], event_status: 'sold', final_price: 123000,
    sold_at: '2026-10-04T17:39:28Z', ended_at: '2026-10-04T17:39:28Z' };
  await client.invalidateQueries({ queryKey: ['auction-sequence', 'vehicle'] });
  fixture.result = observer.getCurrentResult();
  const auction = useAuctionSequence('vehicle', { listing_url: url }, []).auctions[0];
  expect(auction.outcome).toBe('sold');
  expect(auction.lastObservedBid).toMatchObject({ amount: 123000, at: '2026-10-04T17:37:28.000Z' });
  expect(auction.close?.at).toBe('2026-10-04T17:39:28.000Z');
  expect(auction.price).toBe(123000);
  expect(auction.buyer).toBe('winner');
  expect(fixture.reads.filter(t => t === 'auction_comments')).toHaveLength(2);
  stop();
});

it('does not enable auction reads for a vehicle with no sourced BaT lot', () => {
  expect(useAuctionSequence('ordinary', { listing_url: 'https://example.com/car' }, []).auctions).toEqual([]);
  expect(fixture.options.enabled).toBe(false);
  expect(fixture.reads).toEqual([]);
});
