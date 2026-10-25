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
    <output aria-label="Filters">{JSON.stringify(feed.filters)}</output>
    <button onClick={() => feed.setSortBy('popular')}>Sort</button>
    <button onClick={() => feed.setSortBy('finds')}>Finds</button>
    <button onClick={() => feed.setCardsPerRow(3)}>Three columns</button>
    <button onClick={() => feed.updateFilters({ makes: ['Porsche'] })}>Filter</button>
    <button onClick={() => feed.setViewMode('technical')}>Table</button>
    <button onClick={() => feed.setCardsPerRow(2)}>Density</button>
    <button onClick={() => feed.setSearchText('Porsche')}>Search</button>
    <button onClick={() => {
      feed.setFilters({ ...DEFAULT_FILTERS, makes: ['Porsche'] }, 'popular');
    }}>Interest preset</button>
    <button onClick={() => feed.updateFilters({ includedSources: ['bat'], hiddenSources: ['ksl'] })}>Source filter</button>
    <button onClick={() => {
      feed.setFilters({ ...DEFAULT_FILTERS, addedTodayOnly: true, includedSources: ['bat'] }, 'newest');
    }}>Source preset</button>
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

describe('feed presets retain their selected population', () => {
  const filters = () => JSON.parse(container.querySelector('[aria-label="Filters"]')!.textContent!);
  it('keeps the selected make when an interest preset also changes sort', async () => {
    await render(); await click('Interest preset');
    expect(filters().makes).toEqual(['Porsche']);
    expect(params().get('sort')).toBe('popular');
  });
  it('round-trips included source filters alongside source exclusions', async () => {
    await render(); await click('Source filter');
    expect(filters().includedSources).toEqual(['bat']);
    expect(filters().hiddenSources).toEqual(['ksl']);
    expect(params().get('sources')).toBe('bat,-ksl');
    await click('Sort');
    expect(filters().includedSources).toEqual(['bat']);
    expect(filters().hideKsl).toBe(true);
    await click('Reset');
    expect(params().has('sources')).toBe(false);
    expect(filters().includedSources).toEqual([]);
  });
  it('keeps a source and today-only window when a source preset changes sort', async () => {
    window.history.replaceState({}, '', '/?tab=feed&sort=popular&make=Porsche');
    await render(); await click('Source preset');
    expect(filters().addedTodayOnly).toBe(true);
    expect(filters().includedSources).toEqual(['bat']);
    expect(filters().makes).toEqual([]);
    expect(container.querySelector('[aria-label="Sort"]')?.textContent).toBe('newest');
  });
});


describe('pending search respects newer feed actions', () => {
  it.each([
    ['Sort', 'sort', 'popular'],
    ['Interest preset', 'make', 'Porsche'],
    ['Source preset', 'sources', 'bat'],
    ['Table', 'view', 'technical'],
  ])('merges search text into the latest %s selection', async (action, key, value) => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/?tab=feed&make=BMW&sort=year');
    await render(); await click('Search'); await click(action);
    await act(async () => { vi.advanceTimersByTime(150); });
    expect(params().get('q')).toBe('Porsche');
    expect(params().get(key)).toBe(value);
    expect(params().get('tab')).toBe('feed');
    if (action === 'Interest preset') expect(params().get('sort')).toBe('popular');
    if (action === 'Source preset') {
      expect(params().has('today')).toBe(true);
      expect(params().has('make')).toBe(false);
      expect(params().has('sort')).toBe(false);
    }
  });
  it('cancels pending search when Reset clears all selections', async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/?tab=feed&make=BMW&sort=year');
    await render(); await click('Search'); await click('Reset');
    await act(async () => { vi.advanceTimersByTime(150); });
    expect(window.location.search).toBe('?tab=feed');
  });
  it('does not mutate the URL after the feed controls unmount', async () => {
    vi.useFakeTimers(); await render(); await click('Search');
    await act(async () => root.render(null));
    await act(async () => { vi.advanceTimersByTime(150); });
    expect(window.location.search).toBe('?tab=feed');
  });
});
