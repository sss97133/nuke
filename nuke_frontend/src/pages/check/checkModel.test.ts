import { describe, expect, it } from 'vitest';
import fixtures from './fixtures/evaluate_listing.json';
import { parseRpcBody } from './advisorClient';
import { type CheckCard, endsIn, moneyShort, normalizePaste, pasteRefusal, railPct, railSpan, thinReason, toCheckOutcome, verdictLine } from './checkModel';

// Fixtures are real anonymous evaluate_listing answers from nuke.ag/mcp/advisor (Nov 22 2026), trimmed.
const card = (k: keyof typeof fixtures) => {
  const o = toCheckOutcome(fixtures[k] as never);
  if (o.kind !== 'card') throw new Error(`expected a card for ${k}, got ${o.kind}`);
  return o as CheckCard;
};

describe('pasteRefusal', () => {
  it('accepts BaT listing links, with or without scheme or www', () => {
    expect(pasteRefusal('https://bringatrailer.com/listing/1970-porsche-911t-targa-44/')).toBeNull();
    expect(pasteRefusal('bringatrailer.com/listing/2013-bmw-x5-73')).toBeNull();
    expect(pasteRefusal('https://www.bringatrailer.com/listing/x-1/')).toBeNull();
    expect(normalizePaste('bringatrailer.com/listing/x')).toBe('https://bringatrailer.com/listing/x');
    expect(normalizePaste('http://bringatrailer.com/listing/x')).toBe('https://bringatrailer.com/listing/x');
  });
  it('refuses Cars & Bids, Mecum and other sites with the BaT-only message, before any request', () => {
    expect(pasteRefusal('https://carsandbids.com/auctions/KDwzE4XM/2024-chevrolet-corvette')).toMatch(/^Bring a Trailer only for now\. Cars & Bids/);
    expect(pasteRefusal('https://www.mecum.com/lots/1155668/1966-chevrolet-corvette/')).toMatch(/Mecum listings aren't supported/);
    expect(pasteRefusal('https://example.com/car')).toMatch(/example\.com listings/);
    expect(pasteRefusal('https://bringatrailer.com.evil.example/listing/x')).toMatch(/only for now/);
    expect(pasteRefusal('https://bringatrailer.com/auctions/')).toMatch(/only listing pages/);
    expect(pasteRefusal('not a link at all')).toMatch(/not a link|only for now/);
  });
});

describe('toCheckOutcome', () => {
  it('sold: price, range, relation, position, trend, all-in and comps with source links', () => {
    const c = card('sold');
    expect(c.priceKind).toBe('sold');
    expect(c.price).toBe(73411);
    expect(c.band).toMatchObject({ low: 60649, high: 86557 });
    expect(c.lowConfidence).toBe(false);
    expect(c.relation).toBe('inside');
    expect(verdictLine(c)).toBe('Sold within what similar cars sold for');
    expect(c.position?.n).toBe(10);
    expect(c.trend).not.toBeNull();
    expect(c.allIn?.total).toBeGreaterThan(73411);
    expect(c.allIn?.lines.map(l => l.label)).toEqual(['Winning bid', 'Buyer fee', 'Transport (estimate)', 'Title and registration (estimate)']);
    expect(c.comps.length).toBe(10);
    expect(c.comps.every(x => /^https:\/\/bringatrailer\.com\/listing\//.test(x.url))).toBe(true);
    expect(c.notes.some(n => /^Value comes from/.test(n))).toBe(false);
  });
  it('reserve not met reads as a high bid, not a sale', () => {
    const c = card('rnm');
    expect(c.priceKind).toBe('rnm');
    expect(c.price).toBe(15000);
    expect(verdictLine(c)).toMatch(/reserve not met/);
    expect(c.allIn?.lines[0].label).toBe('High bid');
  });
  it('live: current bid, an end clock, and no trend when the advisor recorded none', () => {
    const c = card('live');
    expect(c.priceKind).toBe('live');
    expect(c.price).toBe(13777);
    expect(c.endsAt).toBeTruthy();
    expect(c.relation).toBe('below');
    expect(verdictLine(c)).toBe('Current bid is below what similar cars sold for');
    expect(c.trend).toBeNull();
  });
  it('a $0 live bid is no bid, and a 0.29-confidence range makes no call', () => {
    const c = card('live_nobid');
    expect(c.price).toBeNull();
    expect(c.lowConfidence).toBe(true);
    expect(c.relation).toBeNull();
    expect(verdictLine(c)).toBe('Not enough close sales to call this one');
  });
  it('few comps (n=4) is low confidence, and the reasons differ for few vs scattered sales', () => {
    expect(card('low').lowConfidence).toBe(true);
    expect(thinReason(card('low'))).toMatch(/only 4 close sales/);
    expect(thinReason(card('live_nobid'))).toMatch(/too far apart/);
  });
  it('no value at all says there is nothing to price it with', () => {
    const c = card('unpriced');
    expect(c.band).toBeNull();
    expect(c.comps).toEqual([]);
    expect(verdictLine(c)).toBe('Not enough sales to price this one');
    expect(thinReason(c)).toMatch(/no close sales/);
    expect(railSpan(c)).toBeNull();
  });
  it('a server refusal and a server error stay distinct', () => {
    const refused = toCheckOutcome({ isError: true, structuredContent: { error: "Cars & Bids listings aren't supported yet. Nuke's listing advisor reads Bring a Trailer listings only for now.", unsupported_source: 'cars_and_bids' } });
    expect(refused.kind).toBe('refused');
    expect(toCheckOutcome({ isError: true, structuredContent: { error: 'listing fetch failed (HTTP 404)' } }).kind).toBe('error');
    expect(toCheckOutcome(null).kind).toBe('error');
  });
});

describe('format helpers', () => {
  it('money, clocks and the rail', () => {
    expect(moneyShort(73411)).toBe('$73k');
    expect(moneyShort(1250000)).toBe('$1.25M');
    expect(moneyShort(7100)).toBe('$7.1k');
    expect(moneyShort(9724)).toBe('$9.7k');
    expect(moneyShort(640)).toBe('$640');
    const now = Date.parse('2026-11-22T18:00:00Z');
    expect(endsIn('2026-11-25T20:30:00Z', now)).toBe('ends in 3d 2h');
    expect(endsIn('2026-11-22T18:35:00Z', now)).toBe('ends in 35m');
    expect(endsIn(null, now)).toBeNull();
    const s = { min: 100, max: 200 };
    expect(railPct(150, s)).toBe(50);
    expect(railPct(50, s)).toBe(0);
  });
  it('parses the Streamable HTTP SSE frame and plain JSON', () => {
    expect(parseRpcBody('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"isError":false}}\n\n').result).toEqual({ isError: false });
    expect(parseRpcBody('{"jsonrpc":"2.0","id":1,"error":{"message":"x"}}').error?.message).toBe('x');
  });
});
