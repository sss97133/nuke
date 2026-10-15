// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ query: {} as any, activity: {} as any, book: null as any, finish: undefined as any }));
vi.mock('../../hooks/useAuctionComments', () => ({ EPISODE_READ_LIMIT: 100, useAuctionEpisode: () => fixture.query }));
vi.mock('../stacks/orderBookReader', async importOriginal => ({ ...await importOriginal<any>(), useBidBook: () => ({ data: fixture.book }) }));
vi.mock('./useLotMovement', () => ({ useLotMovement: () => fixture.activity }));
vi.mock('./useFinishEstimates', () => ({ useFinishAnalogs: () => ({ data: fixture.finish }) }));
vi.mock('../../components/PrefetchLink', () => ({ PrefetchLink: ({ to, ...p }: any) => <a href={to} {...p} /> }));
import AuctionEvidence, { AuctionCompetition } from './AuctionEvidence';
let root: Root, container: HTMLDivElement;
const id = '46dd9cc6-20ec-47cb-a563-159a8005115c';
const source = 'https://bringatrailer.com/listing/1937-packard-115c-convertible-8/';
function row(id: string, type: string, at: string | null, extra = {}) {
  return { id, comment_type: type, posted_at: at, comment_text: null, bid_amount: null, media_urls: null,
    is_seller: false, bat_comment_id: 123, source_url: source, ...extra };
}
async function render() { await act(async () => root.render(<AuctionEvidence vehicleId={id} onClose={() => {}} />)); }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.query = { data: { vehicle: { id, title: 'Public source case' }, sourceUrl: source, fetchedAt: '2026-10-04T17:00:00Z',
    truncated: false, specs: [{ field: 'transmission', label: 'Transmission', value: null, reported_value: '700R4',
      source_observation_id: id, reported_conflict: true }], interactions: [
      row('b2', 'bid', '2026-10-04T11:00:00Z', { bid_amount: 2000 }),
      row('seller', 'seller_response', '2026-10-04T10:30:00Z', { media_urls: ['https://example.com/video.mp4', 'javascript:alert(1)'] }),
      row('q1', 'question', '2026-10-04T10:20:00Z', { comment_text: 'Which component is leaking?' }),
      row('b1', 'bid', '2026-10-04T10:00:00Z', { bid_amount: 1000 }),
      row('unknown-date', 'bid', null, { bid_amount: 500 }),
    ] } };
  fixture.book = null;
  fixture.activity = { coverage: { lots: [] } };
  fixture.finish = undefined;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it('draws only dated source bids, preserves unknown/conflict and links the selected bid', async () => {
  await render();
  expect(container.querySelectorAll('svg [role="button"]')).toHaveLength(2);
  expect(container.textContent).toContain('Canonical unknown');
  expect(container.textContent).toContain('Reported: 700R4');
  expect(container.textContent).toContain('Conflicting reports');
  expect(container.textContent).not.toMatch(/Running hot|Running cold|fair value|[0-9]×/);
  await act(async () => container.querySelector('svg [role="button"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(container.querySelector('.auction-evidence-event')?.textContent).toContain('1,000');
  expect(container.querySelector('.auction-evidence-event a')?.getAttribute('href')).toBe(source + '#comment-123');
});
it('keeps chronological multi-part questions and empty-text media replies without inventing a pair or stance', async () => {
  await render();
  const articles = [...container.querySelectorAll('article')];
  expect(articles[0].textContent).toContain('Which component is leaking?');
  expect(articles[1].textContent).toContain('Seller statement');
  expect(articles[1].querySelector('.auction-evidence-media')?.getAttribute('href')).toBe('https://example.com/video.mp4');
  expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  expect(container.textContent).toContain('adjacent statements are not automatically an answer pair');
  expect(container.textContent).toContain('No measured commentary score yet');
});
it('separates source capture from browser response and refuses completeness from a full read', async () => {
  fixture.activity.coverage.lots = [{ vehicle_id: id, source_url: source, source_read_at: '2026-10-03T10:00:00Z', source_read_basis: 'cached_snapshot' }];
  fixture.query.data.truncated = true;
  await render();
  expect(container.textContent).toContain('Earlier interactions omitted by the limit');
  const times = [...container.querySelectorAll('.auction-evidence-receipt time')].map(t => t.getAttribute('datetime'));
  expect(times).toEqual(['2026-10-04T17:00:00Z', '2026-10-03T10:00:00Z']);
  expect(container.textContent).toContain('cached snapshot');
});
it('does not lend a newer listing clock to another episode on the same vehicle', async () => {
  fixture.activity.coverage.lots = [{ vehicle_id: id, source_url: 'https://bringatrailer.com/listing/another-episode/',
    source_read_at: '2026-10-03T10:00:00Z', source_read_basis: 'direct_fetch' }];
  await render();
  expect(container.querySelectorAll('.auction-evidence-receipt time')).toHaveLength(1);
  expect(container.textContent).toContain('Listing-page read time unavailable');
});
it('exposes reported disagreement with a populated canonical field and identifies a missing source anchor', async () => {
  fixture.query.data.specs[0].value = 'Canonical transmission';
  fixture.query.data.interactions[3].bat_comment_id = null;
  await render();
  expect(container.textContent).toContain('Canonical transmission');
  expect(container.textContent).toContain('Reported: 700R4');
  const buttons = container.querySelectorAll('svg [role="button"]');
  expect([...buttons].filter(b => b.getAttribute('tabindex') === '0')).toHaveLength(1);
  await act(async () => buttons[0].dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(container.querySelector('.auction-evidence-event a')?.textContent).toContain('event anchor unavailable');
  expect(container.querySelector('.auction-evidence-event a')?.getAttribute('href')).toBe(source);
});
it('handles denial, empty, loading and failed reads explicitly', async () => {
  fixture.query = { data: null }; await render();
  expect(container.textContent).toContain('No publicly readable BaT vehicle listing');
  expect(container.querySelector('svg')).toBeNull();
  fixture.query = { isPending: true }; await render(); expect(container.textContent).toContain('Reading listing evidence');
  fixture.query = { isError: true }; await render(); expect(container.textContent).toContain('could not be read');
  fixture.query = { data: { vehicle: { id, title: 'Empty public case' }, sourceUrl: source, specs: [], interactions: [] } };
  await render(); expect(container.textContent).toContain('No dated bids'); expect(container.textContent).toContain('Capture completeness unknown');
});
it('connects recorded identity to sale context with subject exclusion, without lending the bid units', async () => {
  fixture.query.data.vehicle = { id, title: 'Public source case', year: 1937, make: 'Packard', model: 'Series 115-C Convertible Coupe', high_bid: 45000 };
  await render();
  const link = container.querySelector<HTMLAnchorElement>('a[href^="/valuation?"]')!;
  const params = new URL(link.href).searchParams;
  expect(params.get('year')).toBe('1937');
  expect(params.get('make')).toBe('Packard');
  expect(params.get('model')).toBe('Series 115-C Convertible Coupe');
  expect(params.get('vehicle_id')).toBe(id);
  expect(params.has('price')).toBe(false);
  expect(params.has('currency')).toBe(false);
});

it('opens one panel that adds only what the row cannot say, with the venue link where a reader looks', async () => {
  const scroll = vi.fn(); const previous = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = scroll;
  fixture.query.data.vehicle = { id, year: 1937, make: 'Packard', model: '115-C', title: 'Promotional source headline' };
  fixture.query.data.specs = [
    { field: 'transmission', label: 'Transmission', value: '3-speed manual', reported_value: null, rooted: true },
    { field: 'mileage', label: 'Mileage', value: 64000, reported_value: null },
    { field: 'vin', label: 'VIN', value: 'C123456', reported_value: null },
  ];
  try {
    await act(async () => root.render(<AuctionEvidence vehicleId={id} compact onClose={() => {}}
      summary={{ id, location: 'CA · 90210', bidCount: 2, watchers: 432 } as any} />));
    const panel = container.querySelector('section')!;
    expect(panel.id).toBe(`lot-inspection-${id}`);
    expect(panel.querySelectorAll('nav button')).toHaveLength(0);
    expect(panel.querySelector('a[href^="https://bringatrailer.com"]')?.getAttribute('href')).toBe(source);
    expect(panel.querySelector('.market-inspection-counts')?.textContent).toBe('2 bids432 watching');
    // The bids are drawn once, and not again as a table.
    expect(panel.querySelectorAll('svg [role="button"]')).toHaveLength(2);
    expect(panel.querySelector('table')).toBeNull();
    expect(panel.textContent).toContain('Which component is leaking?');
    expect(panel.textContent).toContain('Posted photos or video.');
    expect(panel.textContent).toContain('64,000');
    expect(panel.textContent).toContain('C123456');
    expect(panel.textContent).toContain('CA · 90210');
    // The row already says the name and its facts; the source headline and the read's disclaimers are not news.
    expect(panel.textContent).not.toContain('3-speed manual');
    expect(panel.textContent).not.toContain('1937 Packard 115-C');
    expect(panel.textContent).not.toContain('Promotional source headline');
    expect(panel.textContent).not.toMatch(/Retained high|within 10%|Leader’s margin|Bid coverage|Capture completeness|Source read/);
    expect(scroll).not.toHaveBeenCalled();
  } finally { HTMLElement.prototype.scrollIntoView = previous; }
});

it.each([false, true])('keeps reported bids when dated bid evidence is missing (truncated: %s)', async truncated => {
  fixture.query.data.truncated = truncated;
  fixture.query.data.interactions = truncated ? [row('undated-bid', 'bid', null, { bid_amount: 2000 })] : [];
  await act(async () => root.render(<AuctionEvidence vehicleId={id} sourceUrl={source} compact onClose={() => {}}
    summary={{ id, bidCount: 23 } as any} />));
  expect(container.querySelector('.market-inspection-counts')?.textContent).toBe('23 bids');
  expect(container.textContent).toContain('No dated bids in this retained window.');
  expect(container.textContent).not.toContain('No bids yet');
  expect(container.querySelector('svg')).toBeNull();
  expect(container.textContent?.includes('Earlier interactions omitted by the limit.')).toBe(truncated);
  expect(container.querySelector('a[href^="https://bringatrailer.com"]')?.getAttribute('href')).toBe(source);
});

it('identifies a partial bid chart when the complete bid book has no retained bids', async () => {
  fixture.query.data.truncated = true;
  fixture.book = { vehicle: { id }, lot: { source_url: source }, bids: [] };
  await act(async () => root.render(<AuctionEvidence vehicleId={id} sourceUrl={source} compact onClose={() => {}}
    summary={{ id, bidCount: 23 } as any} />));
  expect(container.querySelector('.market-inspection-counts')?.textContent).toBe('23 bids');
  expect(container.querySelectorAll('svg [role="button"]')).toHaveLength(2);
  expect(container.textContent).toContain('Earlier interactions omitted by the limit.');
  expect(container.textContent).not.toContain('No bids yet');
});

it('draws every bid the bid book holds, not only the newest interactions', async () => {
  fixture.query.data.truncated = true;
  fixture.book = {
    vehicle: { id }, lot: { id: 'lot', source_url: source, auction_end_date: '2026-10-05T12:00:00Z', total_bids: 4, updated_at: '2026-10-04T11:30:00Z' },
    readAt: '2026-10-04T11:30:00Z', bids: [
      row('early-1', 'bid', '2026-10-01T10:00:00Z', { bid_amount: 100 }),
      row('early-2', 'bid', '2026-10-02T10:00:00Z', { bid_amount: 400 }),
      row('b1', 'bid', '2026-10-04T10:00:00Z', { bid_amount: 1000 }),
      row('b2', 'bid', '2026-10-04T11:00:00Z', { bid_amount: 2000 }),
    ],
  };
  await act(async () => root.render(<AuctionEvidence vehicleId={id} sourceUrl={source} compact onClose={() => {}} />));
  // The episode read holds two dated bids; the book holds four, and the chart draws the four.
  expect(container.querySelectorAll('svg [role="button"]')).toHaveLength(4);
  expect(container.querySelector('.auction-evidence-chart-heading')?.textContent).toContain('4');
  expect(container.textContent).not.toContain('Earlier interactions omitted by the limit.');
  // The latest bid is the highlighted point by default.
  expect(container.querySelector('svg [aria-pressed="true"]')?.getAttribute('aria-label')).toContain('$2,000');
});

it('opens with where the lot should finish: estimate, range, measured confidence and the past lots it rests on', async () => {
  fixture.finish = { board: { fresh: true, writerAt: null, byId: new Map([[id, { vehicleId: id, estimate: 33000, low: 25500, high: 45100,
    grade: 'A', coverage: 0.775, sentence: '8 in 10 cars like this finished inside this range. Half finished within 15%.',
    estimatedAt: Date.now() - 10 * 60_000, bidAtEstimate: 25000, compsThrough: '2026-09-27' }]]) },
    analogs: [{ url: 'https://bringatrailer.com/listing/1965-ford-mustang-convertible-55/', title: '1965 Ford Mustang Convertible A-Code',
      closed: '2026-02-22', bid: 25000, final: 38250, outcome: 'sold' },
      { url: null, title: '1966 Ford Mustang GT Coupe', closed: '2026-09-26', bid: 21000, final: 21500, outcome: 'reserve_not_met' }] };
  await act(async () => root.render(<AuctionEvidence vehicleId={id} sourceUrl={source} compact onClose={() => {}} />));
  const block = container.querySelector('[aria-label="Where it should finish"]')!;
  expect(block.textContent).toContain('$33,000');
  expect(block.textContent).toContain('80% range $25,500–$45,100');
  expect(block.textContent).toContain('8 in 10 cars like this finished inside this range');
  expect(block.querySelector('a[href^="https://bringatrailer.com/listing/"]')?.textContent).toBe('1965 Ford Mustang Convertible A-Code');
  expect(block.textContent).toContain('bid $25,000 at this point · finished $38,250');
  expect(block.textContent).toContain('high bid $21,500');
  expect(block.textContent).toContain('Comparable sales through Sep 27, 2026');
  expect(block.textContent).toContain('estimated 10 min ago at a $25,000 bid');
});
it('says nothing about the finish when there is no estimate', async () => {
  await act(async () => root.render(<AuctionEvidence vehicleId={id} sourceUrl={source} compact onClose={() => {}} />));
  expect(container.querySelector('[aria-label="Where it should finish"]')).toBeNull();
});

it('preserves the row owner focus when compact inspection effects replay', async () => {
  const tile = document.createElement('button');
  const vehicle = document.createElement('button');
  document.body.append(tile, vehicle); tile.focus();
  function Owner() {
    const reveal = React.useRef(true);
    React.useEffect(() => {
      if (reveal.current) { vehicle.focus(); reveal.current = false; }
    }, []);
    return <AuctionEvidence vehicleId={id} compact onClose={() => {}} />;
  }
  try {
    await act(async () => root.render(<React.StrictMode><Owner /></React.StrictMode>));
    expect(document.activeElement).toBe(vehicle);
  } finally {
    await act(async () => root.render(null));
    tile.remove(); vehicle.remove();
  }
});


it('adds the pace of bidding to the board bid in the row, from Stack A, and nothing else', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
  try {
    fixture.book = {
      vehicle: { id }, lot: { id: 'lot', source_url: source, auction_end_date: '2026-10-04T12:00:00Z', total_bids: 3, updated_at: '2026-10-04T11:30:00Z' },
      readAt: '2026-10-04T11:30:00Z', bids: [
        row('one', 'bid', '2026-10-04T10:00:00Z', { bid_amount: 500, external_identity_id: id, bat_comment_id: 1 }),
        row('two', 'bid', '2026-10-04T10:30:00Z', { bid_amount: 900, external_identity_id: '00000000-0000-4000-8000-000000000002', bat_comment_id: 2 }),
        row('three', 'bid', '2026-10-04T11:00:00Z', { bid_amount: 1000, external_identity_id: id, bat_comment_id: 3 }),
      ],
    };
    await act(async () => root.render(<AuctionCompetition vehicleId={id} sourceUrl={source} row fallback={<span>Recorded bid 800</span>} />));
    expect(container.textContent).toBe('Recorded bid 800bid 1 h ago · +11.1%');
    expect(container.textContent).not.toMatch(/Retained high|bidders|within 10%|reported bids held|Bid depth/);
    expect(container.querySelector('a')).toBeNull();
    fixture.book = null;
    await act(async () => root.render(<AuctionCompetition vehicleId={id} sourceUrl={source} row fallback={<span>Recorded bid 800</span>} />));
    expect(container.textContent).toBe('Recorded bid 800');
  } finally { vi.useRealTimers(); }
});
