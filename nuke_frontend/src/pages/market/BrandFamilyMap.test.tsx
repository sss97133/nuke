// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
import BrandFamilyMap, { familyMove, moveTint, type MapRow } from './BrandFamilyMap';

const row = (brand: string, rank: number, brandUsd: number, key: string, family: string | null, usd: number, extra: Partial<MapRow> = {}): MapRow => ({
  brand, brand_usd: brandUsd, brand_rank: rank, family_key: key, family, usd, sold: 100, sold_any: 100, offered: 120,
  dated: 90, sold_12m: 60, sold_prior_12m: 40, usd_12m: 1, usd_prior_12m: 1, families: 3, ...extra,
});

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); fixture.rpc.mockReset(); });

it('colors a family by its BaT move only when BaT holds half its sales and sold 10 a year earlier', () => {
  expect(familyMove({ sold: 100, dated: 90, sold_12m: 60, sold_prior_12m: 40 })).toBeCloseTo(0.5);
  expect(familyMove({ sold: 100, dated: 40, sold_12m: 60, sold_prior_12m: 40 })).toBeNull();
  expect(familyMove({ sold: 100, dated: 90, sold_12m: 6, sold_prior_12m: 4 })).toBeNull();
  expect(moveTint(null)).toBe('var(--heat-0)');
  expect(moveTint(0.5)).toContain('--success');
  expect(moveTint(-0.3)).toContain('--error');
});

it('frames each brand with its families inside; a family drills to it, a brand or "more" to the brand', async () => {
  fixture.rpc.mockResolvedValue({ data: [
    row('Porsche', 1, 3000, 'f911', '911', 2000), row('Porsche', 1, 3000, 'fbox', 'Boxster', 600), row('Porsche', 1, 3000, 'more', null, 300),
    row('Porsche', 1, 3000, 'other', null, 100),
    row('Ferrari', 2, 2000, 'f360', '360', 1500), row('Ferrari', 2, 2000, 'other', null, 500),
  ], error: null });
  const onPickBrand = vi.fn(), onPickFamily = vi.fn();
  await act(async () => root.render(<BrandFamilyMap width={1000} height={600} onPickBrand={onPickBrand} onPickFamily={onPickFamily} />));
  expect(fixture.rpc).toHaveBeenCalledWith('treemap_brand_family_map', { p_brands: 60, p_families: 12 });
  expect([...container.querySelectorAll('.brand-family-map__brand')].map((b) => b.textContent)).toEqual(['Porsche$3K', 'Ferrari$2K']);
  const tiles = [...container.querySelectorAll<HTMLButtonElement>('.brand-family-map__tile')];
  expect(tiles).toHaveLength(6);
  await act(async () => tiles.find((t) => t.title.startsWith('Porsche 911'))!.click());
  expect(onPickFamily).toHaveBeenCalledWith('Porsche', 'f911', '911');
  await act(async () => tiles.find((t) => t.title.startsWith('Porsche more families'))!.click());
  expect(onPickBrand).toHaveBeenCalledWith('Porsche');
  expect(tiles.find((t) => t.title.startsWith('Porsche 911'))!.title).toContain('BaT 12 mo: sales ▲50%');
});
