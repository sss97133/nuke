// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ auction: null as any, activityUnavailable: false, hasUnpositionedActivity: false, rpc: vi.fn(), timelineEvents: [{ id: 'synthetic-profile-created', event_type: 'vehicle_added', event_date: '2025-01-01', title: 'Synthetic profile created' }], setGalleryFilter: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
vi.mock('./VehicleProfileContext', () => ({ useVehicleProfile: () => ({ vehicle: { id: 'synthetic-vehicle', year: 2025 }, vehicleId: 'synthetic-vehicle', timelineEvents: fixture.timelineEvents, setGalleryFilter: fixture.setGalleryFilter }) }));
vi.mock('./useAuctionSequence', () => ({ useAuctionSequence: () => ({ auctions: fixture.auction ? [fixture.auction] : [], importStampedDays: [], loading: false, activityUnavailable: fixture.activityUnavailable, hasUnpositionedActivity: fixture.hasUnpositionedActivity }) }));
vi.mock('./VehiclePhotoLightbox', () => ({ VEHICLE_DAY_OPEN_EVENT: 'synthetic-day-open' }));
import AuctionSequenceBand from './AuctionSequenceBand';
import BarcodeTimeline from './BarcodeTimeline';
import { buildAuctionSequence, type AuctionSequence } from './auctionSequence';

const LOT = 'https://bringatrailer.com/listing/synthetic-cohort-lot/';
function sequence(end: string | null, sale: string | null = null, status = 'sold', outcome: string | null = null, start: string | null = null): AuctionSequence {
  return buildAuctionSequence({
    comments: [
      { id: 'synthetic-bid', posted_at: '2025-01-10T20:00:00Z', comment_type: 'bid', bid_amount: 3000, author_username: 'SyntheticBidder', is_seller: false, comment_text: 'Synthetic bid', bat_comment_id: 101, source_url: LOT, sequence_number: 1, comment_likes: 0 },
      { id: 'synthetic-comment', posted_at: '2025-01-10T20:10:00Z', comment_type: 'observation', bid_amount: null, author_username: 'SyntheticCommenter', is_seller: false, comment_text: 'Synthetic comment before the recorded end', bat_comment_id: 102, source_url: LOT, sequence_number: 2, comment_likes: 0 },
    ],
    auctionEvents: outcome == null ? [] : [{ id: 'synthetic-auction', source: 'bat', source_url: LOT, lot_number: null, outcome, winning_bid: null, total_bids: null, winning_bidder: null, seller_name: null, page_views: null, watchers: null, comments_count: null }],
    vehicleEvents: [{ id: 'synthetic-event', source_platform: 'bat', source_url: LOT, started_at: start, ended_at: end, sold_at: sale, final_price: null, event_status: status }],
    timelineEvents: [], images: [], lotUrlHint: LOT,
  })!;
}
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  fixture.activityUnavailable = false; fixture.hasUnpositionedActivity = false; fixture.auction = null;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.rpc.mockReset(); fixture.rpc.mockResolvedValue({ data: [], error: null });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (text: string) => ({ width: text.length * 5 }) } as any);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function band(auction: AuctionSequence) { await act(async () => root.render(<AuctionSequenceBand auction={auction} activeDay={null} onOpenDay={() => {}} />)); }

