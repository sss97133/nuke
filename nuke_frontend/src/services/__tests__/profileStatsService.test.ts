import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  identity: { id: 'source-account', platform: 'bat', handle: 'fixture', claimed_by_user_id: null as string | null },
  comments: [] as any[], listings: [] as any[], listingError: null as any, commentError: null as any, reads: [] as any[],
}));

vi.mock('../../lib/supabase', () => ({ supabase: { from(table: string) {
  const read = { table, filters: [] as Array<[string, any]>, nulls: [] as string[], fields: '', or: '', limit: 0 };
  fixture.reads.push(read);
  const result = () => {
    if (table === 'external_identities') return { data: read.filters.some(([field]) => field === 'id') ? fixture.identity : [fixture.identity], error: null };
    if (table === 'profiles') return { data: { id: 'nuke-user', username: 'nuke-fixture' }, error: null };
    if (table === 'user_comments') return { data: [{ id: 'platform-comment', user_id: 'nuke-user', vehicle: null }], error: null };
    if (table === 'bat_listings') return { data: fixture.listings, count: fixture.listings.length, error: fixture.listingError };
    if (table !== 'auction_comments') return { data: [], error: null };
    if (fixture.commentError) return { data: null, error: fixture.commentError };
    const rows = fixture.comments.filter(c => read.filters.every(([field, value]) => c[field] === value)
      && read.nulls.every(field => c[field] == null));
    return { data: rows.slice(0, read.limit), error: null };
  };
  const query: any = {
    select(fields: string) { read.fields = fields; return query; },
    eq(field: string, value: any) { read.filters.push([field, value]); return query; },
    in() { return query; },
    or(filter: string) { read.or = filter; return query; },
    is(field: string) { read.nulls.push(field); return query; },
    order() { return query; },
    limit(n: number) { read.limit = n; return Promise.resolve(result()); },
    single() { return Promise.resolve(result()); },
    maybeSingle() { return Promise.resolve({ data: null, error: null }); },
    then(resolve: any, reject: any) { return Promise.resolve(result()).then(resolve, reject); },
  };
  return query;
} } }));

import { getPublicProfileByExternalIdentity } from '../profileStatsService';

const parent = { id: 'auction', source_url: 'https://bringatrailer.com/listing/fixture/', vehicle: { id: 'public-vehicle' } };
beforeEach(() => {
  fixture.identity = { id: 'source-account', platform: 'bat', handle: 'fixture', claimed_by_user_id: null };
  fixture.commentError = null; fixture.listingError = null; fixture.listings = []; fixture.reads = [];
  fixture.comments = [
    { id: 'first', platform: 'bat', author_external_identity_id: 'source-account', external_identity_id: 'source-account', bid_amount: null, auction: parent },
    { id: 'second', platform: 'bat', author_external_identity_id: 'source-account', external_identity_id: null, bid_amount: null, auction: parent },
    { id: 'different-author', platform: 'bat', author_external_identity_id: 'someone-else', external_identity_id: 'source-account', bid_amount: null, auction: parent },
    { id: 'bid', platform: 'bat', author_external_identity_id: 'source-account', external_identity_id: 'source-account', bid_amount: 100, auction: parent },
  ];
});

describe('public source-account comments', () => {
  it('shows canonical nonbid authors once, including records without the legacy pointer', async () => {
    const profile = await getPublicProfileByExternalIdentity('source-account');
    expect(profile?.comments.map(c => c.id)).toEqual(['first', 'second']);
    expect(profile?.stats.total_comments).toBe(2);
    expect(profile?.comments[0].listing.source_url).toBe(parent.source_url);
    expect(profile?.comments[0].auction.vehicle.id).toBe('public-vehicle');
    const reads = fixture.reads.filter(r => r.table === 'auction_comments');
    expect(reads).toHaveLength(1);
    expect(reads[0].limit).toBe(100);
  });

  it('does not turn a failed source query into a zero-comment profile', async () => {
    fixture.commentError = { code: '57014', message: 'Comment reader timed out' };
    await expect(getPublicProfileByExternalIdentity('source-account')).rejects.toEqual(fixture.commentError);
  });

  it('retains a real empty indexed comment set as zero', async () => {
    fixture.comments = [];
    const profile = await getPublicProfileByExternalIdentity('source-account');
    expect(profile?.stats.total_comments).toBe(0);
    expect(profile?.comments).toEqual([]);
  });

  it('retains the existing claimed-account route and its distinct Nuke comments', async () => {
    fixture.identity.claimed_by_user_id = 'nuke-user';
    const profile = await getPublicProfileByExternalIdentity('source-account');
    expect(profile?.profile.id).toBe('nuke-user');
    expect(profile?.comments.map(c => c.id)).toEqual(['platform-comment']);
    expect(fixture.reads.some(r => r.table === 'auction_comments')).toBe(false);
  });

  it('uses the linked BaT handle and canonical id to retain native listings missing from event folds', async () => {
    fixture.identity.claimed_by_user_id = 'nuke-user';
    fixture.listings = [{ id: 'native-listing', bat_listing_url: 'https://bringatrailer.com/listing/fixture/', listing_status: 'sold', auction_end_date: '2026-01-01', vehicle: null }];
    const profile = await getPublicProfileByExternalIdentity('source-account');
    expect(profile?.stats.total_listings).toBe(1);
    expect(profile?.listings[0].source_url).toBe(fixture.listings[0].bat_listing_url);
    const native = fixture.reads.find(r => r.table === 'bat_listings')!;
    expect(native.or).toContain('seller_username.eq."fixture"');
    expect(native.or).toContain('seller_external_identity_id.in.(source-account)');
    expect(fixture.reads.some(r => r.table === 'vehicle_events' && r.filters.some(([key]) => key === 'seller_external_identity_id'))).toBe(false);
  });

  it('does not present failed native listing reads as zero seller activity', async () => {
    fixture.identity.claimed_by_user_id = 'nuke-user'; fixture.listingError = { code: '57014', message: 'reader timeout' };
    await expect(getPublicProfileByExternalIdentity('source-account')).rejects.toEqual(fixture.listingError);
  });
  it('quotes exact source handles without changing their characters or admitting filter clauses', async () => {
    fixture.identity.claimed_by_user_id = 'nuke-user'; fixture.identity.handle = 'quoted"handle,with\\slash';
    await getPublicProfileByExternalIdentity('source-account');
    const native = fixture.reads.find(r => r.table === 'bat_listings')!;
    expect(native.or).toContain(`seller_username.eq.${JSON.stringify(fixture.identity.handle)}`);
  });
});
