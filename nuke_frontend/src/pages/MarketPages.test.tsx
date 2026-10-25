// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ feed: vi.fn(), segments: vi.fn(), segmentRead: vi.fn(), retryFeed: vi.fn(), nextPage: vi.fn(), retrySegments: vi.fn() }));
vi.mock('../feed/hooks/useFeedQuery', () => ({ useFeedQuery: fixture.feed }));
vi.mock('../hooks/useMarketSegments', () => ({ useMarketSegments: fixture.segments }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../hooks/usePageTitle', () => ({ usePageTitle: () => {} }));
vi.mock('../components/PrefetchLink', () => ({ PrefetchLink: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => <a href={to} {...props}>{children}</a> }));
vi.mock('../lib/supabase', () => ({ supabase: { from: (table: string) => {
  if (table !== 'market_segments_index') throw new Error(`Unexpected table ${table}`);
  const query = { select: () => query, eq: () => query, maybeSingle: fixture.segmentRead }; return query;
} } }));
vi.mock('../feed/components/AuctionClockProvider', () => ({ AuctionClockProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../feed/components/FeedToolbar', () => ({ FeedToolbar: ({ sort, onSortChange }: { sort: string; onSortChange: (sort: string) => void }) => <div><output>Selected sort: {sort}</output><button onClick={() => onSortChange('popular')}>Rank</button><button onClick={() => onSortChange('deal_score')}>Deals</button></div> }));
vi.mock('../feed/components/FeedFilterSidebar', () => ({ FeedFilterSidebar: ({ onResetAll }: {onResetAll: () => void}) => <button onClick={onResetAll}>Reset sidebar filters</button> }));
vi.mock('../feed/components/FeedLayout', () => ({ FeedLayout: ({ vehicles, hasNextPage }: { vehicles: { id: string }[]; hasNextPage: boolean }) => <div data-testid="feed-results" data-next-page={String(hasNextPage)}>{vehicles.map(item => <span key={item.id}>{item.id}</span>)}</div> }));
vi.mock('../feed/components/FeedSkeleton', () => ({ FeedSkeleton: () => <p>Loading vehicles</p> }));
vi.mock('../feed/components/FeedEmptyState', () => ({ FeedEmptyState: () => <p>Successful empty vehicle result</p> }));
vi.mock('../feed/components/VehicleCard', () => ({ VehicleCard: () => null }));
vi.mock('../feed/components/heartbeat/BrandHeartbeat', () => ({ BrandHeartbeat: () => null }));
import MarketDashboard from './MarketDashboard';
import MarketSegments from './MarketSegments';
import MarketSegmentDetail from './MarketSegmentDetail';

const segment = { segment_id: 'synthetic-segment', slug: 'synthetic', name: 'Synthetic definition', description: 'Retained definition', manager_type: 'human', year_min: 1990, year_max: 2000, makes: ['Synthetic make'], model_keywords: ['Truck'], vehicle_count: 0, market_cap_usd: 999999, change_7d_pct: null, change_30d_pct: null };
const feedState = (overrides: Record<string, unknown> = {}) => ({ data: { pages: [{ items: [], stats: null }] }, isLoading: false, isError: false, isFetching: false, isFetchNextPageError: false, hasNextPage: false, isFetchingNextPage: false, refetch: fixture.retryFeed, fetchNextPage: fixture.nextPage, ...overrides });
let host: HTMLDivElement, root: Root;
const text = () => host.textContent || '';
const button = (label: string) => [...host.querySelectorAll('button')].find(node => node.textContent === label)!;
const click = async (label: string) => { await act(async () => button(label).click()); };
const render = async (page: 'dashboard' | 'segments' | 'detail', sort = 'popular') => {
  const path = page === 'detail' ? '/market/segments/synthetic' : page === 'segments' ? '/market/segments' : '/market';
  await act(async () => root.render(<MemoryRouter initialEntries={[`${path}?sort=${sort}`]}><Routes>
    <Route path="/market" element={<MarketDashboard />} />
    <Route path="/market/segments" element={<MarketSegments />} />
    <Route path="/market/segments/:slug" element={<MarketSegmentDetail />} />
  </Routes></MemoryRouter>));
};
beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  fixture.retryFeed.mockReset(); fixture.nextPage.mockReset(); fixture.retrySegments.mockReset();
  fixture.feed.mockReset().mockReturnValue(feedState());
  fixture.segments.mockReset().mockReturnValue({ data: [segment], isLoading: false, isFetching: false, error: null, refetch: fixture.retrySegments });
  fixture.segmentRead.mockReset().mockResolvedValue({ data: segment, error: null });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each(['dashboard', 'detail'] as const)('preserves the explicit Rank sort on the %s instead of silently using Deals', async page => {
  await render(page, 'deal_score'); expect(fixture.feed.mock.lastCall?.[0].sortBy).toBe('deal_score');
  await click('Rank'); expect(fixture.feed.mock.lastCall?.[0].sortBy).toBe('popular');
  expect(text()).toContain('Selected sort: popular');
  await click('Deals'); expect(fixture.feed.mock.lastCall?.[0].sortBy).toBe('deal_score');
});

it('keeps definitions visible despite placeholder zero coverage and never labels fund AUM as vehicle value', async () => {
  await render('dashboard'); expect(text()).toContain('Synthetic definition');
  expect(host.querySelector('a[href="/market/segments/synthetic"]')).not.toBeNull();
  expect(text()).not.toContain('0 vehicles'); expect(text()).not.toContain('$');
});

it.each(['dashboard', 'detail'] as const)('shows retryable vehicle failure rather than an empty success on %s', async page => {
  fixture.feed.mockReturnValue(feedState({ isError: true })); await render(page);
  expect(text()).toContain('Vehicle results could not be refreshed');
  expect(text()).not.toContain('Successful empty vehicle result');
  expect(text()).toContain('Result count unavailable');
  await click('Retry vehicles'); expect(fixture.retryFeed).toHaveBeenCalledTimes(1);
});

it.each(['dashboard', 'detail'] as const)('retains %s results on page failure, stops automatic paging, and retries the failed page', async page => {
  fixture.feed.mockReturnValue(feedState({ isError: true, isFetchNextPageError: true, hasNextPage: true, data: { pages: [{ items: [{ id: 'retained-vehicle' }], stats: null }] } }));
  await render(page); expect(text()).toContain('retained-vehicle'); expect(text()).toContain('last successful results');
  expect(host.querySelector('[data-testid="feed-results"]')?.getAttribute('data-next-page')).toBe('false');
  await click('Retry vehicles'); expect(fixture.nextPage).toHaveBeenCalledTimes(1); expect(fixture.retryFeed).not.toHaveBeenCalled();
});

it('replaces the broken portfolio destination and presents measured scope honestly on segment cards', async () => {
  await render('segments'); expect(host.querySelector('a[href="/market/portfolio"]')).toBeNull();
  expect(host.querySelector('a[href="/?tab=garage"]')).not.toBeNull();
  expect(text()).toContain('1990–2000'); expect(text()).toContain('Model keywordsTruck');
  expect(text()).not.toContain('in play'); expect(text()).not.toContain('$');
});

it('retains segment definitions after query failure and exposes retry', async () => {
  fixture.segments.mockReturnValue({ data: [segment], isLoading: false, isFetching: false, error: new Error('Synthetic index refusal'), refetch: fixture.retrySegments });
  await render('segments'); expect(text()).toContain('Synthetic index refusal'); expect(text()).toContain('Synthetic definition');
  await click('Retry segments'); expect(fixture.retrySegments).toHaveBeenCalledTimes(1);
});

it('distinguishes filtered-out definitions and lets the visitor clear the filters', async () => {
  await render('segments'); const input = host.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'no match');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(text()).toContain('No definitions match these filters');
  await click('Clear filters'); expect(text()).toContain('Synthetic definition');
});

it('settles rejected definition reads and retries without enabling an unscoped segment feed', async () => {
  fixture.segmentRead.mockRejectedValueOnce(new Error('Synthetic network failure')); await render('detail');
  expect(text()).toContain('The segment definition could not be read');
  expect(fixture.feed.mock.lastCall?.[1]).toBe(false);
  await click('Retry definition'); expect(text()).toContain('Synthetic definition');
  expect(fixture.feed.mock.lastCall?.[1]).toBe(true); expect(fixture.feed.mock.lastCall?.[2]).toBe('synthetic-segment');
  expect(text()).not.toContain('MARKET CAP'); expect(text()).not.toContain('$');
});

it.each(['dashboard', 'detail'] as const)('shows loaded scope on %s without presenting global counts or values as results', async page => {
  vi.useFakeTimers();
  fixture.feed.mockReturnValue(feedState({ hasNextPage: true, data: { pages: [{ items: [{ id: 'loaded-one' }], stats: { total_vehicles: 919000, total_value: 17000000000 } }] } }));
  await render(page);
  expect(text()).toContain('1 vehicle record loaded · more available');
  expect(text()).not.toContain('919'); expect(text()).not.toContain('$');
  const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'manual');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(input.value).toBe('manual');
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(fixture.feed.mock.lastCall?.[0].searchText).toBe('manual');
});

it.each([{page:'dashboard', action:'Clear filters'}, {page:'detail', action:'Clear filters'}, {page:'dashboard', action:'Reset sidebar filters'}, {page:'detail', action:'Reset sidebar filters'}] as const)('clears a pending search draft with $action on $page', async ({page, action}) => {
  vi.useFakeTimers();
  await render(page, 'deal_score');
  const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'pending search');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(input.value).toBe('pending search');
  expect(fixture.feed.mock.lastCall?.[0].searchText).toBe('');
  await click(action);
  expect(input.value).toBe('');
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(input.value).toBe('');
  expect(fixture.feed.mock.lastCall?.[0].searchText).toBe('');
});
