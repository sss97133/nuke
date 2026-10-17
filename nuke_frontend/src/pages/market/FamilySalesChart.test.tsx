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

it('answers same car, same miles when the family has a like-for-like index: one panel, the blue line, the change and its chips', async () => {
  const sales = [
    ...Array.from({ length: 12 }, (_, k) => sale(k + 1, 10 + 8 * k, 100000 + k * 1000, 'Bring a Trailer')),
    ...[13, 14, 15, 16, 17].map((i) => sale(i, 380 + i * 5, 90000, 'Bring a Trailer')),
  ];
  const q = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
  const index = {
    period_kind: 'quarter', fitted_at: '2026-10-16T11:20:00Z', stale: false, counts: { n_last12: 79, n_prior12: 43, n_total: 334 },
    change: { verdict: 'up', change_12m: 0.388, lo: 0.295, hi: 0.488, n_prior12: 43, n_last12: 79, raw_change: 0.375, pairs: 23, rs_change: 0.52,
      chips: [
        { key: 'coupe-f1', label: 'Coupe F1', change_12m: 0.41, lo: 0.3, hi: 0.52, n_prior12: 20, n_last12: 31, verdict: 'up' },
        { key: '16m', label: 'Scuderia / 16M', change_12m: null, lo: null, hi: null, n_prior12: 2, n_last12: 4, verdict: 'too few to tell' }] },
    series: [400, 300, 200, 100, 10].map((d, i) => ({ period_start: q(d), index_usd: 100000 + i * 10000, lo_usd: 90000 + i * 10000,
      hi_usd: 110000 + i * 10000, n: 20, raw_median_usd: 95000 + i * 12000 })),
  };
  fixture.rpc.mockImplementation((fn: string) => Promise.resolve(fn === 'treemap_family_sales' ? { data: value(sales), error: null }
    : fn === 'family_price_index_read' ? { data: index, error: null } : { data: null, error: { message: 'none' } }));
  await act(async () => root.render(<FamilySalesChart brand="Ferrari" familyKey="f430" family="F430" width={900} height={500} onOpen={() => {}} />));
  expect(fixture.rpc).toHaveBeenCalledWith('family_price_index_read', { p_brand: 'Ferrari', p_family_key: 'f430' });
  expect(container.querySelector('.family-sales')?.classList.contains('family-sales--indexed')).toBe(true);
  expect(container.querySelector('.family-index__answer')?.textContent).toBe('▲39% in 12 months');
  expect(container.querySelector('.family-index')?.textContent).toContain('±10 points (95%) · 122 sales in the two years · plain median said ▲38%');
  // one readable segment is not a row worth drawing
  expect(container.querySelectorAll('.family-index__chip')).toHaveLength(0);
  expect(container.querySelector('.family-index__evidence')?.textContent).toContain('plain median said');
  expect(container.querySelectorAll('svg.family-sales__plot')).toHaveLength(1);
  expect(container.querySelector('path.family-sales__ref')?.getAttribute('d')).toMatch(/^M/);
  expect(container.querySelector('path.family-sales__ref-band')).not.toBeNull();
  expect(container.querySelector('path.family-sales__median--plain')).not.toBeNull();
  expect(container.querySelector('.family-sales__move')).toBeNull();
});

it('keeps the segment chips when at least two carry a number, and says what the plain median said from the sales it has', async () => {
  // 12 sales in the last year at about $100k, 12 the year before at about $150k: a plain median that fell by a third
  const sales = Array.from({ length: 24 }, (_, k) => sale(k + 1, 10 + 30 * k, (k < 12 ? 100000 : 150000) + k * 100, 'Bring a Trailer'));
  const index = { period_kind: 'quarter', fitted_at: '2026-10-16T11:20:00Z', stale: false, counts: { n_last12: 12, n_prior12: 12, n_total: 200 },
    change: { verdict: 'flat', change_12m: 0.01, lo: -0.02, hi: 0.04, n_last12: 40, n_prior12: 35, chips: [
      { key: 'a', label: 'C2 1963–67', change_12m: 0.05, lo: 0.01, hi: 0.09, n_last12: 20, n_prior12: 18, verdict: 'up' },
      { key: 'b', label: 'C8 2020+', change_12m: -0.11, lo: -0.18, hi: -0.04, n_last12: 30, n_prior12: 22, verdict: 'down' },
      { key: 'c', label: 'C5 1997–2004', change_12m: null, lo: null, hi: null, n_last12: 3, n_prior12: 2, verdict: 'too few to tell' }] },
    series: [400, 300, 200, 100, 10].map((d, i) => ({ period_start: new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10),
      index_usd: 100000 + i, lo_usd: 95000, hi_usd: 105000, n: 20, raw_median_usd: 120000 })) };
  fixture.rpc.mockImplementation((fn: string) => Promise.resolve(fn === 'treemap_family_sales' ? { data: value(sales), error: null }
    : fn === 'family_price_index_read' ? { data: index, error: null } : { data: null, error: { message: 'none' } }));
  await act(async () => root.render(<FamilySalesChart brand="Chevrolet" familyKey="vette" family="Corvette" width={900} height={500} onOpen={() => {}} />));
  expect([...container.querySelectorAll('.family-index__chip')].map((c) => c.textContent)).toEqual(['C2 1963–67 ▲5%', 'C8 2020+ ▼11%', 'C5 1997–2004 too few']);
  expect(container.querySelector('.family-index__evidence')?.textContent).toMatch(/plain median said ▼\d+%/);
});

