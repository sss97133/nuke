import { beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), calls: [] as any[], parent: null as any, episodes: [] as any[], comments: [] as any[], error: null as any }));
vi.mock('../lib/supabase', () => ({ supabase: { from: fixture.from, rpc: fixture.rpc } }));
vi.mock('@tanstack/react-query', () => ({ useQuery: (options: any) => options }));
import { readAuctionEpisode, useAuctionCommentStats, useAuctionComments } from './useAuctionComments';
beforeEach(() => {
  fixture.calls = []; fixture.parent = { id: 'public', listing_url: 'https://bringatrailer.com/listing/public/' };
  fixture.comments = []; fixture.episodes = []; fixture.error = null;
  fixture.rpc.mockReset().mockResolvedValue({ data: [], error: null });
  fixture.from.mockReset().mockImplementation((table: string) => {
    const q: any = { then: (fn: any) => Promise.resolve({ data: table === 'vehicles' ? fixture.parent : table === 'vehicle_events' ? fixture.episodes : fixture.comments, error: fixture.error, count: 8 }).then(fn) };
    for (const method of ['select', 'eq', 'is', 'or', 'in', 'order', 'limit', 'maybeSingle', 'not', 'gt']) {
      q[method] = (...args: any[]) => { fixture.calls.push([table, method, ...args]); return q; };
    }
    return q;
  });
});
it('does not request comments or specs for a denied, deleted or nonvehicle parent', async () => {
  fixture.parent = null;
  expect(await readAuctionEpisode('private')).toBeNull();
  expect(fixture.from.mock.calls.map(c => c[0])).toEqual(['vehicles']);
  expect(fixture.rpc).not.toHaveBeenCalled();
  expect(fixture.calls).toContainEqual(['vehicles', 'eq', 'is_public', true]);
  expect(fixture.calls).toContainEqual(['vehicles', 'is', 'deleted_at', null]);
  expect(fixture.calls).toContainEqual(['vehicles', 'is', 'merged_into_vehicle_id', null]);
  expect(fixture.calls).toContainEqual(['vehicles', 'or', 'status.is.null,status.neq.merged']);
  expect(fixture.calls).toContainEqual(['vehicles', 'or', 'listing_kind.is.null,listing_kind.neq.non_vehicle_item']);
});
it('bounds one exact listing with its slash alias and repeats public-parent eligibility in the comment query', async () => {
  fixture.comments = Array.from({ length: 101 }, (_, i) => ({ id: String(i) }));
  const read = await readAuctionEpisode('public');
  expect(read?.interactions).toHaveLength(100); expect(read?.truncated).toBe(true);
  expect(fixture.calls).toContainEqual(['auction_comments', 'limit', 101]);
  expect(fixture.calls).toContainEqual(['auction_comments', 'in', 'source_url', ['https://bringatrailer.com/listing/public', 'https://bringatrailer.com/listing/public/']]);
  expect(fixture.calls).toContainEqual(['auction_comments', 'eq', 'vehicles.is_public', true]);
  const selection = fixture.calls.find(c => c[0] === 'auction_comments' && c[1] === 'select')[2];
  expect(selection).not.toMatch(/author|email|raw|\*/);
  expect(selection).toContain('canonical:auction_events_canonical(id)');
  expect(fixture.calls).toContainEqual(['auction_comments','or','auction_event_id.is.null,canonical.not.is.null']);
});
it('does not borrow comments from other sources or malformed URLs', async () => {
  fixture.parent.listing_url = 'https://example.com/listing/public/';
  expect(await readAuctionEpisode('public')).toBeNull();
  expect(fixture.from.mock.calls.map(c => c[0])).toEqual(['vehicles']);
});

