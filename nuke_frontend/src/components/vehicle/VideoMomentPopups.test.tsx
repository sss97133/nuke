// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  videos: [] as unknown[], vehicle: null as unknown, metadataError: null as unknown,
  videoRead: null as null | ((vehicleId: unknown) => Promise<{ data: unknown[]; error: null }>),
  historyRows: [] as unknown[], historyError: null as unknown,
  historyRead: null as null | ((source: unknown, lot: unknown) => Promise<{ data: unknown[]; error: null }>),
  queries: [] as { table: string; columns: string; filters: unknown[][] }[],
}));
vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn((table: string) => {
  const query = { table, columns: '', filters: [] as unknown[][] };
  fixture.queries.push(query);
  const builder = {
    select: (columns: string) => { query.columns = columns; return builder; },
    eq: (...args: unknown[]) => { query.filters.push(['eq', ...args]); return builder; },
    is: (...args: unknown[]) => { query.filters.push(['is', ...args]); return builder; },
    or: (...args: unknown[]) => { query.filters.push(['or', ...args]); return builder; },
    not: (...args: unknown[]) => { query.filters.push(['not', ...args]); return builder; },
    order: () => {
      const lot = query.filters.find(filter => filter[0] === 'eq' && filter[1] === 'lot_number')?.[2];
      const source = query.filters.find(filter => filter[0] === 'eq' && filter[1] === 'source')?.[2];
      const result = lot ? fixture.historyRead?.(source, lot)
        ?? Promise.resolve({ data: fixture.historyRows, error: fixture.historyError })
        : fixture.videoRead?.(query.filters.find(filter => filter[0] === 'eq' && filter[1] === 'vehicle_id')?.[2])
        ?? Promise.resolve({ data: fixture.videos, error: null });
      return Object.assign(result, { limit: () => result });
    },
    maybeSingle: () => Promise.resolve({ data: fixture.vehicle, error: fixture.metadataError }),
  };
  return builder;
}) } }));
import { PriceBreakdownPopup, LotStatsPopup } from './VideoMomentPopups';
import { VehicleVideoSection } from './VehicleVideoSection';

const subject = '00000000-0000-4000-8000-000000000001';
const sourceUrl = 'https://example.com/lots/recorded-episode/';
const video = {
  id: '00000000-0000-4000-8000-000000000002', vehicle_id: subject,
  source: 'recorded-house', source_url: sourceUrl, lot_number: 'LOT-1', auction_name: null,
  auction_start_date: '2025-06-01', winning_bid: 100000, outcome: 'sold',
  estimate_low: 90000, estimate_high: 110000,
  broadcast_video_url: 'https://www.youtube.com/watch?v=abcdefghijk',
  broadcast_timestamp_start: 65, broadcast_timestamp_end: 105,
};

let container: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.videos = [video];
  fixture.videoRead = null;
  fixture.historyRows = [];
  fixture.historyError = null;
  fixture.historyRead = null;
  fixture.vehicle = { id: subject, year: 1967, make: 'Chevrolet', model: 'Corvette' };
  fixture.metadataError = null;
  fixture.queries = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
});

