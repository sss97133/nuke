import { describe, expect, it } from 'vitest';
import { batBaseline, callouts, fitName, gateMinForHorizon, housesPhrase, measuredHouses, moveFill, moveText, moveTextShort, pct, relativeMove, tileClass, tileName, DEFAULT_MEASURED_HOUSES } from './mapScale';

const brands = [
  { count: 28_480, dated: 20_000, sold_12m: 4_506, sold_prior_12m: 3_817 },
  { count: 30_811, dated: 20_000, sold_12m: 2_000, sold_prior_12m: 2_400 },
  { count: 500, dated: 400, sold_12m: 7, sold_prior_12m: 30 },
  { count: 2_000, dated: 100, sold_12m: 90, sold_prior_12m: 80 },
  { count: 100 },
];
const width = (t: string) => t.length * 0.7;

describe('the map baseline', () => {
  it('is BaT over the brands that carry both years', () => {
    const b = batBaseline(brands)!;
    expect(b.sold).toBe(4_506 + 2_000 + 7 + 90);
    expect(b.prior).toBe(3_817 + 2_400 + 30 + 80);
    expect(b.move).toBeCloseTo(b.sold / b.prior - 1, 9);
  });
  it('is unknown with nothing a year earlier', () => {
    expect(batBaseline([{ count: 1, sold_12m: 5, sold_prior_12m: 0 }])).toBeNull();
    expect(batBaseline(null)).toBeNull();
  });
});

describe('a tile’s move', () => {
  const base = { sold: 100, prior: 80, move: 0.25 };
  it('is relative to BaT: a brand that grew as fast as the venue reads zero', () => {
    const m = relativeMove({ count: 10_000, dated: 8_000, sold_12m: 125, sold_prior_12m: 100 }, base);
    expect(m.kind).toBe('move');
    if (m.kind === 'move') { expect(m.raw).toBeCloseTo(0.25, 9); expect(m.rel).toBeCloseTo(0, 9); }
    const slower = relativeMove({ count: 10_000, dated: 8_000, sold_12m: 110, sold_prior_12m: 100 }, base);
    if (slower.kind === 'move') expect(slower.rel).toBeCloseTo(1.1 / 1.25 - 1, 9);
    expect(moveText(slower)).toBe('▼12%');
  });
  it('says too few under 20 sales in either year, or when BaT holds under half the sales, and shows the count', () => {
    expect(relativeMove(brands[2], base)).toEqual({ kind: 'few', sold: 7, prior: 30, why: 'count' });
    expect(moveText(relativeMove(brands[2], base))).toBe('too few sales');
    expect(relativeMove(brands[3], base, true)).toMatchObject({ kind: 'few', why: 'share' });
    expect(moveText(relativeMove(brands[3], base, true))).toBe('mostly unmeasured houses');
    expect(moveTextShort(relativeMove(brands[2], base))).toBe('few sales');
    expect(moveTextShort(relativeMove(brands[3], base, true))).toBe('unmeasured');
  });
  it('sized by BaT itself, a tile is BaT\'s, so the share of other venues does not gate it', () => {
    expect(relativeMove(brands[3], base).kind).toBe('move');
  });
  it('is no data without BaT counts, or with none in either year, which is not the same as no change', () => {
    expect(relativeMove(brands[4], base)).toEqual({ kind: 'none' });
    expect(relativeMove({ count: 9, sold_12m: 0, sold_prior_12m: 0 }, base)).toEqual({ kind: 'none' });
    expect(moveText({ kind: 'none' })).toBe('');
  });
  it('scales the minimum gate across horizons so shorter windows color meaningfully', () => {
    expect(gateMinForHorizon('1y')).toBe(20);
    expect(gateMinForHorizon('1w')).toBe(2);
    expect(gateMinForHorizon('upcoming')).toBe(4);
    expect(relativeMove({ count: 500, dated: 400, sold_12m: 7, sold_prior_12m: 5 }, base, true, gateMinForHorizon('upcoming')).kind).toBe('move');
  });
});

