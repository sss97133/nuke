// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ session: null as null | { access_token: string }, query: {} as Record<string, unknown>, asked: [] as { request: unknown; token: unknown }[] }));
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: fixture.session ? { id: 'user-1' } : null, session: fixture.session, loading: false }),
}));
vi.mock('./forecastReader', async (importActual) => ({
  ...(await importActual<typeof import('./forecastReader')>()),
  useForecast: (request: unknown, token: unknown) => { fixture.asked.push({ request, token }); return fixture.query; },
}));
vi.mock('../../components/PrefetchLink', () => ({
  PrefetchLink: ({ to, ...p }: { to: string } & Record<string, unknown>) => <a href={to} {...p} />,
}));
import { ForecastPanel } from './ForecastPanel';
import { readingFrom } from './forecastReader';
import type { OrderBookRead } from './orderBookReader';
import { clock } from './stackFormat';
import { AS_OF, CLOSE, bidRow, familyForecast, hoursForecast, iso, liveRead, minutesForecast, missForecast, routeBody, viewOf } from './forecastFixtures';

// a made-up session value; the page only ever passes it on as the bearer
const MADE_UP = 'made-up-session-value';
const signIn = () => { fixture.session = { access_token: MADE_UP }; };

let root: Root;
let container: HTMLDivElement;
async function render(read: OrderBookRead = liveRead()) {
  await act(async () => root.render(
    <MemoryRouter><ForecastPanel read={read} view={viewOf(read)} /></MemoryRouter>,
  ));
}
const panel = () => container.querySelector('.stack-forecast') as HTMLElement;
const part = (name: string) => container.querySelector(`[data-forecast-part="${name}"]`)?.textContent ?? '';
const answered = (body: unknown) => ({ isPending: false, isError: false, data: { kind: 'ok', reading: readingFrom(body) } });

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.session = null;
  fixture.query = { isPending: true, isError: false };
  fixture.asked = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it('signed out: no number, one line that says why, no request, and a way in', async () => {
  await render();
  expect(panel().dataset.forecast).toBe('signed-out');
  const text = panel().textContent!;
  expect(text).toContain('Signed out, so no forecast is shown.');
  expect(text).toContain("Sign in to read this lot's forecast");
  expect(text).not.toContain('service_role');
  expect(text).not.toContain('API key');
  expect(text).not.toMatch(/[$0-9]/);
  expect(panel().querySelectorAll('p')).toHaveLength(1);
  expect(panel().querySelector('a[href="/login"]')?.textContent).toBe('Sign in');
  expect(fixture.asked).toHaveLength(0);
});

it('signed in, while the answer is read: a plain sentence, no spinner, no number', async () => {
  signIn();
  await render();
  expect(panel().dataset.forecast).toBe('reading');
  expect(panel().textContent).toContain('Reading the forecast.');
  expect(panel().querySelector('[role="progressbar"], [aria-busy="true"], svg, [class*="spin"], [class*="loading"]')).toBeNull();
  expect(panel().textContent).not.toMatch(/[$0-9]/);
  // the request is the lot's stored state, with the session's token
  expect(fixture.asked).toHaveLength(1);
  expect(fixture.asked[0].token).toBe(MADE_UP);
  expect(fixture.asked[0].request).toMatchObject({ lotId: '00000000-0000-4000-8000-0000000000a1', bid: 11250, bidders: 2, at: iso(AS_OF), endsAt: iso(CLOSE), totalBids: 3 });
});

