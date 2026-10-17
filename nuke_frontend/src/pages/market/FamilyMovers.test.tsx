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
