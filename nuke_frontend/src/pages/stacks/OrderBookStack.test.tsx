// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ query: {} as Record<string, unknown>, temperature: {} as Record<string, unknown>, bid: null as null | ((request: import('./bidPathReader').BidPathRequest) => unknown), bidState: {} as Record<string,unknown>, metadataArgs: [] as unknown[] }));
vi.mock('./orderBookReader', async (importActual) => ({
  ...(await importActual<typeof import('./orderBookReader')>()),
  useOrderBook: (vehicle:string,lot:string|null) => {fixture.metadataArgs=[vehicle,lot];return fixture.query;},
}));
vi.mock('../market/useLiveLotTemperature', () => ({ useLiveLotTemperature: () => fixture.temperature }));
vi.mock('../../components/PrefetchLink', () => ({
  PrefetchLink: ({ to, ...p }: { to: string } & Record<string, unknown>) => <a href={to} {...p} />,
}));
vi.mock('./bidPopulationReader', () => ({useBidStudy:() => ({isPending:true})}));
vi.mock('./bidPathReader', async importActual => ({...(await importActual<typeof import('./bidPathReader')>()),useBidPath: (_v:string,_l:string,request:import('./bidPathReader').BidPathRequest|null) => ({data:request?fixture.bid?.(request):undefined,...fixture.bidState})}));
vi.mock('./CommentMeasurements',()=>({default:({embedded}:{embedded:boolean})=><section data-comment-embedded={String(embedded)}>SQL comment measurements</section>}));
import { bidFixture, bidId, BID_LOT, BID_A, BID_B, BID_CLOSE, BID_SOURCE } from './__fixtures__/bidPath';
import OrderBookStack from './OrderBookStack';
import type { CommentRow, OrderBookRead } from './orderBookReader';

const VEHICLE = '00000000-0000-4000-8000-000000000001';
const LOT = BID_LOT;
const ID_A = BID_A;
const ID_B = BID_B;
const CLOSE = Date.parse(BID_CLOSE);
const URL = BID_SOURCE;
const at = (minutes: number) => new Date(CLOSE - minutes * 60_000).toISOString();
let n = 0;
function row(changes: Partial<CommentRow>): CommentRow {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, posted_at: at(600), created_at: at(500), comment_type: 'observation',
    bid_amount: null, author_username: 'synthetic', external_identity_id: null, is_seller: false, bat_comment_id: 100 + n,
    source_url: `${URL}/`, comment_text: 'A synthetic comment', ...changes,
  };
}
function read(changes: Partial<OrderBookRead> = {}): OrderBookRead {
  const lot = {
    id: LOT, source: 'bat', source_url: URL, lot_number: '1', outcome: 'sold', auction_end_date: new Date(CLOSE).toISOString(),
    high_bid: 300, winning_bid: 300, total_bids: 3, seller_name: 'seller-text', seller_external_identity_id: null,
    winning_bidder: 'bidder-a', winning_bidder_external_identity_id: ID_A, updated_at: at(-5),
  };
  return {
    vehicle: { id: VEHICLE, year: 2000, make: 'Synthetic', model: 'Coupe', listing_url: URL, sale_status: 'sold' },
    lots: [lot], lot,
    comments: [
      row({ comment_type: 'bid', bid_amount: 100, posted_at: at(30), external_identity_id: ID_A }),
      row({ comment_type: 'bid', bid_amount: 200, posted_at: at(20), external_identity_id: ID_B }),
      row({ comment_type: 'bid', bid_amount: 300, posted_at: at(10), external_identity_id: ID_A }),
      row({ comment_type: 'question', posted_at: at(40), comment_text: 'Is the frame original?' }),
    ],
    unkeyedOnUrl: 0, frames: [], readAt: new Date(CLOSE + 3_600_000).toISOString(),
    identities: { [ID_A]: { id: ID_A, platform: 'bat', handle: 'bidder-a' }, [ID_B]: { id: ID_B, platform: 'bat', handle: 'bidder-b' } },
    ...changes,
  };
}

let root: Root;
let client: QueryClient;
let container: HTMLDivElement;
function LocationProbe(){return <output data-order-address>{useLocation().search}</output>;}
async function render(path = `/stacks/order-book/${VEHICLE}`) {
  await act(async () => root.render(
    <QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/stacks/order-book/:vehicleId" element={<><OrderBookStack/><LocationProbe/></>} />
      </Routes>
    </MemoryRouter></QueryClientProvider>,
  ));
}
const click = async (el: Element | null | undefined) => act(async () => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const layerButton = (name: string) => [...container.querySelectorAll('.stack-path button')].find((b) => b.textContent?.includes(name));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  n = 0;
  fixture.query = { data: read(), isPending: false, isError: false };
  fixture.temperature = { data: null, isPending: false };
  fixture.bid=request=>bidFixture(request); fixture.bidState={isError:false,isPlaceholderData:false};
  client = new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); });

