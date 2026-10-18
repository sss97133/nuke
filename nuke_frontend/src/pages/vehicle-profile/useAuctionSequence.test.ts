import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/query-core';

const fixture = vi.hoisted(() => ({ options: null as any, result: {} as any, rows: {} as Record<string, any[]>, reads: [] as string[], serverCap: 250, pages: null as any[] | null, failAfter: false, hang: false }));
vi.mock('react', async () => ({ ...await vi.importActual('react'), useMemo: (fn: () => unknown) => fn() }));
vi.mock('@tanstack/react-query', () => ({ useQuery: (options: any) => { fixture.options = options; return fixture.result; } }));
vi.mock('../../lib/supabase', () => ({ supabase: { from: (table: string) => {
  fixture.reads.push(table);
  let after: string | undefined, signal: AbortSignal | undefined;
  const q: any = { then: (fn: any) => {
    if (table === 'auction_comments' && fixture.hang) return new Promise(resolve => signal?.addEventListener('abort', () => resolve({ data: null, error: { message: 'private failure payload' } }), { once: true })).then(fn);
    const data = table === 'auction_comments' ? fixture.pages?.shift() ?? (fixture.rows[table] ?? []).filter(x => !after || x.id > after).sort((a,b) => a.id.localeCompare(b.id)).slice(0,fixture.serverCap) : fixture.rows[table] ?? [];
    return Promise.resolve({ data, error: table === 'auction_comments' && after && fixture.failAfter ? { message: 'private failure payload' } : null }).then(fn);
  } };
  for (const method of ['select', 'eq', 'order', 'limit', 'not']) q[method] = () => q;
  q.gt = (_: string, value: string) => { after = value; return q; };
  q.abortSignal = (value: AbortSignal) => { signal = value; return q; };
  return q;
} } }));
import { fetchNativeAuctionComments, useAuctionSequence } from './useAuctionSequence';

const url = 'https://bringatrailer.com/listing/synthetic-closing-lot';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
beforeEach(() => {
  fixture.reads = []; fixture.result = {};
  fixture.serverCap = 250; fixture.pages = null; fixture.failAfter = false; fixture.hang = false;
  fixture.rows = {
    vehicles: [{ id: 'vehicle' }],
    auction_comments: [{ id: id(1), vehicle_id: 'vehicle', posted_at: '2026-10-04T17:37:08Z', comment_type: 'bid', bid_amount: 122000,
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

  fixture.rows.auction_comments.push({ id: id(2), vehicle_id: 'vehicle', posted_at: '2026-10-04T17:37:28Z', comment_type: 'bid',
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
  expect(fixture.reads.filter(t => t === 'auction_comments')).toHaveLength(4);
  stop();
});

it('does not enable auction reads for a vehicle with no sourced BaT lot', () => {
  expect(useAuctionSequence('ordinary', { listing_url: 'https://example.com/car' }, []).auctions).toEqual([]);
  expect(fixture.options.enabled).toBe(false);
  expect(fixture.reads).toEqual([]);
});

it('reads beyond the API cap and retains raw unknown/microsecond clocks until an empty page', async () => {
  fixture.serverCap = 64;
  fixture.rows.auction_comments = Array.from({length:1001},(_,n) => ({...fixture.rows.auction_comments[0],id:id(n+1),bat_comment_id:n+1,posted_at:n===0?null:n===1000?'2026-10-04T18:00:00.123456+00:00':'2026-10-04T17:37:08Z'}));
  const rows = await fetchNativeAuctionComments('vehicle');
  expect(rows).toHaveLength(1001); expect(rows[0].posted_at).toBeNull();
  expect(rows.at(-1)!.posted_at).toBe('2026-10-04T18:00:00.123456+00:00');
  expect(fixture.reads.filter(t=>t==='auction_comments')).toHaveLength(17);
});

it('refuses capped and failed collections instead of returning a partial prefix', async () => {
  fixture.serverCap=1; fixture.rows.auction_comments.push({...fixture.rows.auction_comments[0],id:id(2)});
  await expect(fetchNativeAuctionComments('vehicle',undefined,{maxRows:1})).rejects.toThrow('auction_activity_read_incomplete');
  fixture.failAfter=true;
  await expect(fetchNativeAuctionComments('vehicle')).rejects.toThrow('auction_activity_read_incomplete');
});

it.each(['foreign','repeat','reverse'])('refuses %s native scope/cursor output',async kind=>{
  const row=fixture.rows.auction_comments[0];
  fixture.pages=kind==='foreign'?[[{...row,vehicle_id:'private-parent'}]]:kind==='repeat'?[[row],[row]]:[[{...row,id:id(2)}],[row]];
  await expect(fetchNativeAuctionComments('vehicle')).rejects.toThrow('auction_activity_read_incomplete');
});

it('denies an unavailable parent before any native/context child read',async()=>{
  fixture.rows.vehicles=[]; useAuctionSequence('vehicle',{listing_url:url},[]);
  await expect(fixture.options.queryFn({signal:new AbortController().signal})).rejects.toThrow('auction_parent_unavailable');
  expect(fixture.reads).toEqual(['vehicles']); expect(fixture.options.retry).toBe(false);
});

it('bounds a stalled request and respects an already cancelled route',async()=>{
  fixture.hang=true;
  await expect(fetchNativeAuctionComments('vehicle',undefined,{timeBudgetMs:1})).rejects.toThrow('auction_activity_read_incomplete');
  fixture.reads=[];const controller=new AbortController();controller.abort();
  await expect(fetchNativeAuctionComments('vehicle',controller.signal)).rejects.toThrow('auction_activity_read_incomplete');
  expect(fixture.reads).toEqual([]);
});

it('withholds stale cached activity after a failed refresh',()=>{
  fixture.result={isError:true,data:{comments:fixture.rows.auction_comments,auctionEvents:fixture.rows.auction_events,vehicleEvents:fixture.rows.vehicle_events,images:[]}};
  const result=useAuctionSequence('vehicle',{listing_url:url},[]);
  expect(result.activityUnavailable).toBe(true);expect(result.auctions).toEqual([]);expect(result.importStampedDays).toEqual([]);
});

it('retains unclocked source activity as unknown position rather than unextracted testimony',()=>{
  fixture.result={data:{comments:[{...fixture.rows.auction_comments[0],posted_at:null}],auctionEvents:fixture.rows.auction_events,vehicleEvents:fixture.rows.vehicle_events,images:[]}};
  const result=useAuctionSequence('vehicle',{listing_url:url},[]);
  expect(result.hasUnpositionedActivity).toBe(true);expect(result.activityUnavailable).not.toBe(true);
});

it('stops a cancelled parent request before starting native/context reads',async()=>{
  const controller=new AbortController();controller.abort();
  useAuctionSequence('vehicle',{listing_url:url},[]);
  await expect(fixture.options.queryFn({signal:controller.signal})).rejects.toThrow('auction_activity_read_incomplete');
  expect(fixture.reads).toEqual(['vehicles']);
});
