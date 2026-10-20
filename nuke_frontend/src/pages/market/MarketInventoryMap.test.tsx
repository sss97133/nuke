// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import MarketInventoryMap from './MarketInventoryMap';
import type { InventoryMapGroup, InventoryMapLens, MapDimension } from './inventoryMap';
import { listingKey, type LiveAuction } from './useMarketPulse';

const lot = (id: string, make: string, year: number): LiveAuction => ({
  id, make, year, model: 'Recorded model', currentBid: 100, endsAt: 0, updatedAt: 0, listedAt: 0,
  listingUrl: `https://bringatrailer.com/listing/${id}/`, imageUrl: null, noReserve: false, title: null, band: null, house: 'bringatrailer', currency: 'USD',
});
const lots = [lot('p1', 'PORSCHE', 2011), lot('p2', 'PORSCHE', 2004), lot('p3', 'PORSCHE', 1992), lot('f1', 'FORD', 1968)];
const initialLens: InventoryMapLens = { group: 'make', inside: 'lot', focus: null, child: null };
let root: Root, container: HTMLDivElement, outside: HTMLButtonElement;
let refresh: (rows: LiveAuction[]) => void;
let finishSelection: () => void;
const selected = vi.fn();

function Parent({ mode = 'drill' }: { mode?: 'drill' | 'keep' | 'move' | 'inspect' | 'defer' }) {
  const [rows, setRows] = useState(lots);
  const [lens, setLens] = useState(initialLens);
  refresh = setRows;
  const select = (dimension: MapDimension | 'lot', group: InventoryMapGroup, child?: boolean) => {
    selected(dimension, group.key, child);
    if (mode === 'keep') return;
    if (mode === 'move' || mode === 'inspect') outside.focus();
    if (dimension === 'lot') { setLens({ ...initialLens, inside: 'none' }); return; }
    const commit = () => { setRows(group.lots); setLens({ group: 'era', inside: 'lot', focus: null, child: null }); };
    if (mode === 'defer') finishSelection = commit; else commit();
  };
  return <MarketInventoryMap auctions={rows} lens={lens} taxonomy={new Map()} taxonomyLoading={false} taxonomyError={false}
    onRetryTaxonomy={vi.fn()} risenIds={new Set()} onLensChange={(change) => setLens({ ...lens, ...change })}
    onSelect={select} selectedModel={null} />;
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: (entries: Array<{ contentRect: { width: number } }>) => void) {}
    observe() { this.callback([{ contentRect: { width: 393 } }]); }
    disconnect() {}
  });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  outside = document.createElement('button'); outside.textContent = 'Inspection control'; document.body.append(outside);
  selected.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); outside.remove(); vi.unstubAllGlobals(); });
const brand = () => container.querySelector<HTMLButtonElement>('.inventory-map-group[aria-label^="PORSCHE:"]')!;
const canvas = () => container.querySelector<HTMLDivElement>('.inventory-map-canvas')!;

it('orients focus to the named map after an explicitly selected brand button is replaced', async () => {
  await act(async () => root.render(<Parent />));
  const opener = brand();
  await act(async () => opener.focus());
  await act(async () => opener.click());
  expect(opener.isConnected).toBe(false);
  expect(selected).toHaveBeenCalledWith('make', 'PORSCHE', false);
  expect(canvas().querySelector('.inventory-map-group')?.getAttribute('aria-label')).toMatch(/^1990–1999:/);
  expect(document.activeElement).toBe(canvas());
  expect(canvas().getAttribute('role')).toBe('group');
  expect(canvas().getAttribute('aria-label')).toBe('Captured inventory by Era (decade)');
  expect(canvas().tabIndex).toBe(-1);
  expect(canvas().querySelector<HTMLButtonElement>('.inventory-map-group')?.tabIndex).toBe(0);
});

it('keeps a connected opener focused without allowing a later background refresh to claim focus', async () => {
  await act(async () => root.render(<Parent mode="keep" />));
  const opener = brand();
  await act(async () => opener.focus());
  await act(async () => opener.click());
  expect(document.activeElement).toBe(opener);
  await act(async () => refresh(lots.filter((row) => row.make === 'FORD')));
  expect(opener.isConnected).toBe(false);
  expect(document.activeElement).toBe(document.body);
});

it('retains explicit drill intent through a local commit before the parent navigation commit', async () => {
  await act(async () => root.render(<Parent mode="defer" />));
  const opener = brand();
  await act(async () => opener.focus());
  await act(async () => opener.click());
  expect(opener.isConnected).toBe(true);
  expect(document.activeElement).toBe(opener);
  await act(async () => finishSelection());
  expect(opener.isConnected).toBe(false);
  expect(document.activeElement).toBe(canvas());
  expect(canvas().getAttribute('aria-label')).toBe('Captured inventory by Era (decade)');
});

it('preserves user focus moved before a deferred navigation commit', async () => {
  await act(async () => root.render(<Parent mode="defer" />));
  const opener = brand();
  await act(async () => opener.focus());
  await act(async () => opener.click());
  outside.focus();
  await act(async () => finishSelection());
  expect(opener.isConnected).toBe(false);
  expect(document.activeElement).toBe(outside);
});

it('does not hand off focus when a background refresh removes a focused group', async () => {
  await act(async () => root.render(<Parent />));
  const opener = brand();
  await act(async () => opener.focus());
  await act(async () => refresh(lots.filter((row) => row.make === 'FORD')));
  expect(opener.isConnected).toBe(false);
  expect(document.activeElement).toBe(document.body);
  expect(selected).not.toHaveBeenCalled();
});

it('preserves a focus target chosen by the parent while the map changes', async () => {
  await act(async () => root.render(<Parent mode="move" />));
  const opener = brand();
  await act(async () => opener.focus());
  await act(async () => opener.click());
  expect(opener.isConnected).toBe(false);
  expect(document.activeElement).toBe(outside);
});

it('leaves individual-lot inspection focus with its existing owner', async () => {
  await act(async () => root.render(<Parent mode="inspect" />));
  const opener = container.querySelector<HTMLButtonElement>('[data-map-lot="p1"]')!;
  expect(opener).not.toBeNull();
  await act(async () => opener.focus());
  await act(async () => opener.click());
  expect(selected).toHaveBeenCalledWith('lot', listingKey(lots[0]), true);
  expect(opener.isConnected).toBe(false);
  expect(document.activeElement).toBe(outside);
});

it('does not claim focus when a selected individual-lot button is removed', async () => {
  await act(async () => root.render(<Parent />));
  const opener = container.querySelector<HTMLButtonElement>('[data-map-lot="p1"]')!;
  await act(async () => opener.focus());
  await act(async () => opener.click());
  expect(selected).toHaveBeenCalledWith('lot', listingKey(lots[0]), true);
  expect(opener.isConnected).toBe(false);
  expect(document.activeElement).toBe(document.body);
});

it('does not move focus for activation of an unfocused group button', async () => {
  await act(async () => root.render(<Parent />));
  await act(async () => outside.focus());
  const opener = brand();
  await act(async () => opener.click());
  expect(opener.isConnected).toBe(false);
  expect(document.activeElement).toBe(outside);
});