it('puts coverage first, every number with its denominator, then the nine layers', async () => {
  await render();
  const coverage = container.querySelector('.stack-coverage')!;
  const path = container.querySelector('.stack-path')!;
  expect(coverage.compareDocumentPosition(path) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(container.querySelector('[data-coverage="bids_keyed"]')?.textContent).toContain('3 / 3');
  expect(container.querySelector('[data-coverage="comments_keyed"]')?.textContent).toContain('4 / 4');
  expect(container.querySelector('[data-coverage="frames"]')?.textContent).toContain('0 / 40');
  expect(container.querySelectorAll('.stack-path button')).toHaveLength(9);
  expect(container.querySelector('[data-coverage="key_conflicts"]')).toBeNull();
});

it('puts the forecast panel after the coverage block and before the nine layers, and for a closed lot makes no forecast', async () => {
  await render();
  const coverage = container.querySelector('.stack-coverage')!;
  const forecast = container.querySelector('.stack-forecast')!;
  const path = container.querySelector('.stack-path')!;
  expect(coverage.compareDocumentPosition(forecast) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(forecast.compareDocumentPosition(path) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(forecast.getAttribute('data-forecast')).toBe('closed');
  expect(forecast.textContent).toContain('Its result is in the Outcome layer.');
  expect(forecast.textContent).not.toMatch(/\$\d/);
});

it('uses SQL path and book despite contradictory current source rows, and pins selection clocks', async () => {
  await render();
  expect(container.querySelector('.stack-asof')?.textContent).toContain('5 of 5');
  expect(container.querySelector('.stack-path')?.textContent).toContain('5 SQL states');
  expect([...container.querySelectorAll('.stack-table tbody tr')].map((r) => r.textContent)).toEqual([
    expect.stringContaining('Unresolved bid entry'), expect.stringContaining('bidder-b'), expect.stringContaining('bidder-a'),
  ]);
  await click(container.querySelectorAll('svg [role="button"]')[0]);
  expect(container.querySelector('.stack-asof')?.textContent).toContain('1 of 5');
  const pinned=new URLSearchParams(container.querySelector('[data-order-address]')!.textContent!);
  expect(pinned.get('at')).toBe(bidId(0)); expect(pinned.get('bpHash')).toBe('1'.repeat(32));
  expect(pinned.get('bpRecorded')).toBe('2026-11-28T06:00:00Z');
  const rows = [...container.querySelectorAll('.stack-table tbody tr')];
  expect(rows).toHaveLength(1);
  expect(rows[0].textContent).toContain('100');
});

it('names missing layers with no number in them', async () => {
  await render();
  for (const name of ['Residual', 'Feature', 'Prediction']) {
    await click(layerButton(name));
    const missing = container.querySelector('.stack-missing')!;
    expect(missing.textContent).toContain(`Missing layer: ${name.toLowerCase()}`);
    expect(missing.textContent).not.toMatch(/[$0-9]/);
  }
});

it('shows the one-point baseline only for a live current lot, and names the missing curve either way', async () => {
  await render(`/stacks/order-book/${VEHICLE}?layer=baseline`);
  expect(container.textContent).toContain('requires established USD hammer amounts');
  expect(container.textContent).toContain('Missing layer: baseline curve');
  expect(container.textContent).not.toContain('percentile');
});

it('keeps key conflicts visible in the log and out of the fold', async () => {
  const data = read();
  data.comments.push(row({ comment_type: 'bid', bid_amount: 99_000, posted_at: at(20 * 1440), external_identity_id: ID_B }));
  fixture.query = { data, isPending: false, isError: false };
  await render(`/stacks/order-book/${VEHICLE}?layer=log`);
  expect(container.querySelector('[data-coverage="key_conflicts"]')?.textContent).toContain('1 / 5');
  expect(container.querySelector('.stack-missing')?.textContent).toContain('99,000');
  await click(layerButton('Fold'));
  expect(container.querySelector('.stack-asof')?.textContent).toContain('350');
});

it('reports the outcome as recorded and links the keyed winner', async () => {
  await render(`/stacks/order-book/${VEHICLE}?layer=outcome`);
  expect(container.textContent).toContain('300 (fee basis unestablished)');
  expect(container.querySelector(`a[href="/profile/external/${ID_A}"]`)?.textContent).toBe('bidder-a');
});

it('says what was not read instead of drawing an empty page', async () => {
  fixture.query = { data: null, isPending: false, isError: false };
  await render();
  expect(container.textContent).toContain('No public vehicle with this id');
  expect(container.querySelector('.stack-coverage')).toBeNull();
  fixture.query = { isPending: false, isError: true, refetch: () => {} };
  await render();
  expect(container.textContent).toContain('could not be read completely');
});

it.each(['query', 'internal address'])('returns to the exact source exploration expression from a %s contributor drill', async format => {
  const back = 'stack=SA&by=auction&measure=typical&make=Chevrolet&model=Corvette&from=2026&to=2026&group=lot';
  await render(`/stacks/order-book/${VEHICLE}?lot=${LOT}&back=${encodeURIComponent(format === 'query' ? back : `/stacks?${back}`)}`);
  expect(container.querySelector('.stack-eyebrow a')?.getAttribute('href')).toBe(`/stacks?${back}`);
});

it('does not turn unitless source bids into dollars or round away their fractional input', async () => {
  const data = read(); data.comments[0].bid_amount = 999999; fixture.query.data = data;
  fixture.bid=request=>{const d=bidFixture(request);d.states[0].amount='100.25';return d;};
  await render(); await click(container.querySelectorAll('svg [role="button"]')[0]);
  expect(container.querySelector('.bid-path__knowledge')?.textContent).toContain('Currency is unestablished');
  expect(container.querySelector('.stack-event-flow')?.textContent).toContain('100.25');
  expect(container.querySelector('.stack-layer')?.textContent).not.toMatch(/\$/);
});

it('starts another auction with its own first-page comment controls',async()=>{
  const data=read(),other='00000000-0000-4000-8000-0000000000a2';
  data.lots.push({...data.lot!,id:other,source_url:'https://bringatrailer.com/listing/other-synthetic-lot',auction_end_date:'2025-11-25T21:00:00Z'});
  fixture.query.data=data;
  await render(`/stacks/order-book/${VEHICLE}?lot=${LOT}&at=old-bid&csFilter=media_only&csOffset=20&csHash=${'1'.repeat(32)}&csEvent=2026-11-25T21:00:00Z&csRecorded=2026-11-28T06:00:00Z&csCutoff=2026-11-25T20:52:00Z&bpHash=${'2'.repeat(32)}`);
  await click(container.querySelectorAll('.stack-lots button')[1]);
  const params=new URLSearchParams(container.querySelector('[data-order-address]')!.textContent!);
  expect(params.get('lot')).toBe(other);expect(params.has('at')).toBe(false);
  expect([...params.keys()].filter(k=>k.startsWith('cs')||k.startsWith('bp'))).toEqual([]);
});

it('withholds the old browser fold and zeros when the SQL read fails',async()=>{
  fixture.bidState={isError:true};await render();
  expect(container.textContent).toContain('Bid curves and measurements are withheld');
  expect(container.querySelector('svg')).toBeNull();expect(container.querySelector('.stack-asof')).toBeNull();
  expect(container.querySelector('.stack-path')?.textContent).toContain('unavailable');
});
it('shows the requested point while withholding another point book during a pinned read',async()=>{
  fixture.bid=()=>bidFixture();fixture.bidState={isPlaceholderData:true};
  await render(`/stacks/order-book/${VEHICLE}?at=${bidId(0)}`);
  expect(container.querySelector('.stack-asof')?.textContent).toContain('1 of 5');
  expect(container.textContent).toContain('Reading this bid’s book');
  expect(container.querySelector('[data-entry-key]')).toBeNull();
});
it('refuses an unknown selected point instead of selecting the latest bid',async()=>{
  fixture.bid=()=>({state:'unavailable',reason:'selected_bid_not_in_known_inputs'});
  await render(`/stacks/order-book/${VEHICLE}?at=${LOT}`);
  expect(container.textContent).toContain('selected bid not in known inputs');
  expect(container.querySelector('.stack-asof')).toBeNull();
});
it('uses a single cutoff control and embeds the comment consumer',async()=>{
  await render(`/stacks/order-book/${VEHICLE}?layer=dimension&csCutoff=2026-11-25T20:52:00Z`);
  expect(container.querySelectorAll('.episode-input-controls')).toHaveLength(1);
  expect(container.querySelector('[data-comment-embedded]')?.getAttribute('data-comment-embedded')).toBe('true');
  expect(container.textContent).toContain('Recorded-input reconstruction');
  expect(container.querySelector('.stack-path')?.textContent).toContain('2 SQL states');
});

it.each(['lot=bad','lot=','lot='+LOT+'&lot='+LOT])('does not replace a malformed explicit auction with the current lot: %s',async search=>{
  await render(`/stacks/order-book/${VEHICLE}?${search}`);
  expect(fixture.metadataArgs[0]).toBe('');expect(container.textContent).toContain('No auction was read');expect(container.querySelector('svg')).toBeNull();
  await click([...container.querySelectorAll('button')].find(b=>b.textContent==='Read current auction'));
  expect(container.querySelector('.stack-asof')).toBeTruthy();expect(fixture.metadataArgs).toEqual([VEHICLE,null]);
});
it('keeps an absent historical auction distinct from a vehicle with no auctions',async()=>{
  fixture.query.data=read({lot:null});await render(`/stacks/order-book/${VEHICLE}?lot=${LOT}`);
  expect(container.textContent).toContain('No other auction was selected');expect(container.textContent).not.toContain('has no Bring a Trailer lot');
});
