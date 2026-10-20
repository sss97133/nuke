import { describe, expect, it } from 'vitest';
import { critique, report, type PageModel } from './critique';

// The page as the owner saw it on 2026-10-17 (ALL MAKES → LEXUS → LC → SOURCES → LIVE AUCTIONS → ENTER FEED), and the
// same page with each complaint fixed. One rule per test; each fails on the old page and passes on the fixed one.
const old: PageModel = {
  scope: { make: 'Lexus', family: 'LC' },
  statements: [
    { fact: 'share:Bring a Trailer', where: 'venue-mix' },
    { fact: 'share:Bring a Trailer', where: 'sources-board' },
  ],
  headlines: [
    { text: '334,000 vehicles with a confirmed sale', window: null, where: 'map-caption' },
    { text: 'Biggest gain: Lexus ▲38% (408 → 628)', window: null, where: 'callouts' },
  ],
  callouts: {
    items: [
      { kind: 'gain', name: 'Lexus', rel: 0.38, sold: 628, prior: 408 },
      { kind: 'loss', name: 'Kawasaki', rel: -0.59, sold: 60, prior: 148 },
    ],
    levelDollars: 3.0e9, dollarsOf: { Lexus: 32e6, Kawasaki: 316e3 }, gateMin: 20,
  },
  tiles: [
    { name: 'Chevrolet', usd: 2.4e9, move: { kind: 'few', sold: 7115, prior: 6153, why: 'share' } },
    { name: 'Porsche', usd: 2.3e9, move: { kind: 'move', rel: 0.02, raw: 0.17, sold: 4650, prior: 3991 } },
  ],
  sourcesBoard: { label: 'Sources · all makes' },
  liveBoard: { label: 'Bring a Trailer · LEXUS · LC', count: 0, feedOpenLots: 1, feedBySource: { 'Bring a Trailer': 1 } },
};
const fixed: PageModel = {
  ...old,
  statements: [{ fact: 'share:Bring a Trailer', where: 'sources-board' }],
  headlines: [
    { text: '334,000 vehicles with a confirmed sale', window: 'all time', where: 'map-caption' },
    { text: 'Biggest gain: Lexus ▲34%', window: 'last 12 months against the 12 before', where: 'callouts' },
  ],
  callouts: { ...old.callouts, items: [{ kind: 'gain', name: 'Lexus', rel: 0.34, sold: 643, prior: 428 }] },
  tiles: [
    { name: 'Chevrolet', usd: 2.4e9, move: { kind: 'move', rel: 0.0, raw: 0.156, sold: 7115, prior: 6153 } },
    old.tiles[1],
  ],
  sourcesBoard: { label: 'Sources · Lexus LC' },
  liveBoard: { label: 'Bring a Trailer · LEXUS · LC', count: 1, feedOpenLots: 1 },
};
const rules = (p: PageModel) => critique(p).map((v) => v.rule);

describe('the market editor’s rules', () => {
  it('each fact appears once on the page', () => {
    expect(critique(old).find((v) => v.rule === 'stated-once')?.message).toBe('share:Bring a Trailer is stated in 2 places: venue-mix, sources-board');
    expect(rules(fixed)).not.toContain('stated-once');
  });
  it('every headline number carries its window', () => {
    const v = critique(old).filter((x) => x.rule === 'headline-window');
    expect(v.map((x) => x.numbers.where)).toEqual(['map-caption', 'callouts']);
    expect(rules(fixed)).not.toContain('headline-window');
  });
  it('callouts clear the dollar and sales floor', () => {
    const v = critique(old).find((x) => x.rule === 'callout-floor');
    expect(v?.numbers).toMatchObject({ name: 'Kawasaki', sold: 60, prior: 148, sharePct: 0.01 });
    expect(rules(fixed)).not.toContain('callout-floor');
  });
  it('a drilled scope never shows an "all makes" board', () => {
    expect(critique(old).find((x) => x.rule === 'scoped-board')?.message).toBe('scope Lexus · LC shows "Sources · all makes"');
    expect(rules(fixed)).not.toContain('scoped-board');
    expect(rules({ ...old, scope: {} })).not.toContain('scoped-board');
  });
  it('a tile marked unmeasured must not be the largest tile', () => {
    expect(critique(old).find((x) => x.rule === 'unmeasured-largest')?.numbers).toEqual({ name: 'Chevrolet', usd: 2.4e9 });
    expect(rules(fixed)).not.toContain('unmeasured-largest');
    // Too few sales is not "unmeasured": the largest tile may be young.
    expect(rules({ ...old, tiles: [{ name: 'X', usd: 9e9, move: { kind: 'few', sold: 3, prior: 2, why: 'count' } }] })).not.toContain('unmeasured-largest');
  });
  it('the live board count matches the Feed’s open lots for the same scope', () => {
    expect(critique(old).find((x) => x.rule === 'live-matches-feed')?.message).toBe('Bring a Trailer · LEXUS · LC: live board 0 open lots, Feed 1 (Bring a Trailer 1)');
    expect(rules(fixed)).not.toContain('live-matches-feed');
    expect(rules({ ...fixed, liveBoard: { label: 'x', count: 0, feedOpenLots: null } })).not.toContain('live-matches-feed');
  });
  it('reports every violation with its rule and ends with the count', () => {
    expect(rules(old)).toEqual(['stated-once', 'headline-window', 'headline-window', 'callout-floor', 'scoped-board', 'unmeasured-largest', 'live-matches-feed']);
    expect(report(critique(fixed))).toEqual(['no violations']);
    expect(report(critique(old)).at(-1)).toBe('7 violations');
  });
});