async function render(element: React.ReactNode) {
  await act(async () => root.render(
    <MemoryRouter><QueryClientProvider client={client}>{element}</QueryClientProvider></MemoryRouter>,
  ));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => element!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

it.each(['mecum', 'barrett_jackson', 'unrecorded-house', undefined])(
  'withholds fees and proceeds without lot-specific terms for %s', async source => {
    await render(<PriceBreakdownPopup recordedAmount={100000} source={source} onClose={() => {}} />);
    const text = document.body.textContent;
    expect(text).toContain('Recorded auction amount100,000');
    expect(text).toContain('Currency and fee basisUnknown');
    expect(text).toContain('Fees and proceedsUnrecorded');
    expect(text).not.toContain('Buyer Total');
    expect(text).not.toContain('Seller Net');
    expect(text).not.toContain('House Take');
    expect(text).not.toContain('$110,000');
    expect(text).not.toContain('$89,650');
    expect(text).not.toContain('Hammer Price');
    expect(text).not.toContain('$');
  },
);

it('preserves raw source estimates without assuming compatible units or calculating a comparison', async () => {
  await render(<PriceBreakdownPopup recordedAmount={100000} estimateLow={90000} estimateHigh={110000} onClose={() => {}} />);
  expect(document.body.textContent).toContain('Recorded estimate range90,000 – 110,000');
  expect(document.body.textContent).not.toContain('vs Estimate');
  expect(document.body.textContent).not.toContain('Within range');
  expect(document.body.textContent).toContain('Fees and proceedsUnrecorded');
});

it('carries the actual video query through clip, attributed amount and qualified-context navigation', async () => {
  await render(<VehicleVideoSection vehicleId={subject} defaultCollapsed={false} />);
  expect(container.textContent).toContain('100,000');
  expect(container.textContent).not.toContain('$');
  await click(container.querySelector('img[alt="Video thumbnail"]'));
  expect(document.querySelector('iframe')?.src).toContain('abcdefghijk?start=65');
  expect(document.body.textContent).toContain('Video offset 1:05 · recorded video span 40s');
  expect(document.body.textContent).toContain('RECORDED-HOUSE');
  await click(document.querySelector('button[title="Inspect recorded auction amount"]'));
  expect(document.body.textContent).toContain('Recorded auction amount100,000');
  expect(document.body.textContent).toContain('Currency and fee basisUnknown');
  expect(document.querySelector('a[target="_blank"]')?.getAttribute('href')).toBe(sourceUrl);
  const link = document.querySelector<HTMLAnchorElement>('a[href^="/valuation?"]')!;
  const params = new URL(link.href).searchParams;
  expect(Object.fromEntries(params)).toEqual({ year: '1967', make: 'Chevrolet', model: 'Corvette', vehicle_id: subject });
  expect(params.has('price')).toBe(false);
  expect(params.has('currency')).toBe(false);
  expect(document.body.textContent).not.toContain('COMPARABLE SALES');
  const auctionReads = fixture.queries.filter(query => query.table === 'auction_events');
  expect(auctionReads).toHaveLength(1); // The video read, with no second raw comparable-sale reader.
  expect(auctionReads[0].columns).toContain('source_url');
  expect(auctionReads[0].filters).toContainEqual(['eq', 'vehicle_id', subject]);
  const metadataRead = fixture.queries.find(query => query.table === 'vehicles')!;
  expect(metadataRead.filters).toContainEqual(['eq', 'is_public', true]);
  expect(metadataRead.filters).toContainEqual(['is', 'deleted_at', null]);
  expect(metadataRead.filters).toContainEqual(['or', 'listing_kind.is.null,listing_kind.neq.non_vehicle_item']);
});

it.each([null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
  'retains the clip but refuses a price claim for invalid recorded amount %s', async amount => {
    fixture.videos = [{ ...video, winning_bid: amount }];
    await render(<VehicleVideoSection vehicleId={subject} defaultCollapsed={false} />);
    await click(container.querySelector('img[alt="Video thumbnail"]'));
    expect(document.querySelector('iframe')).not.toBeNull();
    expect(document.querySelector('button[title="Inspect recorded auction amount"]')).toBeNull();
    expect(document.body.textContent).not.toContain('AUCTION AMOUNT');
  },
);

it('does not promote an unsold lot with a recorded number into a sale amount', async () => {
  fixture.videos = [{ ...video, outcome: 'reserve_not_met' }];
  await render(<VehicleVideoSection vehicleId={subject} defaultCollapsed={false} />);
  expect(container.textContent).not.toContain('100,000');
  await click(container.querySelector('img[alt="Video thumbnail"]'));
  expect(document.querySelector('iframe')).not.toBeNull();
  expect(document.querySelector('button[title="Inspect recorded auction amount"]')).toBeNull();
});

it('refuses a returned clip bound to a different vehicle', async () => {
  fixture.videos = [{ ...video, vehicle_id: 'another-vehicle' }];
  await render(<VehicleVideoSection vehicleId={subject} defaultCollapsed={false} />);
  expect(container.textContent).not.toContain('VIDEO MOMENTS');
  expect(container.querySelector('img')).toBeNull();
});

it('clears an open clip and amount when the same component changes vehicle, including deferred and cached reads', async () => {
  const otherSubject = '00000000-0000-4000-8000-000000000003';
  const otherVideo = { ...video, id: 'episode-b', vehicle_id: otherSubject, winning_bid: 200000,
    broadcast_video_url: 'https://www.youtube.com/watch?v=lmnopqrstuv' };
  let releaseOther!: (value: { data: unknown[]; error: null }) => void;
  const pendingOther = new Promise<{ data: unknown[]; error: null }>(resolve => { releaseOther = resolve; });
  fixture.videoRead = id => id === otherSubject ? pendingOther : Promise.resolve({ data: [video], error: null });
  await render(<VehicleVideoSection vehicleId={subject} defaultCollapsed={false} />);
  await click(container.querySelector('img[alt="Video thumbnail"]'));
  await click(document.querySelector('button[title="Inspect recorded auction amount"]'));
  expect(document.body.textContent).toContain('Recorded auction amount100,000');

  await render(<VehicleVideoSection vehicleId={otherSubject} defaultCollapsed={false} />);
  expect(document.querySelector('iframe')).toBeNull();
  await act(async () => releaseOther({ data: [otherVideo], error: null }));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(container.textContent).toContain('200,000');
  expect(document.querySelector('iframe')).toBeNull();
  expect(document.body.textContent).not.toContain('Recorded auction amount100,000');
  expect(document.querySelector('a[href^="/valuation?"]')).toBeNull();

  // Returning to an already-cached subject still needs a new deliberate clip selection.
  await render(<VehicleVideoSection vehicleId={subject} defaultCollapsed={false} />);
  expect(container.textContent).toContain('100,000');
  expect(document.querySelector('iframe')).toBeNull();
  await render(<VehicleVideoSection vehicleId={otherSubject} defaultCollapsed={false} />);
  fixture.vehicle = { id: otherSubject, year: 1968, make: 'Chevrolet', model: 'Camaro' };
  await click(container.querySelector('img[alt="Video thumbnail"]'));
  expect(document.querySelector('iframe')?.src).toContain('lmnopqrstuv');
  await click(document.querySelector('button[title="Inspect recorded auction amount"]'));
  expect(document.body.textContent).toContain('Recorded auction amount200,000');
  const context = document.querySelector<HTMLAnchorElement>('a[href^="/valuation?"]')!;
  expect(new URL(context.href).searchParams.get('vehicle_id')).toBe(otherSubject);
});

it.each(['denied', 'error', 'wrong-subject', 'missing-model'])(
  'keeps the recorded amount while withholding sale-context navigation for %s metadata', async state => {
    if (state === 'denied') fixture.vehicle = null;
    if (state === 'error') fixture.metadataError = new Error('metadata unavailable');
    if (state === 'wrong-subject') fixture.vehicle = { id: 'another-vehicle', year: 1967, make: 'Chevrolet', model: 'Corvette' };
    if (state === 'missing-model') fixture.vehicle = { id: subject, year: 1967, make: 'Chevrolet', model: '' };
    await render(<PriceBreakdownPopup recordedAmount={100000} source="recorded-house" vehicleId={subject} onClose={() => {}} />);
    expect(document.body.textContent).toContain('Recorded auction amount100,000');
    expect(document.querySelector('a[href^="/valuation?"]')).toBeNull();
  },
);

it('withholds an unsafe source locator without discarding the attributed amount', async () => {
  await render(<PriceBreakdownPopup recordedAmount={100000} source="recorded-house" lotNumber="LOT-1"
    sourceUrl="javascript:alert(1)" onClose={() => {}} />);
  expect(document.body.textContent).toContain('RECORDED-HOUSE · Lot LOT-1');
  expect(document.querySelector('a[target="_blank"]')).toBeNull();
  expect(document.body.textContent).toContain('Recorded auction amount100,000');
});

function button(text: string) {
  return [...document.querySelectorAll('button')].find(element => element.textContent === text) ?? null;
}
async function openLot() {
  await click(container.querySelector('img[alt="Video thumbnail"]'));
  await click(document.querySelector('button[title="View lot statistics"]'));
}

it('keeps the witnessed 7960-to-8043 video markers without turning F308 into wall time or placement', async () => {
  fixture.videos = [{ ...video, source: 'mecum', lot_number: 'F308',
    broadcast_timestamp_start: 7960, broadcast_timestamp_end: 8043 }];
  await render(<VehicleVideoSection vehicleId={subject} defaultCollapsed={false} />);
  expect(container.textContent).toContain('Recorded video span: 1m 23s');
  expect(container.textContent).not.toContain('on block');
  await openLot();
  expect(document.querySelector('iframe')?.src).toContain('start=7960&');
  expect(document.body.textContent).toContain('2:12:40');
  expect(document.body.textContent).toContain('RECORDED LOT LABELF308');
  expect(document.body.textContent).toContain('1m 23sRecorded video span');
  expect(document.body.textContent).not.toContain('Broadcast time');
  expect(document.body.textContent).not.toContain('HOUR 2 PERFORMANCE');
  expect(document.body.textContent).not.toContain('High-value consignments');
  expect(button('Time Slots')).toBeNull();
  // No unsupported hourly RPC/fallback or eager history read; the broadcast-overlay clip read is separate.
  expect(fixture.queries.filter(query => query.table !== 'vehicle_observations')).toHaveLength(1);
});

it.each([null, undefined, -1, 7959, Number.NaN, Number.POSITIVE_INFINITY])(
  'retains a valid video seek while refusing an invented span for end %s', async end => {
    fixture.videos = [{ ...video, broadcast_timestamp_start: 7960, broadcast_timestamp_end: end }];
    await render(<VehicleVideoSection vehicleId={subject} defaultCollapsed={false} />);
    expect(container.textContent).toContain('Recorded video span: Unknown');
    expect(container.textContent).not.toContain('1m on block');
    await openLot();
    expect(document.querySelector('iframe')?.src).toContain('start=7960&');
    expect(document.body.textContent).toContain('UnknownRecorded video span');
    expect(document.body.textContent).not.toContain('60s');
  },
);

it('keeps explicit zero markers instead of treating zero as a missing end', async () => {
  fixture.videos = [{ ...video, broadcast_timestamp_start: 0, broadcast_timestamp_end: 0 }];
  await render(<VehicleVideoSection vehicleId={subject} defaultCollapsed={false} />);
  expect(container.textContent).toContain('Recorded video span: 0s');
  await openLot();
  expect(document.querySelector('iframe')?.src).toContain('start=0&');
  expect(document.body.textContent).toContain('0:00Offset into video');
});

it.each([null, -1, Number.NaN, Number.POSITIVE_INFINITY])(
  'retains the source video without fabricating a seek or span for start %s', async start => {
    fixture.videos = [{ ...video, broadcast_timestamp_start: start }];
    await render(<VehicleVideoSection vehicleId={subject} defaultCollapsed={false} />);
    await openLot();
    expect(document.querySelector('iframe')?.src).toContain('abcdefghijk?autoplay=1');
    expect(document.querySelector('iframe')?.src).not.toContain('start=');
    expect(document.body.textContent).toContain('UnknownOffset into video');
    expect(document.body.textContent).toContain('UnknownRecorded video span');
  },
);

it.each(['S114', 'F308', 'T12', 'K999', 'F308.1', 'ABC.99'])(
  'retains exact lot label %s without decoding a day, stage or suffix meaning', async lot => {
    await render(<LotStatsPopup lotNumber={lot} source="mecum" videoOffset="2:12:40" videoSpan="1m 23s" onClose={() => {}} />);
    expect(document.body.textContent).toContain(`RECORDED LOT LABEL${lot}`);
    expect(document.body.textContent).not.toContain('Premium placement');
    expect(document.body.textContent).not.toContain('High-value consignments');
    expect(document.body.textContent).not.toContain('Tent/Secondary');
    expect(document.body.textContent).not.toContain('Kissimmee Special');
    expect(document.body.textContent).not.toContain('Sub-lot (additional vehicle');
  },
);

const historyVehicle = '00000000-0000-4000-8000-000000000004';
const historyRow = {
  id: 'historical-episode', vehicle_id: historyVehicle, source: 'recorded-house', lot_number: 'LOT-1',
  source_url: 'https://example.com/lots/historical-episode/', auction_start_date: null,
  winning_bid: 25000, outcome: 'reserve_not_met',
  vehicles: { id: historyVehicle, year: 1970, make: 'Ford', model: 'Coupe',
    is_public: true, deleted_at: null, listing_kind: null },
};

it('reads bounded public matching lot labels with real columns and source locators, without dollar or identity inference', async () => {
  fixture.historyRows = [historyRow];
  await render(<VehicleVideoSection vehicleId={subject} defaultCollapsed={false} />);
  await openLot();
  await click(button('Matching labels'));
  expect(document.body.textContent).toContain('1970 Ford Coupe');
  expect(document.body.textContent).toContain('Recorded amount 25,000 · currency and fee basis unknown');
  expect(document.body.textContent).toContain('Open date unknown');
  expect(document.body.textContent).not.toContain('$25,000');
  expect(document.querySelector('a[href="https://example.com/lots/historical-episode/"]')).not.toBeNull();
  const read = fixture.queries.find(query => query.columns.includes('vehicles!inner'))!;
  expect(read.columns).not.toContain('auction_name');
  expect(read.filters).toContainEqual(['eq', 'source', 'recorded-house']);
  expect(read.filters).toContainEqual(['eq', 'lot_number', 'LOT-1']);
  expect(read.filters).toContainEqual(['eq', 'vehicles.is_public', true]);
  expect(read.filters).toContainEqual(['is', 'vehicles.deleted_at', null]);
  expect(read.filters).toContainEqual(['or', 'listing_kind.is.null,listing_kind.neq.non_vehicle_item', { referencedTable: 'vehicles' }]);
});

it('refuses wrong-source/label and private/deleted/nonvehicle/mismatched parent history rows', async () => {
  fixture.historyRows = [
    { ...historyRow, source: 'different-house' }, { ...historyRow, lot_number: 'another-lot' },
    ...[{ is_public: false }, { deleted_at: '2025-01-01' }, { listing_kind: 'non_vehicle_item' }, { id: 'another-parent' }]
      .map(override => ({ ...historyRow, vehicles: { ...historyRow.vehicles, ...override } })),
  ];
  await render(<LotStatsPopup lotNumber="LOT-1" source="recorded-house" videoOffset="1:05" videoSpan="40s" onClose={() => {}} />);
  await click(button('Matching labels'));
  expect(document.body.textContent).toContain('No matching public lot records returned');
  expect(document.body.textContent).not.toContain('1970 Ford Coupe');
});

it('distinguishes failed history from an empty successful read', async () => {
  fixture.historyError = new Error('read unavailable');
  await render(<LotStatsPopup lotNumber="LOT-1" source="recorded-house" videoOffset="1:05" videoSpan="40s" onClose={() => {}} />);
  await click(button('Matching labels'));
  expect(document.body.textContent).toContain('Matching lot records could not be read');
  expect(document.body.textContent).not.toContain('No matching public lot records returned');
});

it('keeps same-instance matching-label history bound through pending, changed-source and late responses', async () => {
  let releaseOld!: (value: { data: unknown[]; error: null }) => void;
  const oldRead = new Promise<{ data: unknown[]; error: null }>(resolve => { releaseOld = resolve; });
  const newRow = { ...historyRow, id: 'new-episode', source: 'new-house', lot_number: 'NEW',
    vehicles: { ...historyRow.vehicles, model: 'New public model' } };
  fixture.historyRead = source => source === 'recorded-house' ? oldRead : Promise.resolve({ data: [newRow], error: null });
  await render(<LotStatsPopup lotNumber="LOT-1" source="recorded-house" videoOffset="1:05" videoSpan="40s" onClose={() => {}} />);
  await click(button('Matching labels'));
  expect(document.body.textContent).toContain('Reading matching lot labels');
  await render(<LotStatsPopup lotNumber="NEW" source="new-house" videoOffset="2:12:40" videoSpan="Unknown" onClose={() => {}} />);
  expect(document.body.textContent).toContain('New public model');
  await act(async () => releaseOld({ data: [historyRow], error: null }));
  expect(document.body.textContent).toContain('New public model');
  expect(document.body.textContent).not.toContain('1970 Ford Coupe');
});
