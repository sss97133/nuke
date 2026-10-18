// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
import FamilyMovers, { axisX, move, parseShareMovers } from './FamilyMovers';

// The share reader's value (treemap_family_share_movers), shaped as production answers.
const value = {
  as_of: '2026-10-15T09:50:00Z', min_sales: 30, families: 1186, eligible: 150, significant: 61,
  bat: { sold_12m: 38879, sold_prior_12m: 34598, usd_12m: 1_980_000_000, usd_prior_12m: 1_560_000_000 },
  gaining: [{ brand: 'Lexus', family_key: 'gx', family: 'GX', sold_12m: 109, sold_prior_12m: 38, usd_12m: 4_796_000,
    usd_prior_12m: 1_900_000, share_move: 1.5501, share_lo: 0.7, share_hi: 2.8, se: 0.188, avg_price_move: -0.12 }],
  losing: [{ brand: 'Acura', family_key: 'fint', family: 'Integra', sold_12m: 36, sold_prior_12m: 49, usd_12m: 800_000,
    usd_prior_12m: 1_428_571, share_move: -0.3462, share_lo: -0.55, share_hi: -0.05, se: 0.22, avg_price_move: -0.24 }],
};
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.resetModules(); fixture.rpc.mockReset(); });

it('says a move the way the map does: up or down and how much', () => {
  expect(move(92, 46)).toBe('▲100%');
  expect(move(36, 49)).toBe('▼27%');
  expect(move(5, 0)).toBe('');
});

it('reads the share reader\'s value and refuses anything else', () => {
  expect(parseShareMovers(value)?.gaining[0].family).toBe('GX');
  expect(parseShareMovers({ ...value, bat: { sold_12m: 1, sold_prior_12m: 0 } })).toBeNull();
  expect(parseShareMovers([value])).toBeNull();
  expect(parseShareMovers(null)).toBeNull();
  expect(parseShareMovers({ ...value, gaining: [{ brand: 'X' }] })?.gaining).toEqual([]);
});

it('puts a halving and a doubling at equal distances from no change, and clamps beyond them', () => {
  expect(axisX(0, 120)).toBeCloseTo(60, 6);
  expect(axisX(-0.5, 120)).toBeCloseTo(0, 6);
  expect(axisX(1, 120)).toBeCloseTo(120, 6);
  expect(axisX(4, 120)).toBe(120);
  expect(axisX(-0.9, 120)).toBe(0);
});

it('lists families gaining and losing share of BaT, volume apart from the average sale, and a pick drills the map', async () => {
  fixture.rpc.mockImplementation((fn: string) => Promise.resolve(fn === 'treemap_family_share_movers'
    ? { data: value, error: null } : { data: null, error: { message: 'none' } }));
  const onPick = vi.fn();
  await act(async () => root.render(<FamilyMovers onPick={onPick} />));
  expect(fixture.rpc).toHaveBeenCalledWith('treemap_family_share_movers', { p_limit: 5 });
  const rows = [...container.querySelectorAll('button.map-movers2__row')];
  expect(rows).toHaveLength(2);
  expect(rows[0].querySelector('.map-movers2__name')?.textContent).toBe('Lexus GX');
  expect(rows[0].querySelector('.map-movers2__move')?.textContent).toBe('▲155%');
  expect(rows[0].querySelector('.map-movers2__counts')?.textContent).toBe('38 → 109 sold');
  expect(rows[0].querySelector('.map-movers2__price')?.textContent).toBe('avg sale ▼12%');
  expect(rows[0].querySelector('path.map-movers2__mark')).not.toBeNull();
  expect(rows[1].querySelector('circle.map-movers2__mark')).not.toBeNull();
  expect(container.querySelector('.map-movers2__relativity')?.textContent).toContain('RELATIVITY');
  expect(container.querySelector('.map-movers2__relativity')?.textContent).toContain('LAST 1Y VS PRIOR 1Y');
  expect(container.querySelector('.map-movers2__relativity')?.textContent).toContain('MARKET PAR ▲12% (34,598 → 38,879)');
  expect([...container.querySelectorAll('.map-movers2__dial-btn')].map((b) => b.textContent)).toEqual([
    'UPCOMING', '1D', '1W', '1M', '3M', '6M', '1Y', '5Y',
  ]);
  expect(container.querySelector('.map-movers2__base')?.textContent).toContain("after taking out the market's own growth (▲12%, 34,598 → 38,879)");
  expect(container.querySelector('.map-movers2__base')?.textContent).toContain('61 of 150 families with 30+ measured sales each year changed for real');
  expect(container.querySelector('.map-movers2__base')?.textContent).not.toMatch(/standard error|SE range|log axis/);
  await act(async () => (rows[1] as HTMLButtonElement).click());
  expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ brand: 'Acura', family_key: 'fint', family: 'Integra' }));
});

