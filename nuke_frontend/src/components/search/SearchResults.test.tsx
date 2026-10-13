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