describe('a brand measured over the stable houses (treemap_brand_market, read 2026-10-19)', () => {
  // The measured houses are the ones held in full in both windows (v_market_house_coverage.qualified_measured):
  // Bring a Trailer, Mecum and Bonhams. `count` is every house's confirmed sales; `dated` is the measured houses'.
  const houses = ['Bring a Trailer', 'Mecum', 'Bonhams'];
  const base = { sold: 60_000, prior: 52_000, move: 60_000 / 52_000 - 1 };
  const chevrolet = { count: 51_134, dated: 36_207, sold_12m: 7_115, sold_prior_12m: 6_153 };
  const harley = { count: 2_026, dated: 1_923, sold_12m: 532, sold_prior_12m: 378 };
  const tesla = { count: 916, dated: 163, sold_12m: 33, sold_prior_12m: 33 };
  it('reads Chevrolet and Harley-Davidson as a move, with the houses it was measured at', () => {
    const c = relativeMove(chevrolet, base, true, 20, houses);
    expect(c.kind).toBe('move');
    if (c.kind === 'move') { expect(c.raw).toBeCloseTo(7_115 / 6_153 - 1, 9); expect(c.houses).toEqual(houses); }
    const h = relativeMove(harley, base, true, 20, houses);
    expect(h).toMatchObject({ kind: 'move', sold: 532, prior: 378, houses });
  });
  it('keeps Tesla "mostly unmeasured houses": 728 of its 916 sales are at Cars & Bids, which has no by-year census', () => {
    const t = relativeMove(tesla, base, true, 20, houses);
    expect(t).toMatchObject({ kind: 'few', why: 'share', sold: 33, prior: 33, houses });
    expect(moveText(t)).toBe('mostly unmeasured houses');
  });
  it('never lends the measured houses\' move to a brand sold only at live-auction houses', () => {
    // 600 confirmed sales, 25 of them at measured houses, which happen to clear the count gate both years.
    const live = { count: 600, dated: 25, sold_12m: 25, sold_prior_12m: 22 };
    expect(relativeMove(live, base, true, 20, houses)).toMatchObject({ kind: 'few', why: 'share' });
    expect(relativeMove({ count: 600, dated: 0, sold_12m: 0, sold_prior_12m: 0 }, base, true, 20, houses)).toEqual({ kind: 'none' });
    expect(relativeMove({ count: 600 }, base, true, 20, houses)).toEqual({ kind: 'none' });
  });
  it('names the houses from the refresh receipt, or the 2026-10-18 three when the receipt is absent', () => {
    expect(measuredHouses(['Bring a Trailer', 'Mecum', 'Bonhams', 'Cars & Bids'])).toEqual(['Bring a Trailer', 'Mecum', 'Bonhams', 'Cars & Bids']);
    expect(measuredHouses(null)).toBe(DEFAULT_MEASURED_HOUSES);
    expect(measuredHouses([])).toBe(DEFAULT_MEASURED_HOUSES);
    expect(housesPhrase(['Bring a Trailer', 'Mecum', 'Bonhams'])).toBe('Bring a Trailer, Mecum and Bonhams');
    expect(housesPhrase(['Bring a Trailer'])).toBe('Bring a Trailer');
    expect(relativeMove(chevrolet, base, true).kind === 'move' && 'houses' in relativeMove(chevrolet, base, true)).toBe(false);
  });
});

describe('the color scale', () => {
  it('lands on the stops, mixes between them, and clamps at ±50%', () => {
    expect(moveFill(0)).toBe('var(--map-4)');
    expect(moveFill(0.5)).toBe('var(--map-7)');
    expect(moveFill(-0.5)).toBe('var(--map-1)');
    expect(moveFill(1.86)).toBe('var(--map-7)');
    expect(moveFill(-0.9)).toBe('var(--map-1)');
    expect(moveFill(1 / 12)).toBe('color-mix(in oklch, var(--map-4) 50%, var(--map-5))');
  });
});