it('stays away when the reader fails', async () => {
  const { default: Fresh } = await import('./FamilyMovers');
  fixture.rpc.mockResolvedValue({ data: null, error: { message: 'function not found' } });
  await act(async () => root.render(<Fresh onPick={() => {}} />));
  expect(container.querySelector('.map-movers2')).toBeNull();
});

it('draws a mover\'s two years as 24 bars when the monthly read answers', async () => {
  const { default: Fresh } = await import('./FamilyMovers');
  const bins = [2, 3, 4, 4, 3, 5, 4, 4, 3, 4, 5, 5, 6, 7, 6, 8, 7, 9, 8, 9, 7, 8, 9, 8];
  fixture.rpc.mockImplementation((fn: string) => Promise.resolve(fn === 'treemap_family_share_movers'
    ? { data: value, error: null }
    : { data: { anchor: '2026-10-15', window_days: 730, families: [{ brand: 'Lexus', family_key: 'gx', bins }] }, error: null }));
  await act(async () => root.render(<Fresh onPick={() => {}} />));
  await act(async () => { await Promise.resolve(); });
  expect(fixture.rpc).toHaveBeenCalledWith('treemap_family_monthly',
    { p_families: [{ brand: 'Lexus', family_key: 'gx' }, { brand: 'Acura', family_key: 'fint' }] });
  const rows = [...container.querySelectorAll('button.map-movers2__row')];
  expect(rows[0].querySelectorAll('svg.map-movers__spark rect')).toHaveLength(24);
  expect(rows[1].querySelector('svg.map-movers__spark')).toBeNull();
});