it('scopes every live statistic to both slash aliases of the selected listing', async () => {
  const options = useAuctionCommentStats('public','https://bringatrailer.com/listing/public/') as any;
  const read = await options.queryFn();
  expect(read.commentCount).toBe(8);
  expect(fixture.calls.filter(c => c[1] === 'in' && c[2] === 'source_url')).toHaveLength(5);
  expect(fixture.calls.filter(c => c[1] === 'in').every(c => c[3].join(',') === 'https://bringatrailer.com/listing/public,https://bringatrailer.com/listing/public/')).toBe(true);
});
it('does not report zero engagement when a retained-statistic query fails', async () => {
  fixture.error = new Error('source read failed');
  const options = useAuctionCommentStats('public','https://bringatrailer.com/listing/public/') as any;
  await expect(options.queryFn()).rejects.toThrow('source read failed');
});
it('does not switch an open market inspection to a different relisting', async () => {
  expect(await readAuctionEpisode('public', 'https://bringatrailer.com/listing/previous/')).toBeNull();
  expect(fixture.from.mock.calls.map(c => c[0])).toEqual(['vehicles', 'vehicle_events']);
  expect(fixture.rpc).not.toHaveBeenCalled();
});


it.each(['https://bringatrailer.com/listing/current', 'https://bringatrailer.com/listing/current/'])('keeps raw history scoped to canonical comments under both exact URL spellings: %s', async url => {
  const options = useAuctionComments('public', url) as any;
  await options.queryFn();
  expect(fixture.calls).toContainEqual(['auction_comments', 'in', 'source_url', ['https://bringatrailer.com/listing/current', 'https://bringatrailer.com/listing/current/']]);
  expect(fixture.calls).toContainEqual(['auction_comments', 'eq', 'vehicle_id', 'public']);
  expect(fixture.calls).toContainEqual(['auction_comments', 'or', 'auction_event_id.is.null,canonical.not.is.null']);
  expect(fixture.calls.filter(c => c[1] === 'in')).toHaveLength(1);
});


const currentEpisode = () => ({ id: 'current-episode', source_url: 'https://bringatrailer.com/listing/current/',
  source_platform: 'bat', event_type: 'auction', event_status: 'active', sold_at: null, duplicate_of_event_id: null,
  ended_at: new Date(Date.now() + 86400000).toISOString() });
it('opens exact current episode evidence despite a historical scalar URL without rewriting that history', async () => {
  fixture.episodes = [currentEpisode()];
  fixture.comments = Array.from({ length: 60 }, (_, i) => ({ id: String(i) }));
  const result = await readAuctionEpisode('public', 'https://bringatrailer.com/listing/current');
  expect(result?.interactions).toHaveLength(60);
  expect(result?.sourceUrl).toBe('https://bringatrailer.com/listing/current/');
  expect(result?.vehicle.listing_url).toBe('https://bringatrailer.com/listing/public/');
  expect(fixture.calls).toContainEqual(['vehicle_events', 'limit', 2]);
  expect(fixture.calls).toContainEqual(['vehicle_events', 'is', 'duplicate_of_event_id', null]);
  expect(fixture.calls).toContainEqual(['vehicle_events', 'eq', 'vehicle_id', 'public']);
  expect(fixture.calls).toContainEqual(['auction_comments', 'in', 'source_url', ['https://bringatrailer.com/listing/current', 'https://bringatrailer.com/listing/current/']]);
});
it.each([
  { source_url: 'https://bringatrailer.com/listing/other' }, { source_platform: 'carsandbids' },
  { event_type: 'listing' }, { event_status: 'sold' }, { ended_at: '2020-01-01T00:00:00Z' },
  { ended_at: 'invalid' }, { ended_at: '2099-01-01T00:00:00Z' }, { duplicate_of_event_id: 'other' },
  { sold_at: '2024-05-20T00:00:00Z' },
])('refuses unqualified current-episode fallback: %j', patch => {
  fixture.episodes = [{ ...currentEpisode(), ...patch }];
  return expect(readAuctionEpisode('public', 'https://bringatrailer.com/listing/current')).resolves.toBeNull();
});
it('refuses ambiguous current episode witnesses before reading comments', async () => {
  fixture.episodes = [currentEpisode(), { ...currentEpisode(), id: 'second' }];
  expect(await readAuctionEpisode('public', 'https://bringatrailer.com/listing/current')).toBeNull();
  expect(fixture.from.mock.calls.map(c => c[0])).toEqual(['vehicles', 'vehicle_events']);
});
it('does not resolve a current episode behind a private parent', async () => {
  fixture.parent = null; fixture.episodes = [currentEpisode()];
  expect(await readAuctionEpisode('private', 'https://bringatrailer.com/listing/current')).toBeNull();
  expect(fixture.from.mock.calls.map(c => c[0])).toEqual(['vehicles']);
});
