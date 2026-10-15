// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
import FamilySalesChart, { batMove, eraMoves, eraOf, logTicks, mixFixed, parseFamilySales, quantile, rollingBand, rollingMedian, venueOf, type Sale } from './FamilySalesChart';

const DAY = 86_400_000;
const now = Date.now();
const day = (n: number) => new Date(now - n * DAY).toISOString().slice(0, 10);
const sale = (i: number, ago: number, usd: number, source: string | null): Sale =>
  ({ vehicle_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, sale_date: day(ago), usd, source, year: 1990, model: '911 Carrera' });
// The reader's one value (20261015234500): n in the window and the newest rows as arrays.
const value = (sales: Sale[], n = sales.length) => ({ n, returned: sales.length, truncated: n > sales.length, window_from: day(1825),
  rows: sales.map((s) => [s.vehicle_id, s.sale_date, s.usd, s.source, s.year, s.model]) });

describe('the chart\'s arithmetic', () => {
  it('ticks a log price axis on the 1-2.5-5 ladder', () => {
    expect(logTicks(8000, 120000)).toEqual([10000, 25000, 50000, 100000]);
  });
  it('draws a rolling median only where five sales stand inside the window', () => {
    const pts = [0, 1, 2, 3, 4, 200].map((d, i) => ({ t: d * DAY, usd: [10, 20, 30, 40, 50, 99][i] }));
    const line = rollingMedian(pts);
    expect(line[0]).toEqual({ t: 0, usd: 30 });
    expect(line.every((p) => p.usd !== 99)).toBe(true);
  });
  it('reads BaT\'s median last 12 months against the 12 before, and nothing under 5 a year', () => {
    const sales = [
      ...[1, 2, 3, 4, 5].map((i) => sale(i, 30 * i, 100000 + i * 1000, 'Bring a Trailer')),
      ...[6, 7, 8, 9, 10].map((i) => sale(i, 400 + i, 80000 + i * 1000, 'Bring a Trailer')),
      sale(11, 20, 900000, 'Gooding & Co'),
    ];
    expect(batMove(sales, now)).toEqual({ last: 103000, prior: 88000, nLast: 5, nPrior: 5 });
    expect(batMove(sales.slice(0, 9), now)).toBeNull();
  });
  it('groups venues, with an unknown or missing venue as other', () => {
    expect(venueOf('Bring a Trailer').key).toBe('bat');
    expect(venueOf("RM Sotheby's").key).toBe('house');
    expect(venueOf('Somewhere').key).toBe('other');
    expect(venueOf(null).key).toBe('other');
  });
});

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); fixture.rpc.mockReset(); });

it('draws one dot per sale, the venues with their counts, and BaT\'s 12-month median', async () => {
  const sales = [
    ...[1, 2, 3, 4, 5, 6].map((i) => sale(i, 20 * i, 100000 + i * 1000, 'Bring a Trailer')),
    ...[7, 8, 9, 10, 11].map((i) => sale(i, 380 + i * 5, 90000, 'Bring a Trailer')),
    sale(12, 50, 250000, 'Mecum'),
  ];
  fixture.rpc.mockResolvedValue({ data: value(sales), error: null });
  await act(async () => root.render(<FamilySalesChart brand="Porsche" familyKey="f911" family="911" width={900} height={500} onOpen={() => {}} />));
  expect(fixture.rpc).toHaveBeenCalledWith('treemap_family_sales', { p_brand: 'Porsche', p_family_key: 'f911' });
  expect(container.querySelectorAll('svg.family-sales__plot circle')).toHaveLength(12);
  expect([...container.querySelectorAll('.family-sales__venue')].map((n) => n.textContent)).toEqual(['BaT 11', 'Mecum 1']);
  expect(container.querySelector('.family-sales__move')?.textContent).toContain('BaT median, last 12 mo (6)');
  expect(container.querySelector('.family-sales__plot')?.getAttribute('aria-label')).toBe('911 1990s: 12 sales over five years, price against date');
});