it('switches across the horizon dial (1D and UPCOMING) and renders embedded 24-bar sparklines', async () => {
  const { default: Fresh } = await import('./FamilyMovers');
  const bins24 = Array.from({ length: 24 }, (_, i) => (i % 4) + 1);
  const dayValue = {
    as_of: '2026-10-17T18:00:00Z', horizon: '1d', window_days: 1, min_sales: 1, families: 93, eligible: 15, significant: 8,
    bat: { sold_12m: 162, sold_prior_12m: 115, usd_12m: 8_100_000, usd_prior_12m: 5_200_000 },
    gaining: [{ brand: 'Ford', family_key: 'mustang', family: 'Mustang', sold_12m: 8, sold_prior_12m: 1, usd_12m: 440_000,
      usd_prior_12m: 50_000, share_move: 4.68, share_lo: 0.71, share_hi: 17.8, se: 1.06, avg_price_move: 0.10, bins: bins24 }],
    losing: [{ brand: 'Porsche', family_key: '911', family: '911', sold_12m: 7, sold_prior_12m: 8, usd_12m: 980_000,
      usd_prior_12m: 1_200_000, share_move: -0.379, share_lo: -0.77, share_hi: 0.71, se: 0.52, avg_price_move: -0.07, bins: bins24 }],
  };
  const upcomingValue = {
    as_of: '2026-10-17T18:00:00Z', horizon: 'upcoming', window_days: 30, min_sales: 4, families: 641, eligible: 129, significant: 31,
    bat: { sold_12m: 2536, sold_prior_12m: 4655, usd_12m: 135_000_000, usd_prior_12m: 220_000_000 },
    gaining: [{ brand: 'Ferrari', family_key: 'f12', family: 'F12 Berlinetta', sold_12m: 8, sold_prior_12m: 4, usd_12m: 2_800_000,
      usd_prior_12m: 1_200_000, share_move: 2.67, share_lo: 0.11, share_hi: 11.2, se: 0.61, avg_price_move: 0.17, bins: bins24 }],
    losing: [{ brand: 'BMW', family_key: '3series', family: '3 Series', sold_12m: 6, sold_prior_12m: 40, usd_12m: 210_000,
      usd_prior_12m: 1_400_000, share_move: -0.725, share_lo: -0.88, share_hi: -0.35, se: 0.44, avg_price_move: 0.0, bins: bins24 }],
  };

  fixture.rpc.mockImplementation((fn: string, args?: Record<string, unknown>) => {
    if (fn === 'treemap_family_share_movers') {
      if (args?.p_horizon === '1d') return Promise.resolve({ data: dayValue, error: null });
      if (args?.p_horizon === 'upcoming') return Promise.resolve({ data: upcomingValue, error: null });
      return Promise.resolve({ data: value, error: null });
    }
    return Promise.resolve({ data: null, error: { message: 'none' } });
  });

  await act(async () => root.render(<Fresh onPick={() => {}} />));
  const dialBtns = [...container.querySelectorAll('button.map-movers2__dial-btn')] as HTMLButtonElement[];
  const btn1d = dialBtns.find((b) => b.textContent === '1D')!;
  const btnUpcoming = dialBtns.find((b) => b.textContent === 'UPCOMING')!;

  await act(async () => btn1d.click());
  expect(fixture.rpc).toHaveBeenCalledWith('treemap_family_share_movers', { p_limit: 5, p_min_sales: 0, p_horizon: '1d' });
  expect(container.querySelector('.map-movers2__relativity')?.textContent).toContain('LAST 24H VS PRIOR 24H');
  expect(container.querySelector('.map-movers2__relativity')?.textContent).toContain('MARKET PAR ▲41% (115 → 162)');
  const dayRows = [...container.querySelectorAll('button.map-movers2__row')];
  expect(dayRows[0].querySelector('.map-movers2__name')?.textContent).toBe('Ford Mustang');
  expect(dayRows[0].querySelector('.map-movers2__counts')?.textContent).toBe('1 → 8 sold');
  expect(dayRows[0].querySelectorAll('svg.map-movers__spark rect')).toHaveLength(24);

  await act(async () => btnUpcoming.click());
  expect(fixture.rpc).toHaveBeenCalledWith('treemap_family_share_movers', { p_limit: 5, p_min_sales: 0, p_horizon: 'upcoming' });
  expect(container.querySelector('.map-movers2__relativity')?.textContent).toContain('NEXT 30D BLOCK VS PAST 30D SOLD');
  expect(container.querySelector('.map-movers2__relativity')?.textContent).toContain('SUPPLY PAR ▼46% (4,655 → 2,536)');
  const titles = [...container.querySelectorAll('.map-movers2__title')].map((t) => t.textContent);
  expect(titles).toEqual(['Coming up more', 'Coming up less']);
  const upRows = [...container.querySelectorAll('button.map-movers2__row')];
  expect(upRows[0].querySelector('.map-movers2__name')?.textContent).toBe('Ferrari F12 Berlinetta');
  expect(upRows[0].querySelector('.map-movers2__counts')?.textContent).toBe('4 sold → 8 up');
  expect(upRows[0].querySelector('.map-movers2__price')?.textContent).toBe('avg ask ▲17%');
});

