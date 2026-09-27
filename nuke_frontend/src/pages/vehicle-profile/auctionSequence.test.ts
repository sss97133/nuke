import { describe, it, expect } from 'vitest';
import { buildAuctionSequence, commentPermalink, type AuctionCommentRow } from './auctionSequence';

const LOT = 'https://bringatrailer.com/listing/1985-pontiac-fiero-gt-3/';

const comment = (over: Partial<AuctionCommentRow> & { id: string; posted_at: string }): AuctionCommentRow => ({
  comment_type: 'observation', bid_amount: null, author_username: 'someone', is_seller: false, comment_text: 'text',
  bat_comment_id: 1, source_url: LOT, sequence_number: null, comment_likes: 0, ...over,
});

describe('buildAuctionSequence', () => {
  const comments: AuctionCommentRow[] = [
    comment({ id: 'b1', posted_at: '2024-02-15T22:09:15Z', comment_type: 'bid', bid_amount: 1985, author_username: 'Jdimora', bat_comment_id: 13676223, sequence_number: 1 }),
    comment({ id: 'c1', posted_at: '2024-02-15T22:46:55Z', author_username: '_OZ_', comment_text: 'Great first bid!', bat_comment_id: 13676789, sequence_number: 2 }),
    comment({ id: 's1', posted_at: '2024-02-16T01:00:00Z', comment_type: 'seller_response', is_seller: true, author_username: 'SSAB194', bat_comment_id: 13677000 }),
    comment({ id: 'b2', posted_at: '2024-02-22T20:32:08Z', comment_type: 'bid', bid_amount: 10420, author_username: 'Threepedalauto', bat_comment_id: 13720000 }),
    comment({ id: 'c2', posted_at: '2024-02-22T22:30:41Z', author_username: 'later', comment_text: 'Congrats', bat_comment_id: 13720500 }),
  ];
  const auctionEvents = [{ id: 'ae', source: 'bat', source_url: LOT.replace(/\/$/, ''), lot_number: '137270', outcome: 'sold', winning_bid: 10420, total_bids: 32, winning_bidder: 'Threepedalauto', seller_name: 'SSAB194', page_views: 7116, watchers: 685, comments_count: 42 }];
  const images = [
    { id: 'i1', taken_at: '2026-01-31T18:52:37.111Z', source: 'bat_import' },   // import stamp, after the close
    { id: 'i2', taken_at: null, source: 'bat_import' },                          // no capture time
    { id: 'i3', taken_at: '2024-02-10T15:00:00Z', source: 'owner_upload' },      // a real capture before the close
  ];

  it('reads open from the first activity and close from the final bid when the extractor held only dates', () => {
    const seq = buildAuctionSequence({
      comments, auctionEvents,
      vehicleEvents: [{ id: 've', source_platform: 'bat', source_url: LOT, started_at: null, ended_at: '2024-02-22T00:00:00+00:00', sold_at: '2024-02-22T00:00:00+00:00', final_price: 10420, event_status: 'sold' }],
      timelineEvents: [{ event_type: 'auction_sold', event_date: '2024-02-22' }],
      images,
    });
    expect(seq).not.toBeNull();
    expect(seq!.open).toMatchObject({ at: '2024-02-15T22:09:15.000Z', exact: false });
    expect(seq!.open!.basis).toMatch(/first bid/);
    expect(seq!.close).toMatchObject({ at: '2024-02-22T20:32:08.000Z', exact: false });
    expect(seq!.close!.basis).toMatch(/final bid/);
    expect(seq!).toMatchObject({ outcome: 'sold', price: 10420, buyer: 'Threepedalauto', lotNumber: '137270', bidCount: 32, watchers: 685 });
    expect(seq!.items.map(i => i.kind)).toEqual(['bid', 'comment', 'seller', 'bid', 'comment']);
    expect(seq!.items.map(i => i.postClose)).toEqual([false, false, false, false, true]);
    expect(seq!.items[0].url).toBe('https://bringatrailer.com/listing/1985-pontiac-fiero-gt-3/#comment-13676223');
    expect(seq!.photos).toEqual({ total: 3, withCaptureTime: 1, publishedWithListing: 2, importStampedDays: [new Date('2026-01-31T18:52:37.111Z').toLocaleDateString('en-CA')] });
    expect(seq!.days.reduce((n, d) => n + d.bids, 0)).toBe(2);
    expect(seq!.days[seq!.days.length - 1].high).toBe(10420);
  });

  it('takes an exact recorded end and a listing day when the extractor held them, and reports an unextracted sequence', () => {
    const seq = buildAuctionSequence({
      comments: [],
      auctionEvents: [],
      vehicleEvents: [{ id: 've', source_platform: 'bat', source_url: 'https://bringatrailer.com/listing/2012-bentley-continental-gt-w12-24', started_at: null, ended_at: '2026-09-23T17:58:05+00:00', sold_at: '2026-09-23T17:58:05+00:00', final_price: 44000, event_status: 'sold' }],
      timelineEvents: [{ event_type: 'auction_listed', event_date: '2026-09-16' }, { event_type: 'auction_sold', event_date: '2026-09-23' }],
      images: [{ id: 'i', taken_at: null, source: 'bat_import' }],
    });
    expect(seq!.close).toMatchObject({ at: '2026-09-23T17:58:05.000Z', exact: true });
    expect(seq!.open!.basis).toMatch(/listing day/);
    expect(seq!.activityExtracted).toBe(false);
    expect(seq!.price).toBe(44000);
    expect(seq!.photos.publishedWithListing).toBe(1);
  });

  it('returns null for a vehicle with no BaT lot', () => {
    expect(buildAuctionSequence({ comments: [], auctionEvents: [], vehicleEvents: [], timelineEvents: [], images: [] })).toBeNull();
  });

  it('builds a comment permalink from the lot URL', () => {
    expect(commentPermalink('https://bringatrailer.com/listing/x', 5)).toBe('https://bringatrailer.com/listing/x/#comment-5');
    expect(commentPermalink('https://bringatrailer.com/listing/x/', null)).toBe('https://bringatrailer.com/listing/x/');
  });
});
