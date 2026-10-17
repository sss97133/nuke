// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
import BrandFamilyMap, { familyMove, headerText, type MapRow } from './BrandFamilyMap';

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

it('keeps the old family move for the title, and prints a header whole or not at all', () => {
  expect(familyMove({ sold: 100, dated: 90, sold_12m: 60, sold_prior_12m: 40 })).toBeCloseTo(0.5);
  expect(familyMove({ sold: 100, dated: 40, sold_12m: 60, sold_prior_12m: 40 })).toBeNull();
  const w = (t: string) => t.length * 0.7;
  expect(headerText('PACKARD', '$124M', 200)).toBe('PACKARD $124M');
  expect(headerText('PACKARD', '$124M', 80)).toBe('PACKARD');
  expect(headerText('DUESENBERG', '$166M', 40)).toBe('');
  void w;
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
  expect([...container.querySelectorAll('.brand-family-map__brand')].map((b) => b.textContent)).toEqual(['PORSCHE $3K', 'FERRARI $2K']);
  const tiles = [...container.querySelectorAll<HTMLDivElement>('.brand-family-map .market-tile')];
  expect(tiles).toHaveLength(6);
  await act(async () => tiles.find((t) => t.title.startsWith('Porsche 911'))!.click());
  expect(onPickFamily).toHaveBeenCalledWith('Porsche', 'f911', '911');
  await act(async () => tiles.find((t) => t.title.startsWith('Porsche more families'))!.click());
  expect(onPickBrand).toHaveBeenCalledWith('Porsche');
  expect(tiles.find((t) => t.title.startsWith('Porsche 911'))!.title).toContain('(sales ▲50%)');
  expect(tiles.find((t) => t.title.startsWith('Porsche more families'))!.className).toContain('market-tile--none');
  // 60 and 40 BaT sales clear the gate; without a baseline the move is the family's own.
  expect(tiles.find((t) => t.title.startsWith('Porsche 911'))!.className).toContain('market-tile--move');
});