it('signed in with a band: the 80% band with its n and denominator, the position, the coverage and the as-of clock', async () => {
  signIn();
  fixture.query = answered(routeBody(hoursForecast(), { ageS: 62 }));
  await render();
  expect(panel().dataset.forecast).toBe('band');
  expect(panel().querySelector('.stack-forecast-head')?.textContent).toContain(`As of ${clock(AS_OF)}`);

  expect(part('band')).toContain('$11,250 to $26,291');
  expect(part('band')).toContain('median $19,059');
  expect(part('band-basis')).toContain('n = 36 of 38 sold lots');
  expect(part('band-basis')).toContain('rank 30 of 36, 2.337x the standing bid');
  expect(part('band-basis')).toContain('covers 81% (30 of 37) if this lot behaves like its comparables');
  expect(part('band')).toContain('The low end is the standing bid $11,250');
  expect(part('band')).not.toContain('not current');

  expect(part('cohort')).toContain('exact make and model text: Synthetic Coupe');
  expect(part('cohort')).toContain('38 sold lots in the last 365 days (of 44 closed)');
  expect(part('cohort')).toContain('36 of those 38 had a bid 5d 13h 35m before their close');

  expect(part('position')).toContain('price $11,250 is above 25 of 36 comparables, level with 0 (69th percentile)');
  expect(part('position')).toContain('bidders 2 is above 10 of 36, level with 5 (35th percentile)');
  expect(part('position')).toContain(`as of ${clock(AS_OF)}`);

  const coverage = container.querySelector('[data-forecast-part="coverage"]')!;
  expect(coverage.querySelector('[data-forecast-row="bid_rows"]')?.textContent).toContain('3 / 3 bids the lot row reports');
  expect(coverage.querySelector('[data-forecast-row="bid_rows"]')?.textContent).toContain('from 2 bidders');
  expect(coverage.querySelector('[data-forecast-row="bid_rows"]')?.textContent).toContain('agrees with the stored high bid $11,250');
  expect(coverage.querySelector('[data-forecast-row="frames"]')?.textContent).toContain('0 / 15 minutes with a frame');
  expect(part('inputs')).toContain('Stored high bid $11,250 over 3 bids');
  expect(part('inputs')).toContain('1m 2s before this read');

  // every count is shown with the count it is out of
  for (const m of panel().textContent!.matchAll(/\bn = (\S+)/g)) expect(panel().textContent).toContain(`n = ${m[1]} of `);
  expect(panel().querySelector('.stack-forecast-stale')).toBeNull();
});

it('says when the bidder count was not sent, and why, and places the lot on price alone', async () => {
  signIn();
  const f = hoursForecast();
  fixture.query = answered(routeBody({ ...f, position: { ...(f.position as object), bidders: undefined } }));
  await render(liveRead({ comments: [bidRow(10000, 600, null), bidRow(10750, 300, null), bidRow(11250, 120, null)] }));
  expect(part('position')).toContain('bidders: not sent (3 of 3 bids carry no identity key, so their authors are not unified), so the lot is placed on price alone');
  expect(fixture.asked[0].request).toMatchObject({ bidders: null });
});

it('a model-family cohort is read as a cohort: the band stands, and the exact text\'s shortfall is said', async () => {
  signIn();
  fixture.query = answered(routeBody(familyForecast()));
  await render();
  expect(panel().dataset.forecast).toBe('band');
  expect(part('cohort')).toContain('make and model family (normalized_model): Synthetic coupe.');
  expect(part('cohort')).toContain('The exact make and model text, Synthetic Coupe GT, had 0 sold of 1 closed lots, under the 9 sold lots the reader needs, so it read the model family.');
  expect(part('cohort')).toContain('35 sold lots in the last 365 days (of 45 closed)');
  expect(part('cohort')).not.toContain('Miss:');
  expect(part('band-basis')).toContain('n = 35 of 35 sold lots');
});

it('a cohort miss: its reason and every denominator, no band and no position', async () => {
  signIn();
  fixture.query = answered(routeBody(missForecast()));
  await render();
  expect(panel().dataset.forecast).toBe('miss');
  expect(part('cohort')).toContain('Miss: fewer than 9 sold BaT lots have this make and model text.');
  expect(part('cohort')).toContain('2 sold of 3 closed lots with this make and model text; 0 sold of 0 closed in the model family');
  expect(part('cohort')).toContain('555 vehicles with this make (counted to 10,000)');
  expect(part('cohort')).toContain('The reader needs 9 sold lots.');
  expect(part('band')).toContain('No band. This lot has no cohort to read one from (see Cohort). n = 0 of the 9 comparables the reader needs.');
  expect(part('band')).not.toContain(' to $');
  expect(part('position')).toContain('Unknown: no cohort to stand in');
});

it('the last hour: the pool it was read from, and no position', async () => {
  signIn();
  const close = AS_OF + 600_000;
  fixture.query = answered(routeBody(minutesForecast(AS_OF, close), { ageS: 20, endsAt: close }));
  await render(liveRead({}, { auction_end_date: iso(close) }));
  expect(panel().dataset.forecast).toBe('band');
  expect(part('band')).toContain('$11,250 to $15,175');
  expect(part('band-basis')).toContain('n = 92 of 300 sold lots');
  expect(part('cohort')).toContain('92 of 300 followed lots read are in the sample, price tier a alone');
  expect(part('position')).toContain('Not built in the last hour');
});