it('toggles the Relativity methodology popover when clicking the RELATIVITY button and supports independent VS baseline windows', async () => {
  const { default: Fresh } = await import('./FamilyMovers');
  const weekValue = {
    as_of: '2026-10-17T18:00:00Z', horizon: '1w', window_days: 7, min_sales: 2, families: 220, eligible: 45, significant: 12,
    bat: { sold_12m: 700, sold_prior_12m: 650, usd_12m: 35_000_000, usd_prior_12m: 31_000_000 },
    family_moves: {
      'Porsche|911': [28, 18, 4_200_000, 2_700_000],
      'BMW|m3': [4, 14, 320_000, 1_120_000],
    },
    gaining: [{ brand: 'Porsche', family_key: '911', family: '911', sold_12m: 28, sold_prior_12m: 18, usd_12m: 4_200_000,
      usd_prior_12m: 2_700_000, share_move: 0.44, share_lo: 0.05, share_hi: 0.98, se: 0.30, avg_price_move: 0.0 }],
    losing: [{ brand: 'BMW', family_key: 'm3', family: 'M3', sold_12m: 4, sold_prior_12m: 14, usd_12m: 320_000,
      usd_prior_12m: 1_120_000, share_move: -0.73, share_lo: -0.91, share_hi: -0.22, se: 0.56, avg_price_move: 0.0 }],
  };
  const monthValue = {
    as_of: '2026-10-17T18:00:00Z', horizon: '1m', window_days: 30, min_sales: 5, families: 410, eligible: 90, significant: 24,
    bat: { sold_12m: 2800, sold_prior_12m: 2700, usd_12m: 140_000_000, usd_prior_12m: 132_000_000 },
    family_moves: {
      'Porsche|911': [50, 48, 7_000_000, 6_720_000],
      'BMW|m3': [45, 42, 3_600_000, 3_360_000],
    },
    gaining: [{ brand: 'Porsche', family_key: '911', family: '911', sold_12m: 50, sold_prior_12m: 48, usd_12m: 7_000_000,
      usd_prior_12m: 6_720_000, share_move: 0.01, share_lo: -0.20, share_hi: 0.25, se: 0.20, avg_price_move: 0.0 }],
    losing: [{ brand: 'BMW', family_key: 'm3', family: 'M3', sold_12m: 45, sold_prior_12m: 42, usd_12m: 3_600_000,
      usd_prior_12m: 3_360_000, share_move: 0.03, share_lo: -0.18, share_hi: 0.28, se: 0.21, avg_price_move: 0.0 }],
  };

  fixture.rpc.mockImplementation((fn: string, args?: Record<string, unknown>) => {
    if (fn === 'treemap_family_share_movers') {
      if (args?.p_horizon === '1w') return Promise.resolve({ data: weekValue, error: null });
      if (args?.p_horizon === '1m') return Promise.resolve({ data: monthValue, error: null });
      return Promise.resolve({ data: value, error: null });
    }
    return Promise.resolve({ data: null, error: { message: 'none' } });
  });

  await act(async () => root.render(<Fresh onPick={() => {}} />));

  // Popover is closed by default and opens when clicking RELATIVITY
  const relBtn = container.querySelector('button.map-movers2__rel-badge') as HTMLButtonElement;
  const popover = container.querySelector('.map-movers2__popover') as HTMLElement;
  expect(relBtn.getAttribute('aria-expanded')).toBe('false');
  expect(popover.classList.contains('map-movers2__popover--open')).toBe(false);

  await act(async () => relBtn.click());
  expect(relBtn.getAttribute('aria-expanded')).toBe('true');
  expect(popover.classList.contains('map-movers2__popover--open')).toBe(true);

  const closeBtn = container.querySelector('button.map-movers2__popover-close') as HTMLButtonElement;
  await act(async () => closeBtn.click());
  expect(relBtn.getAttribute('aria-expanded')).toBe('false');

  // Switch primary window to 1W and baseline ("VS") to 1M
  const btn1w = [...container.querySelectorAll('button.map-movers2__dial-btn')].find((b) => b.textContent === '1W') as HTMLButtonElement;
  await act(async () => btn1w.click());
  expect(container.querySelector('.map-movers2__rel-window')?.textContent).toBe('LAST 7D VS PRIOR 7D');

  const vs1m = [...container.querySelectorAll('button.map-movers2__vs-btn')].find((b) => b.textContent === '1M') as HTMLButtonElement;
  await act(async () => vs1m.click());
  expect(container.querySelector('.map-movers2__rel-window')?.textContent).toBe('LAST 7D VS 1M BASELINE');
  expect(container.querySelector('.map-movers2__rel-baseline')?.textContent).toContain('PACE PAR');
  expect(container.querySelector('.map-movers2__rel-baseline')?.textContent).toContain('2,800/1M → 700/1W');

  const rows = [...container.querySelectorAll('button.map-movers2__row')];
  expect(rows).toHaveLength(2);
  expect(rows[0].querySelector('.map-movers2__name')?.textContent).toBe('Porsche 911');
  expect(rows[0].querySelector('.map-movers2__counts')?.textContent).toBe('50 (1M) → 28 (1W)');
  expect(rows[1].querySelector('.map-movers2__name')?.textContent).toBe('BMW M3');
  expect(rows[1].querySelector('.map-movers2__counts')?.textContent).toBe('45 (1M) → 4 (1W)');
});


