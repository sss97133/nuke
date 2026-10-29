// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ feed: vi.fn(), rpc: vi.fn(), channel: vi.fn(), removeChannel: vi.fn(), event: null as null | ((payload: unknown) => void), status: null as null | ((status: string) => void), query: null as unknown }));
vi.mock('../lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    if (table !== 'vehicle_observations') throw new Error(`Unexpected table ${table}`);
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), contains: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: fixture.feed };
    fixture.query = query; return query;
  }, rpc: fixture.rpc, channel: fixture.channel, removeChannel: fixture.removeChannel,
} }));
vi.mock('../hooks/usePageTitle', () => ({ usePageTitle: () => {} }));
vi.mock('../components/PrefetchLink', () => ({ PrefetchLink: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));
import ImageProcessingDashboard from './ImageProcessingDashboard';

const atom = (id: string, confidence: number | null = null) => ({ id, vehicle_id: 'synthetic-vehicle', confidence_score: confidence, observed_at: null, ingested_at: null, structured_data: { analysis_kind: 'image_deep_byok', image_id: 'synthetic-image', agent_model: 'Synthetic model' } });
const reply = (data: unknown) => ({ data, error: null });
let host: HTMLDivElement, root: Root;
const render = async () => { await act(async () => root.render(<ImageProcessingDashboard />)); };
const button = (label: string) => [...host.querySelectorAll('button')].find(node => node.textContent === label)!;
const click = async (label: string) => { await act(async () => button(label).click()); };
const text = () => host.textContent || '';
beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.feed.mockReset().mockResolvedValue(reply([]));
  fixture.rpc.mockReset().mockResolvedValue(reply({ coverage: { photos: 0, vehicles: 0, seen_t1: 0, gated_t0: 0, pct_deep: null } }));
  fixture.channel.mockReset().mockImplementation(() => {
    const channel = { on: vi.fn((_kind, _filter, callback) => { fixture.event = callback; return channel; }), subscribe: vi.fn(callback => { fixture.status = callback; return channel; }) };
    return channel;
  });
  fixture.removeChannel.mockReset(); fixture.event = null; fixture.status = null;
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

it('reports returned errors from both existing readers and lets the owner retry', async () => {
  fixture.feed.mockResolvedValueOnce({ data: null, error: { message: 'Feed refused' } });
  fixture.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Coverage refused' } });
  await render();
  expect(host.querySelectorAll('[role="alert"]')).toHaveLength(2);
  expect(text()).toContain('Feed refused'); expect(text()).toContain('Coverage refused');
  expect(text()).toContain('Activity counts are unknown');
  expect(text()).not.toContain('Reading processing data');
  await click('Refresh data');
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(text()).toContain('No matching recent analysis observations');
  expect(fixture.feed).toHaveBeenCalledWith(20);
  expect(fixture.rpc).toHaveBeenCalledWith('get_image_ecosystem_status');
});

it('settles rejected reads without remaining stuck in loading', async () => {
  fixture.feed.mockRejectedValueOnce(new Error('Synthetic network failure'));
  await render();
  expect(text()).toContain('Synthetic network failure');
  expect(button('Refresh data').disabled).toBe(false);
  expect(text()).toContain('0 / 0');
});

it('preserves missing confidence, dates and coverage ratios as unknown, while keeping measured zero', async () => {
  fixture.feed.mockResolvedValue(reply([atom('a'), atom('b', 0), atom('c', 0.8), atom('d', 2)]));
  await render();
  expect(text()).toContain('2 of 4 observations report confidence; 2 unknown');
  expect(text()).toContain('Confidence unknown');
  expect(text()).toContain('0% reported confidence');
  expect(text()).toContain('80% reported confidence');
  expect(text()).toContain('Time not reported');
  expect(host.querySelector('#image-processing-coverage-title')?.parentElement?.textContent).toContain('Unknown');
  expect(host.querySelector('a[href="/vehicle/synthetic-vehicle"]')).not.toBeNull();
});

it('keeps independent successful sections and labels retained data after a later failed refresh', async () => {
  fixture.feed.mockResolvedValueOnce(reply([atom('retained')]));
  fixture.rpc.mockResolvedValueOnce(reply({ coverage: { pct_deep: 0.5, seen_t1: 5, gated_t0: 10, photos: 12, vehicles: 2 } }));
  await render();
  fixture.feed.mockResolvedValueOnce({ data: null, error: { message: 'Feed unavailable' } });
  fixture.rpc.mockRejectedValueOnce(new Error('Coverage unavailable'));
  await click('Refresh data');
  expect(text()).toContain('Showing the last successful feed');
  expect(text()).toContain('Showing the last successful coverage');
  expect(text()).toContain('Synthetic model'); expect(text()).toContain('50%');
});

it('does not invent a rollup or zero ratios when the coverage reader supplies none', async () => {
  fixture.rpc.mockResolvedValueOnce(reply({}));
  await render();
  const section = host.querySelector('#image-processing-coverage-title')!.parentElement!;
  expect(section.textContent).toContain('reader has not reported a coverage rollup');
  expect(section.textContent).not.toContain('0%');
});

it('shows measured zero coverage and rejects malformed counters and ratios', async () => {
  fixture.rpc.mockResolvedValueOnce(reply({ coverage: { pct_deep: 0, pct_engine: -1, pct_clip: '0.5', photos: -1, vehicles: '3', seen_t1: 0, gated_t0: 10 } }));
  await render();
  const section = host.querySelector('#image-processing-coverage-title')!.parentElement!;
  expect(section.querySelector('.image-processing-number')?.textContent).toBe('0%');
  expect(section.textContent).toContain('0 / 10');
  expect(section.textContent).toContain('Unknown / Unknown');
  expect(section.textContent).not.toContain('-100%');
  expect(section.textContent).not.toContain('50%');
});

it('suppresses overlapping manual refreshes', async () => {
  let finish!: (value: unknown) => void;
  fixture.feed.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render();
  await act(async () => { button('Refreshing…').click(); button('Refreshing…').click(); });
  expect(fixture.feed).toHaveBeenCalledTimes(1); expect(fixture.rpc).toHaveBeenCalledTimes(1);
  await act(async () => finish(reply([])));
  expect(button('Refresh data').disabled).toBe(false);
});

it('makes event refresh opt-in, bounded and feed-only, and exposes subscription failure', async () => {
  vi.useFakeTimers(); await render(); expect(fixture.channel).not.toHaveBeenCalled();
  await click('Feed updates off');
  await act(async () => fixture.status!('SUBSCRIBED'));
  expect(text()).toContain('at most once a minute');
  await act(async () => {
    fixture.event!({ new: { kind: 'condition', structured_data: { analysis_kind: 'unrelated' } } });
    fixture.event!({ new: { kind: 'condition', structured_data: { analysis_kind: 'image_deep_byok' } } });
    fixture.event!({ new: { kind: 'condition', structured_data: { analysis_kind: 'image_deep_byok' } } });
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(fixture.feed).toHaveBeenCalledTimes(2); expect(fixture.rpc).toHaveBeenCalledTimes(1);
  await act(async () => fixture.status!('CHANNEL_ERROR'));
  expect(text()).toContain('Live updates are unavailable');
  await click('Feed updates on'); expect(fixture.removeChannel).toHaveBeenCalledTimes(1);
});

it('does not run scheduled feed reads while hidden or after updates are switched off', async () => {
  vi.useFakeTimers(); await render(); await click('Feed updates off');
  await act(async () => fixture.event!({ new: { kind: 'condition', structured_data: { analysis_kind: 'image_deep_byok' } } }));
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(fixture.feed).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  await act(async () => fixture.event!({ new: { kind: 'condition', structured_data: { analysis_kind: 'image_deep_byok' } } }));
  await click('Feed updates on');
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(fixture.feed).toHaveBeenCalledTimes(1);
});
