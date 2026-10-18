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
  fixture.rpc.mockResolvedValue({ data: [
    row('Porsche', 1, 3000, 'f911', '911', 2000), row('Porsche', 1, 3000, 'fbox', 'Boxster', 600), row('Porsche', 1, 3000, 'more', null, 300),
    row('Porsche', 1, 3000, 'other', null, 100),
    row('Ferrari', 2, 2000, 'f360', '360', 1500), row('Ferrari', 2, 2000, 'other', null, 500),
  ], error: null });
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
  const onPickBrand = vi.fn(), onPickFamily = vi.fn();
  await act(async () => root.render(<BrandFamilyMap width={1000} height={600} onPickBrand={onPickBrand} onPickFamily={onPickFamily} />));
  expect(fixture.rpc).toHaveBeenCalledWith('treemap_brand_family_map', { p_brands: 60, p_families: 12 });
  expect([...container.querySelectorAll('.brand-family-map__brand')].map((b) => b.getAttribute('aria-label'))).toEqual(['Porsche: $3K', 'Ferrari: $2K']);
  const tiles = [...container.querySelectorAll<HTMLButtonElement>('.brand-family-map .market-tile')];
  expect(tiles).toHaveLength(6);
  await act(async () => tiles.find((t) => t.title.startsWith('Porsche 911'))!.click());
  expect(onPickFamily).toHaveBeenCalledWith('Porsche', 'f911', '911', true);
  await act(async () => tiles.find((t) => t.title.startsWith('Porsche more families'))!.click());
  expect(onPickBrand).toHaveBeenCalledWith('Porsche', true);
  expect(tiles.find((t) => t.title.startsWith('Porsche 911'))!.title).toContain('(sales ▲50%)');
  expect(tiles.find((t) => t.title.startsWith('Porsche more families'))!.className).toContain('market-tile--none');
  // 60 and 40 BaT sales clear the gate; without a baseline the move is the family's own.
  expect(tiles.find((t) => t.title.startsWith('Porsche 911'))!.className).toContain('market-tile--move');
  const header = container.querySelector<HTMLButtonElement>('.brand-family-map__brand')!;
  expect(header.getAttribute('aria-label')).toBe('Porsche: $3K');
  await act(async () => header.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true })));
  expect(onPickBrand).toHaveBeenLastCalledWith('Porsche', false);
});

it('exposes the qualified family inspection on focus and hover without drilling', async () => {
  const onPickBrand = vi.fn(), onPickFamily = vi.fn();
  await act(async () => root.render(<BrandFamilyMap width={1000} height={600} onPickBrand={onPickBrand} onPickFamily={onPickFamily} />));
  const tile = container.querySelector<HTMLButtonElement>('[title^="Porsche 911"]')!;
  await act(async () => tile.focus());
  const card = document.querySelector('[role="tooltip"]');
  expect(card).not.toBeNull();
  expect(card?.querySelector('.market-card__head')?.textContent).toBe('Porsche 911');
  expect(tile.getAttribute('aria-label')).toBe('Porsche 911');
  expect(tile.getAttribute('aria-describedby')).toBe(card?.id);
  expect(card?.textContent).toContain('100 confirmed sales');
  expect(card?.textContent).toContain('40 → 60');
  expect(onPickFamily).not.toHaveBeenCalled();
  await act(async () => tile.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  await act(async () => tile.dispatchEvent(new MouseEvent('mousemove', { clientX: 125, clientY: 150, bubbles: true })));
  expect(document.querySelector('.market-card__head')?.textContent).toBe('Porsche 911');
  await act(async () => tile.blur());
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
});

it('offers touch inspection before drilling and keeps grouped rows on their existing brand callback', async () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.open = false; } });
  try {
    const onPickBrand = vi.fn(), onPickFamily = vi.fn();
    await act(async () => root.render(<BrandFamilyMap width={390} height={600} onPickBrand={onPickBrand} onPickFamily={onPickFamily} />));
    const tile = container.querySelector<HTMLButtonElement>('[title^="Porsche 911"]')!;
    await act(async () => tile.click());
    expect(onPickFamily).not.toHaveBeenCalled();
    expect(container.querySelector('dialog[open]')?.getAttribute('aria-label')).toBe('Porsche 911');
    await act(async () => container.querySelector<HTMLButtonElement>('.market-sheet__close')!.click());
    expect(container.querySelector('dialog')).toBeNull();
    await act(async () => tile.click());
    await act(async () => container.querySelector<HTMLButtonElement>('.market-sheet__open')!.click());
    expect(onPickFamily).toHaveBeenCalledWith('Porsche', 'f911', '911', true);
    await act(async () => container.querySelector<HTMLButtonElement>('[title^="Ferrari other models"]')!.click());
    expect(container.querySelector('dialog')?.getAttribute('aria-label')).toBe('Ferrari other models');
    expect(container.querySelector('dialog')?.textContent).toContain('no measured sales');
    expect(onPickBrand).not.toHaveBeenCalled();
    await act(async () => container.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })));
    expect(container.querySelector('dialog')).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('[title^="Ferrari other models"]')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('.market-sheet__open')!.click());
    expect(onPickBrand).toHaveBeenCalledWith('Ferrari', true);
  } finally {
    delete (HTMLDialogElement.prototype as any).showModal;
    delete (HTMLDialogElement.prototype as any).close;
    vi.unstubAllGlobals();
  }
});