it('numbers older than 60 s inside the last 10 minutes are labelled not current, and the panel gives no advice', async () => {
  signIn();
  const close = AS_OF + 90_000;
  fixture.query = answered(routeBody(minutesForecast(AS_OF, close), { ageS: 95, endsAt: close }));
  // the page read the lot 80 s after its last write, with 10 s on the clock; the route answered 15 s later
  await render(liveRead({ readAt: iso(AS_OF + 80_000) }, { auction_end_date: iso(close) }));
  expect(panel().dataset.forecast).toBe('stale');
  const stale = panel().querySelector('.stack-forecast-stale')!;
  expect(stale.textContent).toContain('Not current.');
  expect(stale.textContent).toContain('1m 35s old at this read');
  expect(stale.textContent).toContain('last 10 minutes');
  expect(stale.textContent).toContain(`as of ${clock(AS_OF)}`);
  expect(part('band')).toContain('not current');
  expect(panel().textContent).not.toMatch(/\b(place a bid|bid now|you should|bid at)\b/i);
  // the stale notice comes before any number
  expect(stale.compareDocumentPosition(panel().querySelector('[data-forecast-part="band"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('a closed lot makes no request, signed in or not, and shows no forecast', async () => {
  signIn();
  await render(liveRead({ readAt: iso(CLOSE + 3_600_000) }));
  expect(panel().dataset.forecast).toBe('closed');
  expect(panel().textContent).toContain(`This lot closed ${clock(CLOSE)}.`);
  expect(panel().textContent).toContain('Its result is in the Outcome layer.');
  expect(panel().textContent).not.toContain('$');
  expect(fixture.asked).toHaveLength(0);
});

it('a lot with no bid, no close or no write clock says so and asks for nothing', async () => {
  signIn();
  await render(liveRead({}, { high_bid: null }));
  expect(panel().dataset.forecast).toBe('no-bid');
  expect(panel().textContent).toContain('starts at the first bid');
  await render(liveRead({}, { auction_end_date: null }));
  expect(panel().dataset.forecast).toBe('no-close');
  await render(liveRead({}, { updated_at: null }));
  expect(panel().dataset.forecast).toBe('no-state');
  expect(fixture.asked).toHaveLength(0);
});

it('the reader\'s own refusals to forecast are shown as its words, with no number', async () => {
  signIn();
  fixture.query = answered(routeBody({ status: 'no_bid', as_of: iso(AS_OF), auction_event_id: 'x', reason: 'no current bid was given' }));
  await render();
  expect(panel().dataset.forecast).toBe('status');
  expect(panel().textContent).toContain('The reader answered no bid: no current bid was given. No forecast is shown.');
  expect(panel().textContent).not.toContain('$');
});

it('a band that came without its n or its denominator is not shown', async () => {
  signIn();
  const f = hoursForecast();
  fixture.query = answered(routeBody({ ...f, band: { ...(f.band as object), denominator: undefined } }));
  await render();
  expect(panel().dataset.forecast).toBe('unreadable');
  expect(panel().textContent).toContain('so no number is shown');
  expect(panel().textContent).not.toContain('26,291');
});

it('a refused session, a rate limit and a failed read each say so, and none shows a number', async () => {
  signIn();
  fixture.query = { isPending: false, isError: false, data: { kind: 'refused', status: 401, message: 'Invalid or missing authentication' } };
  await render();
  expect(panel().dataset.forecast).toBe('refused');
  expect(panel().textContent).toContain('refused this session (HTTP 401: Invalid or missing authentication)');
  expect(panel().querySelector('a[href="/login"]')).not.toBeNull();

  fixture.query = { isPending: false, isError: false, data: { kind: 'rate_limited', message: 'Rate limit exceeded.', retryAfterS: 42 } };
  await render();
  expect(panel().dataset.forecast).toBe('rate-limited');
  expect(panel().textContent).toContain('try again in 0m 42s');

  const refetch = vi.fn();
  fixture.query = { isPending: false, isError: false, refetch, data: { kind: 'unavailable', message: 'HTTP 504: the forecast reader timed out; retry' } };
  await render();
  expect(panel().dataset.forecast).toBe('unavailable');
  expect(panel().textContent).toContain('HTTP 504: the forecast reader timed out; retry');
  await act(async () => { panel().querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  expect(refetch).toHaveBeenCalledTimes(1);
  expect(panel().textContent).not.toContain('$');
});
