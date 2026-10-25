// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BrowserRouter, useSearchParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FILTERS, REMEMBER_FILTERS_KEY, STORAGE_KEY } from '../../lib/filterPersistence';
import { useFeedSearchParams } from './useFeedSearchParams';

function Controls({ defaultColumns = 3 }: { defaultColumns?: number }) {
  const feed = useFeedSearchParams(defaultColumns);
  const [params] = useSearchParams();
  return <>
    <output aria-label="Active view">{params.get('tab') ?? 'market'}</output>
    <output aria-label="Columns">{feed.cardsPerRow}</output>
    <output aria-label="Sort">{feed.sortBy}</output>
    <button onClick={() => feed.setSortBy('popular')}>Sort</button>
    <button onClick={() => feed.setSortBy('finds')}>Finds</button>
    <button onClick={() => feed.setCardsPerRow(3)}>Three columns</button>
    <button onClick={() => feed.updateFilters({ makes: ['Porsche'] })}>Filter</button>
    <button onClick={() => feed.setViewMode('technical')}>Table</button>
    <button onClick={() => feed.setCardsPerRow(2)}>Density</button>
    <button onClick={() => feed.setSearchText('Porsche')}>Search</button>
    <button onClick={feed.resetAll}>Reset</button>
  </>;
}

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const stored = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
  window.history.replaceState({}, '', '/?tab=feed');
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
});
async function render(defaultColumns = 3) {
  await act(async () => root.render(<BrowserRouter><Controls defaultColumns={defaultColumns} /></BrowserRouter>));
}
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find(el => el.textContent === label)!;
  await act(async () => button.click());
}
const params = () => new URLSearchParams(window.location.search);

describe('feed controls preserve their owning view', () => {
  it.each([
    ['Sort', 'sort', 'popular'], ['Filter', 'make', 'Porsche'],
    ['Table', 'view', 'technical'], ['Density', 'cols', '2'],
  ])('%s changes the feed without returning to Market', async (action, key, value) => {
    await render(); await click(action);
    expect(params().get('tab')).toBe('feed');
    expect(params().get(key)).toBe(value);
    expect(container.querySelector('output')?.textContent).toBe('feed');
  });
  it('keeps Feed after a debounced search and after resetting all filters', async () => {
    vi.useFakeTimers(); await render(); await click('Search');
    await act(async () => { vi.advanceTimersByTime(150); });
    expect(params().get('q')).toBe('Porsche');
    expect(params().get('tab')).toBe('feed');
    await click('Reset');
    expect(window.location.search).toBe('?tab=feed');
  });
  it('keeps Feed while restoring remembered filters on arrival', async () => {
    localStorage.setItem(REMEMBER_FILTERS_KEY, 'true');
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULT_FILTERS, makes: ['BMW'] }));
    await render();
    expect(params().get('make')).toBe('BMW');
    expect(params().get('tab')).toBe('feed');
  });
  it('does not invent a home tab for standalone market pages', async () => {
    window.history.replaceState({}, '', '/market');
    await render(); await click('Sort');
    expect(window.location.pathname).toBe('/market');
    expect(params().has('tab')).toBe(false);
    expect(params().get('sort')).toBe('popular');
  });
});

describe('responsive feed display defaults', () => {
  const columns = () => container.querySelector('[aria-label="Columns"]')?.textContent;
  it('defaults to two columns on phones and keeps an explicit three-column choice on resize', async () => {
    await render(2); expect(columns()).toBe('2');
    await click('Three columns');
    expect(params().get('cols')).toBe('3'); expect(columns()).toBe('3');
    await render(3); expect(columns()).toBe('3');
    await render(2); expect(columns()).toBe('3');
    await click('Reset'); expect(columns()).toBe('2');
  });
  it('respects explicit density on arrival and after changing text filters', async () => {
    window.history.replaceState({}, '', '/?tab=feed&cols=1');
    await render(2); expect(columns()).toBe('1');
    await click('Filter'); expect(params().get('cols')).toBe('1');
    await render(3); expect(columns()).toBe('1');
  });
  it('uses the new viewport default only while no density is chosen', async () => {
    await render(3); expect(columns()).toBe('3');
    await render(2); expect(columns()).toBe('2');
    await render(3); expect(columns()).toBe('3');
  });
  it('round-trips Finds instead of silently returning to Newest', async () => {
    await render(); await click('Finds');
    expect(params().get('sort')).toBe('finds');
    expect(container.querySelector('[aria-label="Sort"]')?.textContent).toBe('finds');
  });
});
