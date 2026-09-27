import { describe, it, expect } from 'vitest';
import { buildAuctionSequence, buildAuctionSequences, commentPermalink, lotKey, uploadMonth, type AuctionCommentRow } from './auctionSequence';

const LOT = 'https://bringatrailer.com/listing/1985-pontiac-fiero-gt-3/';

const comment = (over: Partial<AuctionCommentRow> & { id: string; posted_at: string }): AuctionCommentRow => ({
  comment_type: 'observation', bid_amount: null, author_username: 'someone', is_seller: false, comment_text: 'text',
  bat_comment_id: 1, source_url: LOT, sequence_number: null, comment_likes: 0, ...over,
});

describe('buildAuctionSequence — one listing', () => {
  const comments: AuctionCommentRow[] = [
    comment({ id: 'b1', posted_at: '2024-02-15T22:09:15Z', comment_type: 'bid', bid_amount: 1985, author_username: 'Jdimora', bat_comment_id: 13676223, sequence_number: 1 }),
    comment({ id: 'c1', posted_at: '2024-02-15T22:46:55Z', author_username: '_OZ_', comment_text: 'Great first bid!', bat_comment_id: 13676789, sequence_number: 2 }),
    comment({ id: 's1', posted_at: '2024-02-16T01:00:00Z', comment_type: 'seller_response', is_seller: true, author_username: 'SSAB194', bat_comment_id: 13677000 }),
    comment({ id: 'b2', posted_at: '2024-02-22T20:32:08Z', comment_type: 'bid', bid_amount: 10420, author_username: 'Threepedalauto', bat_comment_id: 13720000 }),
    comment({ id: 'c2', posted_at: '2024-02-22T22:30:41Z', author_username: 'later', comment_text: 'Congrats', bat_comment_id: 13720500, source_url: null }),
  ];
  const auctionEvents = [{ id: 'ae', source: 'bat', source_url: LOT.replace(/\/$/, ''), lot_number: '137270', outcome: 'sold', winning_bid: 10420, total_bids: 32, winning_bidder: 'Threepedalauto', seller_name: 'SSAB194', page_views: 7116, watchers: 685, comments_count: 42 }];
  const images = [
    { id: 'i1', taken_at: '2026-01-31T18:52:37.111Z', source: 'bat_import', source_url: null },   // import stamp
    { id: 'i2', taken_at: null, source: 'bat_import', source_url: null },                          // no capture time
    { id: 'i3', taken_at: '2024-02-10T15:00:00Z', source: 'owner_upload', source_url: null },      // a real capture
  ];

  it('reads open from the first activity and close from the final bid when the extractor held only dates', () => {
    const { sequences, importStampedDays } = buildAuctionSequences({
      comments, auctionEvents,
      vehicleEvents: [{ id: 've', source_platform: 'bat', source_url: LOT, started_at: null, ended_at: '2024-02-22T00:00:00+00:00', sold_at: '2024-02-22T00:00:00+00:00', final_price: 10420, event_status: 'sold' }],
      timelineEvents: [{ event_type: 'auction_sold', event_date: '2024-02-22' }],
      images, lotUrlHint: LOT,
    });
    expect(sequences).toHaveLength(1);
    const seq = sequences[0];
    expect(seq.open).toMatchObject({ at: '2024-02-15T22:09:15.000Z', exact: false });
    expect(seq.open!.basis).toMatch(/first bid/);
    expect(seq.close).toMatchObject({ at: '2024-02-22T20:32:08.000Z', exact: false });
    expect(seq.close!.basis).toMatch(/final bid/);
    expect(seq).toMatchObject({ outcome: 'sold', price: 10420, buyer: 'Threepedalauto', lotNumber: '137270', bidCount: 32, watchers: 685, ordinal: 1, listingCount: 1 });
    // the null-source comment joined the car's own listing
    expect(seq.items.map(i => i.kind)).toEqual(['bid', 'comment', 'seller', 'bid', 'comment']);
    expect(seq.items.map(i => i.postClose)).toEqual([false, false, false, false, true]);
    expect(seq.items[0].url).toBe('https://bringatrailer.com/listing/1985-pontiac-fiero-gt-3/#comment-13676223');
    expect(seq.photos).toEqual({ publishedWithListing: 2, attributionUncertain: false });
    expect(importStampedDays).toEqual([new Date('2026-01-31T18:52:37.111Z').toLocaleDateString('en-CA')]);
    expect(seq.days.reduce((n, d) => n + d.bids, 0)).toBe(2);
    expect(seq.days[seq.days.length - 1].high).toBe(10420);
    expect(buildAuctionSequence({ comments, auctionEvents, vehicleEvents: [], timelineEvents: [], images: [], lotUrlHint: LOT })?.key).toBe('1985-pontiac-fiero-gt-3');
  });

  it('takes an exact recorded end and a listing day when the extractor held them, and reports an unextracted sequence', () => {
    const { sequences } = buildAuctionSequences({
      comments: [],
      auctionEvents: [],
      vehicleEvents: [{ id: 've', source_platform: 'bat', source_url: 'https://bringatrailer.com/listing/2012-bentley-continental-gt-w12-24', started_at: null, ended_at: '2026-09-23T17:58:05+00:00', sold_at: '2026-09-23T17:58:05+00:00', final_price: 44000, event_status: 'sold' }],
      timelineEvents: [{ event_type: 'auction_listed', event_date: '2026-09-16' }, { event_type: 'auction_sold', event_date: '2026-09-23' }],
      images: [{ id: 'i', taken_at: null, source: 'bat_import', source_url: null }],
    });
    const seq = sequences[0];
    expect(seq.close).toMatchObject({ at: '2026-09-23T17:58:05.000Z', exact: true });
    expect(seq.open!.basis).toMatch(/listing day/);
    expect(seq.activityExtracted).toBe(false);
    expect(seq.price).toBe(44000);
    expect(seq.photos.publishedWithListing).toBe(1);
  });

  it('returns nothing for a vehicle with no BaT lot', () => {
    expect(buildAuctionSequences({ comments: [], auctionEvents: [], vehicleEvents: [], timelineEvents: [], images: [] }).sequences).toEqual([]);
  });
});

