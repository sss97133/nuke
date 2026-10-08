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
import OrderBookStack from './OrderBookStack';
import StacksIndex from './StacksIndex';
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
        <Route path="/stacks" element={<StacksIndex />} />
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

it('shows the stack operating on the index and keeps the selected event, demand and drill aligned', async () => {
  await render('/stacks');
  const operation = container.querySelector('.stack-operation')!;
  expect(operation.querySelectorAll('svg')).toHaveLength(2);
  expect(container.querySelector('.stack-mode')?.textContent).toContain('Recorded lot · replay');
  expect(container.querySelector('.stack-method')?.hasAttribute('open')).toBe(false);
  expect(container.querySelector('.stack-coverage')!.compareDocumentPosition(operation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(operation.querySelector('.stack-event-flow')?.textContent).toContain('$100 change in the high bid');
  expect(container.querySelector('.stack-result')?.textContent).toContain('sold · $300 (buyer fee excluded)');

  await click(operation.querySelectorAll('svg [role="button"]')[0]);
  const firstId = (fixture.query.data as OrderBookRead).comments[0].id;
  expect(operation.querySelector('input')?.value).toBe('0');
  expect(operation.querySelector('.stack-event-flow')?.textContent).toContain('First received bid');
  expect(operation.querySelector('.stack-event-flow')?.textContent).toContain('1 keyed of 1 book entries');
  expect(operation.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toContain('as of bid 1: 1 entries');
  expect(operation.querySelector('.stack-event-flow a')?.getAttribute('href')).toContain('#comment-101');
  expect(operation.querySelector('.stack-operation-heading a')?.getAttribute('href')).toContain(`&at=${firstId}`);
});

it('follows new received bids at latest and preserves a chosen bid when the index refreshes', async () => {
  const data = fixture.query.data as OrderBookRead;
  await render('/stacks');
  data.comments.push(row({ comment_type: 'bid', bid_amount: 400, posted_at: at(5), external_identity_id: ID_B }));
  fixture.query = { ...fixture.query, data: { ...data } };
  await render('/stacks');
  expect(container.querySelector('.stack-asof')?.textContent).toContain('4 of 4');
  await click(container.querySelectorAll('.stack-operation svg [role="button"]')[0]);
  data.comments.push(row({ comment_type: 'bid', bid_amount: 500, posted_at: at(1), external_identity_id: ID_A }));
  fixture.query = { ...fixture.query, data: { ...data } };
  await render('/stacks');
  expect(container.querySelector('.stack-asof')?.textContent).toContain('1 of 5');
  expect(container.querySelector('.stack-event-flow')?.textContent).not.toContain('$500');
  await click([...container.querySelectorAll('.stack-asof button')].find((b) => b.textContent === 'Latest'));
  expect(container.querySelector('.stack-asof')?.textContent).toContain('5 of 5');
});

it('does not claim an operating reading when evidence is missing or the read failed', async () => {
  const data = fixture.query.data as OrderBookRead;
  fixture.query = { data: { ...data, comments: [] }, isPending: false, isError: false };
  await render('/stacks');
  expect(container.querySelector('.stack-operation')?.textContent).toContain('No bids in this lot');
  expect(container.querySelector('.stack-operation svg')).toBeNull();
  fixture.query = { data: null, isPending: false, isError: false };
  await render('/stacks');
  expect(container.textContent).toContain('not publicly readable');
  fixture.query = { data: null, isPending: false, isError: true, refetch: vi.fn() };
  await render('/stacks');
  expect(container.textContent).toContain('The latest read failed; no coverage is shown');
  expect(container.querySelector('.stack-operation')).toBeNull();
});