it('keeps the selected window and count gate on family inspection', async () => {
  await act(async () => root.render(<BrandFamilyMap width={1000} height={600} onPickBrand={vi.fn()} onPickFamily={vi.fn()}
    basis="bat12" gateMin={20} windowLabel="last 3 months against the 3 before" familyMoves={{
      'Porsche|f911': { sold_12m: 8, sold_prior_12m: 40, usd_12m: 2000, usd_prior_12m: 4000 },
    }} />));
  const tile = container.querySelector<HTMLButtonElement>('[title^="Porsche 911"]')!;
  await act(async () => tile.focus());
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('last 3 months against the 3 before');
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('40 → 8 measured sales; the color needs 20 in each window');
  expect(tile.className).toContain('market-tile--few');
});

it('uses shared brand artwork without changing header geometry or dropping failed-image names', async () => {
  await act(async () => root.render(<BrandFamilyMap width={1000} height={600} onPickBrand={vi.fn()} onPickFamily={vi.fn()} />));
  const header = container.querySelector<HTMLButtonElement>('.brand-family-map__brand')!;
  expect(header.querySelector('.make-identity')?.getAttribute('data-inverse')).toBe('true');
  expect(header.querySelector('img')?.getAttribute('src')).toBe('/stacks/makes/porsche-wordmark.svg');
  const dimensions = [header.style.left, header.style.top, header.style.width, header.style.height];
  expect(header.style.height).toBe('16px');
  expect(header.querySelector('.brand-family-map__dollars')?.textContent).toBe('$3K');
  await act(async () => header.querySelector('img')!.dispatchEvent(new Event('error')));
  expect(header.querySelector('.make-identity strong')?.textContent).toBe('Porsche');
  expect(header.getAttribute('aria-label')).toBe('Porsche: $3K');
  expect([header.style.left, header.style.top, header.style.width, header.style.height]).toEqual(dimensions);
  expect(header.querySelector('.brand-family-map__dollars')?.textContent).toBe('$3K');
});

it('keeps unknown brand names and fitted dollars whole, with complete identity when a header cannot fit', async () => {
  vi.resetModules();
  const { default: UnknownBrandMap } = await import('./BrandFamilyMap');
  fixture.rpc.mockResolvedValue({ data: [row('Nimbus Co', 1, 124e6, 'n1', 'One', 124e6), row('Zed', 2, 124e6, 'z1', 'One', 124e6)], error: null });
  await act(async () => root.render(<UnknownBrandMap width={1000} height={600} onPickBrand={vi.fn()} onPickFamily={vi.fn()} />));
  const header = () => container.querySelector<HTMLButtonElement>('.brand-family-map__brand')!;
  expect(header().querySelector('.make-identity strong')?.textContent).toBe('Nimbus Co');
  expect(header().querySelector('img')).toBeNull();
  expect(header().querySelector('.brand-family-map__dollars')?.textContent).toBe('$124M');
  await act(async () => root.render(<UnknownBrandMap width={100} height={600} onPickBrand={vi.fn()} onPickFamily={vi.fn()} />));
  expect(header().querySelector('.make-identity strong')?.textContent).toBe('Nimbus Co');
  expect(header().querySelector('.brand-family-map__dollars')).toBeNull();
  await act(async () => root.render(<UnknownBrandMap width={130} height={100} onPickBrand={vi.fn()} onPickFamily={vi.fn()} />));
  expect(header().querySelector('.brand-family-map__head')).toBeNull();
  expect(header().getAttribute('aria-label')).toBe('Nimbus Co: $124M');
  expect(header().style.height).toBe('16px');
});
