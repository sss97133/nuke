import { describe, expect, it, vi } from 'vitest';
import {
  FORECAST_PATH, STALE_AGE_S, STALE_WINDOW_S, biddersFor, forecastGate, forecastUrl, readForecast, readingFrom, staleness,
  type ForecastRequest,
} from './forecastReader';
import { AS_OF, CLOSE, ID_A, ID_B, LOT_ID, bidRow, familyForecast, hoursForecast, iso, liveRead, minutesForecast, missForecast, routeBody, viewOf } from './forecastFixtures';

const gateOf = (read = liveRead()) => forecastGate(read.lot!, viewOf(read));
const ask = (read = liveRead()) => {
  const g = gateOf(read);
  if (g.kind !== 'ask') throw new Error(`expected ask, got ${g.kind}`);
  return g.request;
};

describe('forecastGate: what the page asks, from the lot row it already read', () => {
  it('asks with the stored high bid, the close as last read, and the clock the lot row was last written', () => {
    const r = ask();
    expect(r).toEqual({
      lotId: LOT_ID, bid: 11250, bidders: 2, biddersWhy: null, at: iso(AS_OF), endsAt: iso(CLOSE), totalBids: 3,
    });
  });

  it('reads a numeric high bid that arrives as text', () => {
    expect(ask(liveRead({}, { high_bid: '20500' as unknown as number })).bid).toBe(20500);
  });

  it('sends bidders only when the bid rows add up to the lot row\'s own bid count and every bid is keyed', () => {
    const read = liveRead();
    const lot = read.lot!;
    // the rows add up and are keyed: two distinct identities
    expect(biddersFor(lot, viewOf(read))).toEqual({ bidders: 2, why: null });
    // the lot row reports more bids than the rows held
    expect(biddersFor({ ...lot, total_bids: 5 }, viewOf(read))).toEqual({ bidders: null, why: '3 bid rows held of the 5 the lot row reports' });
    // no count to check against
    expect(biddersFor({ ...lot, total_bids: null }, viewOf(read)).bidders).toBeNull();
    // a bid with no identity key: its author is not unified by handle, so the count is not sent
    const unkeyed = liveRead({ comments: [bidRow(10000, 600, ID_A), bidRow(10750, 300, null), bidRow(11250, 120, ID_B)] });
    const u = biddersFor(unkeyed.lot!, viewOf(unkeyed));
    expect(u.bidders).toBeNull();
    expect(u.why).toBe('1 of 3 bids carry no identity key, so their authors are not unified');
    // and the request says so
    const r = ask(unkeyed);
    expect(r.bidders).toBeNull();
    expect(r.biddersWhy).toContain('carry no identity key');
  });

  it('makes no request for a lot that has closed, has no close, has no bid, or has no write clock', () => {
    // closed: the read happened after the close
    const closed = gateOf(liveRead({ readAt: iso(CLOSE + 3_600_000) }));
    expect(closed).toEqual({ kind: 'closed', closeAt: CLOSE });
    expect(gateOf(liveRead({}, { auction_end_date: null })).kind).toBe('no_close');
    expect(gateOf(liveRead({}, { high_bid: null })).kind).toBe('no_bid');
    expect(gateOf(liveRead({}, { high_bid: 0 })).kind).toBe('no_bid');
    expect(gateOf(liveRead({}, { updated_at: null })).kind).toBe('no_state');
    expect(gateOf(liveRead({}, { updated_at: 'not a time' })).kind).toBe('no_state');
  });
});