describe('a tile’s name', () => {
  it('sorts tiles into size classes', () => {
    expect(tileClass(440, 259)).toBe('XL');
    expect(tileClass(120, 90)).toBe('L');
    expect(tileClass(70, 40)).toBe('M');
    expect(tileClass(40, 30)).toBe('S');
  });
  it('is as large as the tile allows, at most 28 px, and whole', () => {
    expect(fitName('FERRARI', 440, 259, width)).toBe(28);
    const size = fitName('PORSCHE', 120, 90, width)!;
    expect(size).toBe(Math.floor(0.17 * Math.sqrt(120 * 90)));
    expect(size * width('PORSCHE')).toBeLessThanOrEqual(120 - 12);
  });
  it('is left out rather than cut when it would go under its class minimum', () => {
    expect(fitName('MERCEDES-BENZ', 120, 90, width)).toBeNull();
    expect(fitName('ROLLS-ROYCE', 70, 40, width)).toBeNull();
    expect(fitName('KIA', 70, 40, width)).toBe(11);
    expect(fitName('KIA', 30, 30, width)).toBeNull();
  });
});

describe('a tile’s printed name', () => {
  it('falls back to the short name before going silent', () => {
    expect(tileName('Mercedes-Benz', 120, 90, width)).toMatchObject({ text: 'Mercedes' });
    expect(tileName('Porsche', 120, 90, width)).toMatchObject({ text: 'Porsche' });
    expect(tileName('Duesenberg', 60, 50, width)).toBeNull();
  });
});

describe('a move printed', () => {
  it('has no arrow when it rounds to zero', () => {
    expect(pct(0.004)).toBe('0%');
    expect(pct(-0.004)).toBe('0%');
    expect(pct(0.05)).toBe('▲5%');
    expect(pct(-0.1)).toBe('▼10%');
  });
});

describe('the map\'s callouts', () => {
  const base = { sold: 1000, prior: 1000, move: 0 };
  const node = (name: string, sold: number, prior: number, usd_12m: number) => ({ name, count: sold * 4, dated: sold * 4, sold_12m: sold, sold_prior_12m: prior, usd_12m });
  it('names the clearest gain and loss against BaT and the largest tile, each with its counts', () => {
    const c = callouts([node('Porsche', 4506, 4290, 462e6), node('Ferrari', 856, 588, 231e6), node('BMW', 2786, 3100, 82e6),
      node('Lotus', 30, 20, 2e6)], base);
    expect(c.map((x) => `${x.kind} ${x.name} ${x.prior}→${x.sold}`)).toEqual(['gain Ferrari 588→856', 'loss BMW 3100→2786', 'largest Porsche 4290→4506']);
  });
  it('leaves out a move inside its noise, however large it looks', () => {
    // Lotus 20 -> 30 is +50%, but on 20 and 30 sales that is under 2 standard errors.
    expect(callouts([node('Lotus', 30, 20, 2e6)], base).filter((x) => x.kind !== 'largest')).toEqual([]);
  });
  it('does not repeat the largest tile when it is already the gain or the loss', () => {
    expect(callouts([node('Ferrari', 856, 588, 231e6), node('Kia', 25, 24, 1e6)], base).map((x) => x.kind)).toEqual(['gain']);
  });
  it('leaves a clear move out when its tile holds under 0.5% of the window\'s dollars', () => {
    // 2026-10-17: Ariel 21 -> 61 (+190%, $2.5M of $3.0B) cleared the noise test and outranked Ferrari's gain.
    const c = callouts([node('Ferrari', 1061, 712, 450e6), node('Porsche', 4690, 4023, 510e6), node('BMW', 2700, 2967, 90e6),
      node('Ariel', 61, 21, 2.5e6), node('Kawasaki', 60, 148, 1.4e6)], base);
    expect(c.map((x) => `${x.kind} ${x.name}`)).toEqual(['gain Ferrari', 'loss BMW', 'largest Porsche']);
  });
  it('leaves a clear move out when either window holds under twice the color\'s sales gate', () => {
    const c = callouts([node('Porsche', 4000, 4000, 510e6), node('Lotus', 100, 39, 60e6)], base);
    expect(c.find((x) => x.kind === 'gain')).toBeUndefined();
    expect(callouts([node('Porsche', 4000, 4000, 510e6), node('Lotus', 100, 40, 60e6)], base).find((x) => x.kind === 'gain')?.name).toBe('Lotus');
  });
});