it('hands focus into the explanation and restores its trigger on Escape and Close', async () => {
  const { default: Fresh } = await import('./FamilyMovers');
  fixture.rpc.mockImplementation((fn: string) => Promise.resolve(fn === 'treemap_family_share_movers'
    ? { data: value, error: null } : { data: null, error: { message: 'none' } }));
  await act(async () => root.render(<Fresh onPick={() => {}} />));
  const trigger = container.querySelector<HTMLButtonElement>('.map-movers2__rel-badge')!;
  const close = container.querySelector<HTMLButtonElement>('.map-movers2__popover-close')!;
  trigger.focus();
  await act(async () => trigger.click());
  expect(document.activeElement).toBe(close);
  await act(async () => close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(trigger);
  await act(async () => trigger.click());
  await act(async () => close.click());
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(trigger);
  await act(async () => trigger.click());
  const next = container.querySelector<HTMLButtonElement>('.map-movers2__dial-btn')!;
  await act(async () => {
    next.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    next.focus();
  });
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(next);
});

it('exposes both independent window filters as named button groups with their selected states', async () => {
  const { default: Fresh } = await import('./FamilyMovers');
  fixture.rpc.mockImplementation((fn: string) => Promise.resolve(fn === 'treemap_family_share_movers'
    ? { data: value, error: null } : { data: null, error: { message: 'none' } }));
  const onHorizonChange = vi.fn();
  const onBaselineHorizonChange = vi.fn();
  await act(async () => root.render(<Fresh onPick={() => {}} onHorizonChange={onHorizonChange}
    onBaselineHorizonChange={onBaselineHorizonChange} />));
  const windows = container.querySelector('[aria-label="Relativity time horizon"]')!;
  expect(windows.getAttribute('role')).toBe('group');
  expect(windows.querySelectorAll('[role="tab"]')).toHaveLength(0);
  expect(windows.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(1);
  expect(windows.querySelector('button[aria-pressed="true"]')?.textContent).toBe('1Y');
  const day = [...windows.querySelectorAll('button')].find((b) => b.textContent === '1D')!;
  await act(async () => day.click());
  expect(onHorizonChange).toHaveBeenCalledExactlyOnceWith('1d');
  expect(day.getAttribute('aria-pressed')).toBe('true');
  const baseline = container.querySelector('[aria-label="Relativity baseline window"]')!;
  const month = [...baseline.querySelectorAll('button')].find((b) => b.textContent === '1M')!;
  await act(async () => month.click());
  expect(onBaselineHorizonChange).toHaveBeenCalledExactlyOnceWith('1m');
  expect(month.getAttribute('aria-pressed')).toBe('true');
});