describe('forecastUrl', () => {
  it('names the lot and the stored numbers, and nothing the page does not know', () => {
    const url = new URL(forecastUrl(ask(), 'https://api.test/functions/v1'));
    expect(url.origin + url.pathname).toBe(`https://api.test/functions/v1/${FORECAST_PATH}`);
    expect([...url.searchParams.keys()].sort()).toEqual(['at', 'bid', 'bidders', 'ends_at', 'lot']);
    expect(url.searchParams.get('lot')).toBe(LOT_ID);
    expect(url.searchParams.get('bid')).toBe('11250');
    expect(url.searchParams.get('bidders')).toBe('2');
    expect(url.searchParams.get('at')).toBe(iso(AS_OF));
    expect(url.searchParams.get('ends_at')).toBe(iso(CLOSE));
    // no extension count (the page cannot tell; the reader reads its own bid rows) and nothing that identifies the viewer
    expect(url.searchParams.has('extensions')).toBe(false);
  });

  it('leaves bidders out when it is not sent', () => {
    const req: ForecastRequest = { ...ask(), bidders: null, biddersWhy: 'x' };
    expect(new URL(forecastUrl(req, 'https://api.test/functions/v1')).searchParams.has('bidders')).toBe(false);
  });
});

describe('staleness: the CLI\'s rule, judged at the read', () => {
  it('is stale only inside the last 10 minutes, and only when the numbers are older than 60 s', () => {
    expect(STALE_WINDOW_S).toBe(600);
    expect(STALE_AGE_S).toBe(60);
    expect(staleness(90, 95)).toEqual({ kind: 'stale', ageS: 95 });
    expect(staleness(90, 60)).toBeNull();
    expect(staleness(90, 30)).toBeNull();
    expect(staleness(600, 61)).toEqual({ kind: 'stale', ageS: 61 });
    expect(staleness(601, 9999)).toBeNull();
    expect(staleness(-5, 120)).toEqual({ kind: 'stale', ageS: 120 });
    expect(staleness(90, null)).toEqual({ kind: 'unknown', ageS: null });
    expect(staleness(null, 9999)).toBeNull();
  });
});