describe('buildAuctionSequences — a car that ran three times (1951 Ford F-1)', () => {
  const U17 = 'https://bringatrailer.com/listing/1951-ford-f-100-pick-up-truck/';
  const U18 = 'https://bringatrailer.com/listing/1951-ford-f-1-pickup-5/';
  const U26 = 'https://bringatrailer.com/listing/1951-ford-f-1-pickup-92/';
  const comments: AuctionCommentRow[] = [
    comment({ id: 'a1', posted_at: '2017-06-12T18:17:40Z', comment_type: 'bid', bid_amount: 5000, source_url: U17 }),
    comment({ id: 'a2', posted_at: '2017-06-23T13:58:52Z', comment_type: 'bid', bid_amount: 20750, source_url: U17 }),
    comment({ id: 'b1', posted_at: '2018-07-25T16:04:12Z', comment_type: 'bid', bid_amount: 6000, source_url: U18 }),
    comment({ id: 'b2', posted_at: '2018-08-01T20:52:55Z', comment_type: 'bid', bid_amount: 21750, source_url: U18 }),
    comment({ id: 'c1', posted_at: '2026-01-17T19:22:20Z', comment_type: 'bid', bid_amount: 7000, source_url: U26 }),
    comment({ id: 'c2', posted_at: '2026-01-24T18:49:16Z', comment_type: 'bid', bid_amount: 21250, source_url: U26 }),
    comment({ id: 'c3', posted_at: '2026-01-25T10:00:00Z', comment_text: 'congrats', source_url: null }), // no URL → the car's own listing
  ];
  const auctionEvents = [
    { id: 'e26', source: 'bat', source_url: U26.replace(/\/$/, ''), lot_number: '227632', outcome: 'sold', winning_bid: 21250, total_bids: 15, winning_bidder: 'mohlster', seller_name: null, page_views: null, watchers: null, comments_count: 37 },
    { id: 'e17', source: 'bat', source_url: U17.replace(/\/$/, ''), lot_number: '4653', outcome: 'sold', winning_bid: 20750, total_bids: 18, winning_bidder: 'Paul_Gelpi', seller_name: null, page_views: null, watchers: null, comments_count: 23 },
    { id: 'e18', source: 'bat', source_url: U18.replace(/\/$/, ''), lot_number: '11293', outcome: 'sold', winning_bid: 21750, total_bids: 38, winning_bidder: 'EvanEllis', seller_name: null, page_views: null, watchers: null, comments_count: 31 },
  ];
  const vehicleEvents = [
    // prod holds the 2026 close on the 2017 listing's row — a moment far outside that listing's week is not its own
    { id: 'v17', source_platform: 'bat', source_url: U17.replace(/\/$/, ''), started_at: null, ended_at: '2026-01-24T00:00:00+00:00', sold_at: '2026-01-24T00:00:00+00:00', final_price: 21250, event_status: 'sold' },
    { id: 'v18', source_platform: 'bat', source_url: U18.replace(/\/$/, ''), started_at: null, ended_at: null, sold_at: null, final_price: 21750, event_status: 'sold' },
    { id: 'v26', source_platform: 'bat', source_url: U26.replace(/\/$/, ''), started_at: null, ended_at: null, sold_at: null, final_price: 21250, event_status: 'sold' },
  ];
  const timelineEvents = [
    { event_type: 'auction_listed', event_date: '2026-01-17', title: 'Listed on Bring a Trailer (Lot #227632)' },
    { event_type: 'auction_sold', event_date: '2026-01-24', title: 'Sold at Auction', image_urls: [U26.replace(/\/$/, '')] },
  ];
  const images = [
    { id: 'p18', taken_at: null, source: 'bat_import', source_url: 'https://bringatrailer.com/wp-content/uploads/2018/07/1951_ford_f-1_pickup_IMG_4912.jpg' },
    { id: 'p26', taken_at: '2026-01-23T20:00:00Z', source: 'bat_import', source_url: 'https://bringatrailer.com/wp-content/uploads/2026/01/EM4A6686-90547.jpg' },
    { id: 'p00', taken_at: null, source: 'bat_import', source_url: null },
  ];

  it('builds one sequence per listing, newest first, each with its own open, close, result and photos', () => {
    const { sequences, importStampedDays } = buildAuctionSequences({ comments, auctionEvents, vehicleEvents, timelineEvents, images, lotUrlHint: U26 });
    expect(sequences.map(s => s.key)).toEqual(['1951-ford-f-1-pickup-92', '1951-ford-f-1-pickup-5', '1951-ford-f-100-pick-up-truck']);
    expect(sequences.map(s => s.ordinal)).toEqual([3, 2, 1]);
    expect(sequences.every(s => s.listingCount === 3)).toBe(true);
    const [s26, s18, s17] = sequences;
    expect(s26).toMatchObject({ lotNumber: '227632', price: 21250, buyer: 'mohlster', outcome: 'sold' });
    expect(s26.open!.basis).toMatch(/listing day/);          // the named listed event
    expect(s26.close!.at).toBe('2026-01-24T18:49:16.000Z');   // final bid
    expect(s26.items.map(i => i.id)).toEqual(['c1', 'c2', 'c3']);
    expect(s26.items[2].postClose).toBe(true);
    expect(s18).toMatchObject({ lotNumber: '11293', price: 21750, buyer: 'EvanEllis' });
    expect(s18.close!.at).toBe('2018-08-01T20:52:55.000Z');
    expect(s17).toMatchObject({ lotNumber: '4653', price: 20750, buyer: 'Paul_Gelpi' });
    expect(s17.close!.at).toBe('2017-06-23T13:58:52.000Z');   // the misfiled 2026 end is ignored
    expect(s17.close!.basis).toMatch(/final bid/);
    expect(s17.days[s17.days.length - 1].high).toBe(20750);   // the running high does not carry across listings
    expect(s26.days[s26.days.length - 1].high).toBe(21250);
    // photos: by upload month; the one with no path sits on the car's own listing, flagged
    expect(s18.photos).toEqual({ publishedWithListing: 1, attributionUncertain: false });
    expect(s26.photos).toEqual({ publishedWithListing: 2, attributionUncertain: true });
    expect(importStampedDays).toEqual([new Date('2026-01-23T20:00:00Z').toLocaleDateString('en-CA')]);
  });
});

describe('helpers', () => {
  it('keys a lot by its slug whatever the URL form', () => {
    expect(lotKey('https://bringatrailer.com/listing/1951-Ford-F-1-Pickup-92/')).toBe('1951-ford-f-1-pickup-92');
    expect(lotKey('http://www.bringatrailer.com/listing/1951-ford-f-1-pickup-92?x=1#comment-1')).toBe('1951-ford-f-1-pickup-92');
    expect(lotKey('https://bringatrailer.com/wp-content/uploads/2018/07/x.jpg')).toBeNull();
    expect(lotKey(null)).toBeNull();
  });
  it('reads the upload month off a BaT photo path', () => {
    expect(uploadMonth('https://bringatrailer.com/wp-content/uploads/2018/07/1951_ford_f-1_pickup_IMG_4912.jpg')).toBe('2018-07');
    expect(uploadMonth('https://example.com/x.jpg')).toBeNull();
  });
  it('builds a comment permalink from the lot URL', () => {
    expect(commentPermalink('https://bringatrailer.com/listing/x', 5)).toBe('https://bringatrailer.com/listing/x/#comment-5');
    expect(commentPermalink('https://bringatrailer.com/listing/x/', null)).toBe('https://bringatrailer.com/listing/x/');
  });
});
