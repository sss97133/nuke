import { beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), calls: [] as any[], parent: null as any, comments: [] as any[], error: null as any }));
vi.mock('../lib/supabase', () => ({ supabase: { from: fixture.from, rpc: fixture.rpc } }));
vi.mock('@tanstack/react-query', () => ({ useQuery: (options: any) => options }));
import { readAuctionEpisode, useAuctionCommentStats } from './useAuctionComments';
beforeEach(() => {
  fixture.calls = []; fixture.parent = { id: 'public', listing_url: 'https://bringatrailer.com/listing/public/' };
  fixture.comments = []; fixture.error = null;
  fixture.rpc.mockReset().mockResolvedValue({ data: [], error: null });
  fixture.from.mockReset().mockImplementation((table: string) => {
    const q: any = { then: (fn: any) => Promise.resolve({ data: table === 'vehicles' ? fixture.parent : fixture.comments, error: fixture.error, count: 8 }).then(fn) };
    for (const method of ['select', 'eq', 'is', 'or', 'in', 'order', 'limit', 'maybeSingle', 'not']) {
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
  expect(fixture.from.mock.calls.map(c => c[0])).toEqual(['vehicles']);
  expect(fixture.rpc).not.toHaveBeenCalled();
});
