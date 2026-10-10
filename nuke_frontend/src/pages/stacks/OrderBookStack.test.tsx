// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ query: {} as Record<string, unknown>, temperature: {} as Record<string, unknown> }));
vi.mock('./orderBookReader', async (importActual) => ({
  ...(await importActual<typeof import('./orderBookReader')>()),
  useOrderBook: () => fixture.query,
}));
vi.mock('../market/useLiveLotTemperature', () => ({ useLiveLotTemperature: () => fixture.temperature }));
vi.mock('../../components/PrefetchLink', () => ({
  PrefetchLink: ({ to, ...p }: { to: string } & Record<string, unknown>) => <a href={to} {...p} />,
}));
vi.mock('./bidPopulationReader', () => ({useBidStudy:() => ({isPending:true})}));
import OrderBookStack from './OrderBookStack';
import type { CommentRow, OrderBookRead } from './orderBookReader';

const VEHICLE = '00000000-0000-4000-8000-000000000001';
const LOT = '00000000-0000-4000-8000-0000000000a1';
const ID_A = '00000000-0000-4000-8000-00000000aaaa';
const ID_B = '00000000-0000-4000-8000-00000000bbbb';
const CLOSE = Date.parse('2026-10-12T20:30:00Z');
const URL = 'https://bringatrailer.com/listing/synthetic-lot-1';
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
let container: HTMLDivElement;
async function render(path = `/stacks/order-book/${VEHICLE}`) {
  await act(async () => root.render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/stacks/order-book/:vehicleId" element={<OrderBookStack />} />
      </Routes>
    </MemoryRouter>,
  ));
}
const click = async (el: Element | null | undefined) => act(async () => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const layerButton = (name: string) => [...container.querySelectorAll('.stack-path button')].find((b) => b.textContent?.includes(name));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  n = 0;
  fixture.query = { data: read(), isPending: false, isError: false };
  fixture.temperature = { data: null, isPending: false };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

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

it('opens on the fold and moves the book to the chosen bid, using only bids posted by then', async () => {
  await render();
  expect(container.querySelector('.stack-asof')?.textContent).toContain('3 of 3');
  expect([...container.querySelectorAll('.stack-table tbody tr')].map((r) => r.textContent)).toEqual([
    expect.stringContaining('bidder-a'), expect.stringContaining('bidder-b'),
  ]);
  await click(container.querySelectorAll('svg [role="button"]')[0]);
  expect(container.querySelector('.stack-asof')?.textContent).toContain('1 of 3');
  const rows = [...container.querySelectorAll('.stack-table tbody tr')];
  expect(rows).toHaveLength(1);
  expect(rows[0].textContent).toContain('$100');
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
  expect(container.textContent).toContain('answers only while a lot is live');
  expect(container.textContent).toContain('Missing layer: baseline curve');
  expect(container.textContent).not.toContain('percentile');
});

it('keeps key conflicts visible in the log and out of the fold', async () => {
  const data = read();
  data.comments.push(row({ comment_type: 'bid', bid_amount: 99_000, posted_at: at(20 * 1440), external_identity_id: ID_B }));
  fixture.query = { data, isPending: false, isError: false };
  await render(`/stacks/order-book/${VEHICLE}?layer=log`);
  expect(container.querySelector('[data-coverage="key_conflicts"]')?.textContent).toContain('1 / 5');
  expect(container.querySelector('.stack-missing')?.textContent).toContain('$99,000');
  await click(layerButton('Fold'));
  expect(container.querySelector('.stack-asof')?.textContent).toContain('$300');
});

it('reports the outcome as recorded and links the keyed winner', async () => {
  await render(`/stacks/order-book/${VEHICLE}?layer=outcome`);
  expect(container.textContent).toContain('$300 (buyer fee excluded)');
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