it('says so when the family has no dated sales, or the read fails', async () => {
  fixture.rpc.mockResolvedValue({ data: value([]), error: null });
  await act(async () => root.render(<FamilySalesChart brand="Porsche" familyKey="f" family="959" width={900} height={500} onOpen={() => {}} />));
  expect(container.textContent).toContain('No dated sales of this family in the last five years.');
  fixture.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
  await act(async () => root.render(<FamilySalesChart brand="Porsche" familyKey="g" family="917" width={900} height={500} onOpen={() => {}} />));
  expect(container.textContent).toContain('The sales of this family could not be read.');
});

it('reads the one value, says when it holds back older sales, and refuses any other shape', async () => {
  const sales = [1, 2, 3, 4, 5, 6].map((i) => sale(i, 20 * i, 100000 + i * 1000, 'Bring a Trailer'));
  expect(parseFamilySales(value(sales))?.sales).toEqual(sales);
  expect(parseFamilySales(sales)).toBeNull(); // the old set of objects
  expect(parseFamilySales({ n: 1, rows: [{ vehicle_id: 'x' }] })).toBeNull();
  expect(parseFamilySales(null)).toBeNull();
  fixture.rpc.mockResolvedValue({ data: value(sales, 15000), error: null });
  await act(async () => root.render(<FamilySalesChart brand="Porsche" familyKey="f911" family="911" width={900} height={500} onOpen={() => {}} />));
  expect(container.querySelector('.family-sales__title')?.textContent).toContain('newest 6 of 15,000 sales with a date since');
  fixture.rpc.mockResolvedValue({ data: sales, error: null });
  await act(async () => root.render(<FamilySalesChart brand="Porsche" familyKey="g911" family="911" width={900} height={500} onOpen={() => {}} />));
  expect(container.textContent).toContain('The sales of this family could not be read.');
});

it('counts a sale under the $500 floor in the caption and does not draw it below the axis', async () => {
  const sales = [...[1, 2, 3, 4, 5, 6].map((i) => sale(i, 20 * i, 100000 + i * 1000, 'Bring a Trailer')), sale(7, 30, 320, 'Bring a Trailer')];
  fixture.rpc.mockResolvedValue({ data: value(sales), error: null });
  await act(async () => root.render(<FamilySalesChart brand="Porsche" familyKey="f911" family="911" width={900} height={500} onOpen={() => {}} />));
  expect(container.querySelectorAll('svg.family-sales__plot circle')).toHaveLength(6);
  expect(container.querySelector('.family-sales__title')?.textContent).toContain('7 sales with a date since');
  expect(container.querySelector('.family-sales__title')?.textContent).toContain('1 under $500 not drawn');
});

it('hides a venue from the legend: its dots go, the median follows the rest, the axis stays', async () => {
  const sales = [...[1, 2, 3, 4, 5, 6].map((i) => sale(i, 20 * i, 100000 + i * 1000, 'Bring a Trailer')),
    sale(7, 40, 250000, 'Mecum'), sale(8, 60, 240000, 'Mecum')];
  fixture.rpc.mockResolvedValue({ data: value(sales), error: null });
  await act(async () => root.render(<FamilySalesChart brand="Porsche" familyKey="fvenue" family="911" width={900} height={500} onOpen={() => {}} />));
  const dots = () => container.querySelectorAll('svg.family-sales__plot circle').length;
  const ticks = () => [...container.querySelectorAll('.family-sales__axis')].map((n) => n.textContent).join(',');
  expect(dots()).toBe(8);
  const before = ticks();
  const mecum = [...container.querySelectorAll('button.family-sales__venue')].find((b) => b.textContent?.startsWith('Mecum'))!;
  expect(mecum.getAttribute('aria-pressed')).toBe('true');
  await act(async () => (mecum as HTMLButtonElement).click());
  expect(dots()).toBe(6);
  expect(mecum.getAttribute('aria-pressed')).toBe('false');
  expect(container.querySelector('.family-sales__title')?.textContent).toContain('· 6 shown');
  expect(ticks()).toBe(before);
  await act(async () => (mecum as HTMLButtonElement).click());
  expect(dots()).toBe(8);
});