it('renders automotive generation cohort pills and scopes plotted sales when an era is selected', async () => {
  const mk = (i: number, ago: number, usd: number, year: number): Sale =>
    ({ vehicle_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, sale_date: day(ago), usd, source: 'Bring a Trailer', year, model: 'Mustang' });
  const sales: Sale[] = [
    ...Array.from({ length: 10 }, (_, k) => mk(k + 1, 15 + k * 10, 45_000 + k * 500, 1967)),
    ...Array.from({ length: 8 }, (_, k) => mk(k + 20, 20 + k * 10, 22_000 + k * 500, 1989)),
  ];
  const onSelectEra = vi.fn();
  fixture.rpc.mockResolvedValue({ data: value(sales), error: null });
  await act(async () => root.render(
    <FamilySalesChart brand="Ford" familyKey="mustang" family="Mustang" width={900} height={500} onOpen={() => {}} selectedEra={null} onSelectEra={onSelectEra} />,
  ));
  const eraBtns = [...container.querySelectorAll('button.family-sales__era')];
  expect(eraBtns.map((b) => b.textContent)).toEqual([
    'All eras',
    "1st Gen '64–'73 (10)",
    "Fox Body '79–'93 (8)",
  ]);
  expect(container.querySelectorAll('svg.family-sales__plot circle')).toHaveLength(18);
  await act(async () => (eraBtns[2] as HTMLButtonElement).click());
  expect(onSelectEra).toHaveBeenCalledWith('1979-1993');

  await act(async () => root.render(
    <FamilySalesChart brand="Ford" familyKey="mustang" family="Mustang" width={900} height={500} onOpen={() => {}} selectedEra="1979-1993" onSelectEra={onSelectEra} />,
  ));
  expect(container.querySelectorAll('svg.family-sales__plot circle')).toHaveLength(8);
});

it('reserves vertical headroom for multi-row index chips and generation pills so panels never overlap the header or legend', async () => {
  const mk = (i: number, ago: number, usd: number, year: number): Sale =>
    ({ vehicle_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, sale_date: day(ago), usd, source: 'Bring a Trailer', year, model: 'Mustang' });
  const sales: Sale[] = [
    ...Array.from({ length: 10 }, (_, k) => mk(k + 1, 15 + k * 10, 45_000 + k * 500, 1967)),
    ...Array.from({ length: 10 }, (_, k) => mk(k + 20, 20 + k * 10, 32_000 + k * 500, 1972)),
    ...Array.from({ length: 10 }, (_, k) => mk(k + 40, 25 + k * 10, 22_000 + k * 500, 1989)),
    ...Array.from({ length: 10 }, (_, k) => mk(k + 60, 30 + k * 10, 25_000 + k * 500, 1998)),
    ...Array.from({ length: 10 }, (_, k) => mk(k + 80, 35 + k * 10, 30_000 + k * 500, 2008)),
  ];
  const index = {
    period_kind: 'month',
    fitted_at: '2026-10-16T11:20:00Z',
    stale: false,
    counts: { n_last12: 1820, n_prior12: 1626, n_total: 7157 },
    change: {
      verdict: 'up',
      change_12m: 0.0388,
      lo: 0.0129,
      hi: 0.0654,
      n_last12: 1820,
      n_prior12: 1626,
      chips: [
        { key: 's197', label: 'S197 2005–14', change: 0.0257, lo: -0.0212, hi: 0.0747, n_last12: 362, n_prior12: 337, verdict: 'flat' },
        { key: 'g1-64-66', label: '1964½–66', change: 0.0139, lo: -0.0333, hi: 0.0635, n_last12: 329, n_prior12: 299, verdict: 'flat' },
        { key: 'sn95', label: 'SN95 1994–2004', change: 0.087, lo: 0.0177, hi: 0.161, n_last12: 171, n_prior12: 172, verdict: 'up' },
        { key: 's550', label: 'S550 2015–23', change: null, lo: null, hi: null, n_last12: 255, n_prior12: 212, verdict: 'too few to tell' },
        { key: 'fox', label: 'Fox 1979–93', change: null, lo: null, hi: null, n_last12: 239, n_prior12: 202, verdict: 'too few to tell' },
        { key: 's650', label: 'S650 2024+', change: null, lo: null, hi: null, n_last12: 19, n_prior12: 12, verdict: 'too few to tell' },
      ],
    },
    series: [],
  };
  fixture.rpc.mockImplementation((fn: string) =>
    Promise.resolve(fn === 'treemap_family_sales' ? { data: value(sales), error: null }
      : fn === 'family_price_index_read' ? { data: index, error: null }
      : { data: null, error: { message: 'none' } }),
  );
  await act(async () => root.render(
    <FamilySalesChart brand="Ford" familyKey="mustang" family="Mustang" width={1000} height={420} onOpen={() => {}} selectedEra={null} onSelectEra={() => {}} />,
  ));
  const rootEl = container.querySelector('.family-sales')!;
  expect([...rootEl.children].map((el) => el.className)).toEqual([
    'family-sales__head',
    'family-sales__legend',
    'family-sales__panels',
  ]);
  const plotEl = container.querySelector('svg.family-sales__plot')!;
  // With 2 rows of panels in a 420px container and extra headroom for chips + eras (92 + 44 + 28 = 164),
  // each panel height is floor((420 - 164 - 6) / 2) = 125 (< 161 without headroom).
  expect(Number(plotEl.getAttribute('height'))).toBe(125);
});

