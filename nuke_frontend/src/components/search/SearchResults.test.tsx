// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('react-router-dom', () => ({ useSearchParams: () => [new URLSearchParams({ q: 'porsche' })], useNavigate: () => vi.fn() }));
vi.mock('../../hooks/useViewHistory', () => ({ useViewHistory: () => ({ recordView: vi.fn() }) }));
vi.mock('../feed/ContentCard', () => ({ default: () => <div>Result card</div> }));
vi.mock('../vehicles/VehicleCardDense', () => ({ default: () => <div>Vehicle card</div> }));
import SearchResults from './SearchResults';
const results = [{ id: 'v1', type: 'vehicle' as const, title: 'Porsche', description: '', relevance_score: 1, created_at: '', metadata: {} }];
let root: Root; let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it('renders an unknown total without a fabricated denominator and offers available continuation', async () => {
  await act(async () => root.render(<SearchResults results={results} searchSummary="Loaded 1 result." totalCount={null} hasMore onLoadMore={() => {}} />));
  expect(container.textContent).not.toContain(' of ');
  expect([...container.querySelectorAll('button')].some(button => button.textContent === 'Load more')).toBe(true);
});

it('shows refinement at the pagination ceiling even with existing results and unread candidates', async () => {
  await act(async () => root.render(<SearchResults results={results} searchSummary="Loaded 1 result." totalCount={null} hasMore paginationLimited onLoadMore={() => {}} />));
  expect(container.querySelector('[role="status"]')?.textContent).toBe('Refine your search to see more results.');
  expect([...container.querySelectorAll('button')].some(button => button.textContent?.startsWith('Load more'))).toBe(false);
});

it('shows a failed continuation beside existing results and retains the retry action', async () => {
  await act(async () => root.render(<SearchResults results={results} searchSummary="Loaded 1 result." totalCount={null} hasMore loadMoreError="More results could not be loaded. Try again." onLoadMore={() => {}} />));
  expect(container.querySelector('[role="status"]')?.textContent).toBe('More results could not be loaded. Try again.');
  expect([...container.querySelectorAll('button')].some(button => button.textContent === 'Load more')).toBe(true);
});

it('keeps a working continuation when the server page has no eligible visible results', async () => {
  const loadMore = vi.fn();
  await act(async () => root.render(<SearchResults results={[]} searchSummary="Loaded 0 results." totalCount={null} hasMore onLoadMore={loadMore} />));
  const button = [...container.querySelectorAll('button')].find(button => button.textContent === 'Load more');
  expect(button).toBeDefined(); expect(container.textContent).toContain('No matching results loaded');
  await act(async () => button!.click()); expect(loadMore).toHaveBeenCalledOnce();
});

it('retains continuation when the active type filter hides all loaded results', async () => {
  await act(async () => root.render(<SearchResults results={results} activeFilter="organization" searchSummary="Loaded 1 result." hasMore onLoadMore={() => {}} />));
  expect(container.textContent).not.toContain('Vehicle card');
  expect([...container.querySelectorAll('button')].some(button => button.textContent === 'Load more')).toBe(true);
});

it('shows refinement for an empty view at the ceiling without a retry action or exhaustion claim', async () => {
  await act(async () => root.render(<SearchResults results={[]} searchSummary="Loaded 0 results." hasMore={false} paginationLimited onLoadMore={() => {}} />));
  expect(container.querySelector('[role="status"]')?.textContent).toBe('Refine your search to see more results.');
  expect(container.textContent).toContain('No matching results loaded');
  expect([...container.querySelectorAll('button')].some(button => button.textContent?.startsWith('Load more'))).toBe(false);
});

it('shows empty-page continuation errors and permits a retry, disabling duplicate clicks while pending', async () => {
  const retry = vi.fn();
  const props = { results: [], searchSummary: 'Loaded 0 results.', hasMore: true,
    loadMoreError: 'More results could not be loaded. Try again.', onLoadMore: retry };
  await act(async () => root.render(<SearchResults {...props} />));
  expect(container.querySelector('[role="status"]')?.textContent).toContain('Try again.');
  const button = [...container.querySelectorAll('button')].find(button => button.textContent === 'Load more');
  await act(async () => button!.click()); expect(retry).toHaveBeenCalledOnce();
  await act(async () => root.render(<SearchResults {...props} loadingMore loadMoreError={null} />));
  const pending = [...container.querySelectorAll('button')].find(button => button.textContent === 'Loading...');
  expect(pending?.disabled).toBe(true);
});

it('does not offer continuation for a truly exhausted empty result set', async () => {
  await act(async () => root.render(<SearchResults results={[]} searchSummary="Loaded 0 results." hasMore={false} paginationLimited={false} onLoadMore={() => {}} />));
  expect(container.textContent).toContain('No results for');
  expect(container.textContent).not.toContain('More results may be available');
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect([...container.querySelectorAll('button')].some(button => button.textContent?.startsWith('Load more'))).toBe(false);
});


it('exposes sort and view controls with their current selection', async () => {
  await act(async () => root.render(<SearchResults results={results} searchSummary="Loaded 1 result." />));
  expect(container.querySelector('[aria-label="Sort search results"]')).not.toBeNull();
  const grid = [...container.querySelectorAll('button')].find(button => button.textContent === 'Grid')!;
  const list = [...container.querySelectorAll('button')].find(button => button.textContent === 'List')!;
  expect(grid.getAttribute('aria-pressed')).toBe('true'); expect(list.getAttribute('aria-pressed')).toBe('false');
  await act(async () => list.click());
  expect(grid.getAttribute('aria-pressed')).toBe('false'); expect(list.getAttribute('aria-pressed')).toBe('true');
});

it('keeps one count and no duplicate type/facet strip for a vehicle-only result set', async () => {
  const vehicles = Array.from({ length: 3 }, (_, i) => ({ ...results[0], id: `vehicle-${i}`, metadata: { year: 1987, make: 'Chevrolet', model: 'K5 Blazer', series: 'K5 Blazer (Full-Size)', body_style: 'SUV' } }));
  await act(async () => root.render(<SearchResults results={vehicles} searchSummary="Loaded 3 results." totalCount={3} />));
  expect(container.querySelector('.search-result-count')?.textContent).toBe('3 vehicles');
  expect(container.querySelector('.search-results-summary')).toBeNull();
  expect(container.querySelector('[data-testid="header-search-facets"]')).toBeNull();
  expect(container.querySelector('[role="group"][aria-label="Result view"]')).not.toBeNull();
});
