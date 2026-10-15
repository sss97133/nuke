// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
import FamilySalesChart, { batMove, logTicks, parseFamilySales, rollingMedian, venueOf, type Sale } from './FamilySalesChart';

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
  expect(container.querySelector('.family-sales__plot')?.getAttribute('aria-label')).toBe('911: 12 sales over five years, price against date');
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