describe('visible auction clock and outcome qualification', () => {
  it.each([
    [null, null, 'CLOSE not recorded'],
    ['2025-01-10T00:00:00Z', null, 'END DAY (time unknown)'],
    [null, '2025-01-10T20:30:00Z', 'SALE RECORDED'],
  ])('keeps %s / sale %s unclassified after the last observed bid', async (end, sale, label) => {
    await band(sequence(end, sale));
    expect(container.querySelector('.auction-band__facts')!.textContent).toContain(label);
    expect(container.textContent).toContain('LAST OBSERVED BID');
    expect(container.textContent).toContain('auction end clock unknown');
    expect(container.textContent).not.toContain('within two minutes');
    expect(container.querySelector('rect[fill-opacity="0.25"]')).toBeNull();
    expect(container.querySelector('a[href="https://bringatrailer.com/listing/synthetic-cohort-lot/#comment-101"]')).not.toBeNull();
  });

  it('shows the genuinely recorded end and shades only the region after that clock', async () => {
    await band(sequence('2025-01-10T20:30:00Z'));
    expect(container.querySelector('.auction-band__facts')!.textContent).toContain('CLOSE');
    expect(container.querySelector('rect[fill-opacity="0.25"]')).not.toBeNull();
    expect(container.textContent).toContain('shaded: after the recorded end');
    expect(container.textContent).toContain('● last observed bid');
  });

  it.each([
    ['unsold', null, 'NOT SOLD'],
    ['unsold', 'reserve_not_met', 'RESERVE NOT MET'],
    ['unsold', 'sold', 'RESULT UNKNOWN'],
  ])('renders %s with canonical %s without promoting it to sold', async (status, outcome, expected) => {
    await band(sequence(null, null, status, outcome));
    expect(container.textContent).toContain(expected);
    if (expected === 'RESULT UNKNOWN') expect(container.textContent).toContain('recorded outcomes disagree');
  });

  it.each([
    [null, null, null],
    ['2025-01-12T00:00:00Z', null, 'Auction end day recorded'],
    [null, '2025-01-12T20:30:00Z', 'Sale recorded'],
    ['2025-01-12T20:30:00Z', null, 'Auction Closed'],
  ])('uses qualified end/sale labels in the actual barcode day titles', async (end, sale, expected) => {
    fixture.auction = sequence(end, sale);
    await act(async () => root.render(<BarcodeTimeline />));
    expect(container.querySelector('.barcode-strip')).not.toBeNull();
    const titles = [...container.querySelectorAll('.hm-c[title]')].map(el => el.getAttribute('title')).join('\n');
    expect(titles).toContain('Profile Created');
    if (expected) expect(container.querySelector('.hm-c[data-date="2025-01-12"]')!.getAttribute('title')).toContain(expected);
    if (expected !== 'Auction Closed') expect(titles).not.toContain('Auction Closed');
  });

  it.each([
    [null, 'First observed auction activity'],
    ['2025-01-08T00:00:00Z', 'Listing day recorded'],
    ['2025-01-08T14:00:00Z', 'Auction Opened'],
  ])('qualifies the actual barcode opening title from recorded start %s', async (start, expected) => {
    fixture.auction = sequence(null, null, 'sold', null, start);
    await act(async () => root.render(<BarcodeTimeline />));
    const titles = [...container.querySelectorAll('.hm-c[title]')].map(el => el.getAttribute('title')).join('\n');
    expect(titles).toContain(expected);
    if (expected !== 'Auction Opened') expect(titles).not.toContain('Auction Opened');
    if (start?.includes('T00:00:00')) expect(container.querySelector('.hm-c[data-date="2025-01-08"]')!.getAttribute('title')).toContain(expected);
  });
});

it('shows a failed native read as unavailable activity, without zero totals or an unextracted claim', async()=>{
  fixture.activityUnavailable=true;
  await act(async()=>root.render(<BarcodeTimeline />));
  expect(container.querySelector('[role="status"]')?.textContent).toContain('Auction activity could not be fully read');
  expect(container.textContent).toContain('Timeline activity counts are unavailable');
  expect(container.textContent).not.toContain('0 bids');
  expect(container.textContent).not.toContain('bids and comments not extracted yet');
});

it('distinguishes retained unclocked testimony from missing extraction', async()=>{
  fixture.hasUnpositionedActivity=true;
  fixture.auction={...sequence('2025-01-10T20:30:00Z',null,'sold',null,'2025-01-01T12:00:00Z'),items:[],days:[],lastObservedBid:null,activityExtracted:false};
  await act(async()=>root.render(<BarcodeTimeline />));
  expect(container.textContent).toContain('lack usable posting times');
  expect(container.textContent).toContain('no timed bid or comment entries in this read');
  expect(container.textContent).not.toContain('bids and comments not extracted yet');
});