describe('readingFrom: the route\'s body as the page reads it', () => {
  it('reads the 80% band with its n and its denominator, the position, the coverage and the clocks', () => {
    const r = readingFrom(routeBody(hoursForecast(), { ageS: 62 }))!;
    expect(r.status).toBe('ok');
    expect(r.band).toMatchObject({ low: 11250, mid: 19059, high: 26291, n: 36, denominator: 38, denominatorIsFloor: false, rank: 30, ratioHigh: 2.337 });
    expect(r.cohort).toMatchObject({ kind: 'level', level: 1, make: 'Synthetic', model: 'Coupe', denominator: 38, nComparables: 36 });
    expect(r.cohort?.funnel).toMatchObject({ closed_lots: 44, sold_with_hammer: 38 });
    expect(r.position?.price).toMatchObject({ bid: 11250, n: 36, below: 25, same: 0, above: 11 });
    expect(r.position?.bidders).toMatchObject({ bidders: 2, n: 36, below: 10, same: 5, above: 21 });
    expect(r.coverage.bidRows).toMatchObject({ n: 3, bidders: 2, maxBid: 11250, agrees: true });
    expect(r.coverage.frames).toMatchObject({ n: 0, minutesWithFrameOfLast15: 0 });
    expect(r.asOf).toBe(AS_OF);
    expect(r.readAt).toBe(AS_OF + 62_000);
    expect(r.ageS).toBe(62);
    expect(r.regime).toBe('hours');
    expect(r.stale).toBeNull();
    expect(r.unreadable).toBe(false);
  });

  it('judges the last 10 minutes at the route\'s own clock, so the age needs no clock from this browser', () => {
    const close = AS_OF + 90_000;
    // numbers 95 s old with 90 s left as of their clock: -5 s at the read
    const stale = readingFrom(routeBody(minutesForecast(AS_OF, close), { ageS: 95, endsAt: close }))!;
    expect(stale.secondsLeftAtRead).toBe(-5);
    expect(stale.stale).toEqual({ kind: 'stale', ageS: 95 });
    // 30 s old: current
    expect(readingFrom(routeBody(minutesForecast(AS_OF, close), { ageS: 30, endsAt: close }))!.stale).toBeNull();
    // numbers from 8 minutes ago when the lot had 15 minutes left: 7 minutes left now, so stale
    const eight = readingFrom(routeBody(hoursForecast(AS_OF, AS_OF + 900_000), { ageS: 480, endsAt: AS_OF + 900_000 }))!;
    expect(eight.secondsLeftAtRead).toBe(420);
    expect(eight.stale).toEqual({ kind: 'stale', ageS: 480 });
    // far from the close, old numbers are only old
    expect(readingFrom(routeBody(hoursForecast(), { ageS: 7200 }))!.stale).toBeNull();
    // closed more than 10 minutes before the read: nothing left that can move
    const gone = readingFrom(routeBody(hoursForecast(AS_OF, AS_OF + 60_000), { ageS: 3600, endsAt: AS_OF + 60_000 }))!;
    expect(gone.stale).toBeNull();
  });

  it('reads the last hour\'s pool, with no position', () => {
    const r = readingFrom(routeBody(minutesForecast(AS_OF, AS_OF + 90_000), { ageS: 5, endsAt: AS_OF + 90_000 }))!;
    expect(r.regime).toBe('minutes');
    expect(r.cohort?.kind).toBe('pool');
    expect(r.position).toBeNull();
    expect(r.band).toMatchObject({ n: 92, denominator: 300, pool: { priceTier: 'a', tierAlone: true, inSample: 92, read: 300 } });
  });

  it('reads a cohort miss with its reason and every denominator, and no band', () => {
    const r = readingFrom(routeBody(missForecast()))!;
    expect(r.band).toBeNull();
    expect(r.unreadable).toBe(false);
    expect(r.cohort).toMatchObject({ kind: 'miss', missReason: 'fewer than 9 sold BaT lots have this make and model text' });
    expect(r.cohort?.missDenominators).toEqual({
      closed_lots_with_this_text: 3, sold_with_this_text: 2, closed_lots_in_the_model_family: 0, sold_in_the_model_family: 0, vehicles_with_this_make_to_10000: 555,
    });
    expect(r.cohort?.familyNote).toContain('no normalized_model');
    expect(r.bandUnavailable).toEqual({ reason: 'no cohort: see cohort_miss', n: 0, minN: 9 });
    expect(r.position).toBeNull();
  });

  it('reads a model-family cohort as a cohort, not a miss, even though the exact text fell short', () => {
    const r = readingFrom(routeBody(familyForecast()))!;
    expect(r.cohort).toMatchObject({ kind: 'level', level: 2, make: 'Synthetic', family: 'coupe', denominator: 35, nComparables: 35, exactText: { sold: 0, closed: 1 } });
    expect(r.band).toMatchObject({ n: 35, denominator: 35, rank: 29 });
    // and a level-1 cohort carries no such note
    expect(readingFrom(routeBody(hoursForecast()))!.cohort).toMatchObject({ kind: 'level', level: 1, family: null, exactText: null });
  });

  it('shows no band whose count or denominator is missing', () => {
    for (const drop of ['n', 'denominator', 'low', 'mid', 'high']) {
      const f = hoursForecast();
      const band = { ...(f.band as Record<string, unknown>) };
      delete band[drop];
      const r = readingFrom(routeBody({ ...f, band }))!;
      expect(r.band, drop).toBeNull();
      expect(r.unreadable, drop).toBe(true);
    }
  });

  it('keeps the floor flag, and reads an answer that is a reason and no numbers', () => {
    const floor = hoursForecast();
    const r = readingFrom(routeBody({ ...floor, band: { ...(floor.band as object), denominator_is_a_floor: true } }))!;
    expect(r.band?.denominatorIsFloor).toBe(true);
    const ended = readingFrom(routeBody({ status: 'ended', as_of: iso(AS_OF), auction_event_id: LOT_ID, ends_at: iso(AS_OF - 1000), ends_at_source: 'argument', reason: 'the close time is at or before the time of the read' }))!;
    expect(ended).toMatchObject({ status: 'ended', reason: 'the close time is at or before the time of the read', band: null, cohort: null, position: null });
    expect(readingFrom(routeBody({ status: 'no_bid', as_of: iso(AS_OF), reason: 'no current bid was given' }))).toMatchObject({ status: 'no_bid', band: null });
  });

  it('is null for a body that is not the route\'s', () => {
    for (const body of [null, 'x', 5, {}, { data: null }, { data: {} }, { data: { forecast: [] } }, { data: { forecast: { nothing: 1 } } }]) {
      expect(readingFrom(body)).toBeNull();
    }
  });
});