describe('the chart by model-year decade', () => {
  it('bands a sale by its model year\'s decade, and an unknown year as such', () => {
    expect(eraOf(1995)).toBe('1990s');
    expect(eraOf(2004)).toBe('2000s');
    expect(eraOf(null)).toBe('year unknown');
    expect(eraOf(0)).toBe('year unknown');
  });
  it('interpolates quantiles and draws the middle half only where enough sales stand', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([10, 20, 30, 40, 50], 0.25)).toBe(20);
    const pts = Array.from({ length: 10 }, (_, i) => ({ t: i * DAY, usd: 100 + i }));
    const band = rollingBand(pts, 14, 60, 8);
    expect(band[0]).toEqual({ t: 0, p25: quantile(pts.map((p) => p.usd), 0.25), p50: quantile(pts.map((p) => p.usd), 0.5), p75: quantile(pts.map((p) => p.usd), 0.75) });
    expect(rollingBand(pts.slice(0, 5), 14, 60, 8)).toEqual([]);
  });
  it('holds last year\'s mix of decades: a shift toward dear decades does not read as a price rise', () => {
    // 1990s cheap, 2020s dear; both flat in price; the last year sold more of the dear ones.
    const mk = (i: number, ago: number, usd: number, year: number): Sale =>
      ({ vehicle_id: `v${i}`, sale_date: day(ago), usd, source: 'Bring a Trailer', year, model: '911' });
    const sales: Sale[] = [];
    let i = 0;
    for (let k = 0; k < 20; k++) sales.push(mk(i++, 400, 50_000, 1995));
    for (let k = 0; k < 20; k++) sales.push(mk(i++, 400, 200_000, 2021));
    for (let k = 0; k < 20; k++) sales.push(mk(i++, 30, 50_000, 1996));
    for (let k = 0; k < 60; k++) sales.push(mk(i++, 30, 200_000, 2022));
    const moves = eraMoves(sales, now);
    expect(moves.map((m) => m.era)).toEqual(['1990s', '2020s']);
    expect(moves.every((m) => m.last === m.prior)).toBe(true);
    expect(mixFixed(moves)).toEqual({ change: 0, nLast: 80, nPrior: 40, eras: 2 });
    expect(batMove(sales, now)!.last).toBeGreaterThan(batMove(sales, now)!.prior);
  });
  it('says nothing for one decade, or under 15 BaT sales a year in a decade', () => {
    expect(mixFixed([{ era: '1990s', last: 2, prior: 1, nLast: 20, nPrior: 20 }])).toBeNull();
    const few: Sale[] = Array.from({ length: 10 }, (_, k) => ({ vehicle_id: `f${k}`, sale_date: day(30 + 400 * (k % 2)), usd: 9000, source: 'Bring a Trailer', year: 1970, model: '911' }));
    expect(eraMoves(few, now)).toEqual([]);
  });
});

it('draws a panel per decade with eight or more sales, counts the rest, and counts sales past the price axis', async () => {
  const mk = (i: number, ago: number, usd: number, year: number | null): Sale =>
    ({ vehicle_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, sale_date: day(ago), usd, source: 'Bring a Trailer', year, model: '911' });
  const sales: Sale[] = [];
  let i = 1;
  for (let k = 0; k < 40; k++) sales.push(mk(i++, 10 + k * 20, 60_000 + k * 1000, 1995));
  for (let k = 0; k < 40; k++) sales.push(mk(i++, 15 + k * 20, 150_000 + k * 1000, 2016));
  for (let k = 0; k < 3; k++) sales.push(mk(i++, 30 + k, 900_000, 1973));
  sales.push(mk(i++, 40, 3_400_000, 2019));
  fixture.rpc.mockResolvedValue({ data: value(sales), error: null });
  await act(async () => root.render(<FamilySalesChart brand="Porsche" familyKey="f911" family="911" width={1200} height={600} onOpen={() => {}} />));
  const labels = [...container.querySelectorAll('svg.family-sales__plot')].map((p) => p.getAttribute('aria-label'));
  expect(labels).toEqual(['911 1990s: 40 sales over five years, price against date', '911 2010s: 41 sales over five years, price against date']);
  expect(container.querySelector('.family-sales__title')?.textContent).toContain('3 with a rare or unknown model year not drawn');
  expect(container.querySelectorAll('svg.family-sales__plot path.family-sales__edge').length).toBeGreaterThan(0);
  expect(container.querySelector('.family-sales__title')?.textContent).toMatch(/· \d+ outside \$[\d.]+K–\$[\d.]+[KM] on the edge/);
});
