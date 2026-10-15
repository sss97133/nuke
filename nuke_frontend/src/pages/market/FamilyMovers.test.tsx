// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
import FamilyMovers, { move } from './FamilyMovers';

const bat = { bat_sold_12m: 39001, bat_sold_prior_12m: 34827, bat_usd_12m: 1270, bat_usd_prior_12m: 1000, eligible: 160, families: 1137 };
const rows = [
  { direction: 'up', brand: 'Ferrari', family_key: 'f360', family: '360', sold_12m: 92, sold_prior_12m: 46, usd_12m: 16_000_000, usd_prior_12m: 5_633_803, ...bat },
  { direction: 'down', brand: 'Acura', family_key: 'fint', family: 'Integra', sold_12m: 36, sold_prior_12m: 49, usd_12m: 800_000, usd_prior_12m: 1_428_571, ...bat },
];
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

it('lists the families that moved most on BaT, beside BaT overall, and a pick drills the map', async () => {
  fixture.rpc.mockResolvedValue({ data: rows, error: null });
  const onPick = vi.fn();
  await act(async () => root.render(<FamilyMovers onPick={onPick} />));
  expect(fixture.rpc).toHaveBeenCalledWith('treemap_family_movers', { p_limit: 8 });
  const items = [...container.querySelectorAll('button.map-movers__item')];
  expect(items.map((b) => b.textContent)).toEqual(['Ferrari 360▲184%46→92 sold', 'Acura Integra▼44%49→36 sold']);
  expect(items[0].className).toContain('--up'); expect(items[1].className).toContain('--down');
  expect(container.querySelector('.map-movers__base')?.textContent)
    .toContain('BaT overall: sales ▲12%, $ ▲27% · 160 of 1,137 families with 30+ BaT sales each year');
  await act(async () => (items[0] as HTMLButtonElement).click());
  expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ brand: 'Ferrari', family_key: 'f360', family: '360' }));
});

it('stays away when the reader fails', async () => {
  const { default: Fresh } = await import('./FamilyMovers');
  fixture.rpc.mockResolvedValue({ data: null, error: { message: 'function not found' } });
  await act(async () => root.render(<Fresh onPick={() => {}} />));
  expect(container.querySelector('.map-movers')).toBeNull();
});

it('draws each mover\'s two years as 24 bars when the monthly read answers, and none when it does not', async () => {
  const { default: Fresh } = await import('./FamilyMovers');
  const bins = [2, 3, 4, 4, 3, 5, 4, 4, 3, 4, 5, 5, 6, 7, 6, 8, 7, 9, 8, 9, 7, 8, 9, 8];
  fixture.rpc.mockImplementation((fn: string) => Promise.resolve(fn === 'treemap_family_movers'
    ? { data: rows, error: null }
    : { data: { anchor: '2026-10-15', window_days: 730, families: [{ brand: 'Ferrari', family_key: 'f360', bins }] }, error: null }));
  await act(async () => root.render(<Fresh onPick={() => {}} />));
  await act(async () => { await Promise.resolve(); });
  expect(fixture.rpc).toHaveBeenCalledWith('treemap_family_monthly',
    { p_families: [{ brand: 'Ferrari', family_key: 'f360' }, { brand: 'Acura', family_key: 'fint' }] });
  const items = [...container.querySelectorAll('button.map-movers__item')];
  expect(items[0].querySelectorAll('svg.map-movers__spark rect')).toHaveLength(24);
  expect(items[0].querySelectorAll('rect.map-movers__bar--recent')).toHaveLength(12);
  expect(Number(items[0].querySelectorAll('rect')[17].getAttribute('height'))).toBe(13);
  expect(items[1].querySelector('svg')).toBeNull();
  expect(items[0].textContent).toBe('Ferrari 360▲184%46→92 sold');
});