describe('readForecast: one call, the session\'s token, every refusal a state', () => {
  const req = (): ForecastRequest => ask();
  const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    vi.fn().mockResolvedValue(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers }));

  it('sends the access token as the bearer and the public key as apikey, and puts neither in the address', async () => {
    const fetcher = reply(200, routeBody(hoursForecast()));
    const out = await readForecast(req(), 'session-token-abc', undefined, fetcher);
    expect(out.kind).toBe('ok');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toContain(`/functions/v1/${FORECAST_PATH}?`);
    expect(String(url)).not.toContain('session-token-abc');
    expect(init.headers.Authorization).toBe('Bearer session-token-abc');
    expect(typeof init.headers.apikey).toBe('string');
    expect(init.headers.apikey.length).toBeGreaterThan(20);
    expect(init.method).toBeUndefined();
  });

  it('turns each refusal into one state and does not throw', async () => {
    expect(await readForecast(req(), 't', undefined, reply(401, { error: 'Invalid or missing authentication' })))
      .toEqual({ kind: 'refused', status: 401, message: 'Invalid or missing authentication' });
    expect((await readForecast(req(), 't', undefined, reply(403, { error: 'Insufficient scopes' }))).kind).toBe('refused');
    expect(await readForecast(req(), 't', undefined, reply(404, { error: 'no Bring a Trailer lot has this auction_events id' })))
      .toEqual({ kind: 'not_found', message: 'no Bring a Trailer lot has this auction_events id' });
    expect(await readForecast(req(), 't', undefined, reply(429, { error: 'Rate limit exceeded. Retry after 42 seconds.' })))
      .toEqual({ kind: 'rate_limited', message: 'Rate limit exceeded. Retry after 42 seconds.', retryAfterS: 42 });
    expect(await readForecast(req(), 't', undefined, reply(429, { error: 'slow down' }, { 'Retry-After': '7' }))).toMatchObject({ kind: 'rate_limited', retryAfterS: 7 });
    expect(await readForecast(req(), 't', undefined, reply(400, { error: 'at must be an ISO 8601 instant with an offset' })))
      .toEqual({ kind: 'bad_request', message: 'at must be an ISO 8601 instant with an offset' });
    expect(await readForecast(req(), 't', undefined, reply(504, { error: 'the forecast reader timed out; retry' })))
      .toEqual({ kind: 'unavailable', message: 'HTTP 504: the forecast reader timed out; retry' });
    expect(await readForecast(req(), 't', undefined, reply(502, 'not json'))).toEqual({ kind: 'unavailable', message: 'HTTP 502: the forecast route failed' });
  });

  it('says so when the answer is not the route\'s shape, and when the route cannot be reached', async () => {
    expect((await readForecast(req(), 't', undefined, reply(200, { data: { nothing: true } }))).kind).toBe('unreadable');
    expect((await readForecast(req(), 't', undefined, reply(200, 'not json'))).kind).toBe('unreadable');
    const down = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await readForecast(req(), 't', undefined, down)).toEqual({ kind: 'unavailable', message: 'the forecast route could not be reached' });
  });

  it('lets the caller cancel: an aborted read throws, so the query does not record it as an answer', async () => {
    const ctl = new AbortController();
    const fetcher = vi.fn().mockImplementation((_url: string, init: { signal: AbortSignal }) => new Promise((_res, rej) => {
      init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    }));
    const pending = readForecast(req(), 't', ctl.signal, fetcher);
    ctl.abort();
    await expect(pending).rejects.toThrow();
  });
});
