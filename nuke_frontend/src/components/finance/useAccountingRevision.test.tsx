// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({
  latest: vi.fn(), count: vi.fn(), owners: [] as string[], heads: [] as boolean[], removed: vi.fn(),
  status: null as null | ((status: string) => void), change: null as null | (() => void), filter: '',
}));
vi.mock('../../lib/supabase', () => ({ supabase: {
  from() {
    const q = {
      head: false,
      select(_fields: string, options?: { head?: boolean }) { q.head = !!options?.head; fixture.heads.push(q.head); return q; },
      eq(_field: string, owner: string) { fixture.owners.push(owner); return q; }, order() { return q; },
      limit: (...args: unknown[]) => fixture.latest(...args),
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) { return Promise.resolve(fixture.count()).then(resolve, reject); },
    }; return q;
  },
  channel() { return { on(_event: string, options: { filter: string }, callback: () => void) { fixture.filter = options.filter; fixture.change = callback; return this; }, subscribe(callback: (status: string) => void) { fixture.status = callback; return this; } }; },
  removeChannel: fixture.removed,
} }));
import { useAccountingRevision } from './useAccountingRevision';
it('reads a size-independent signature, takes realtime changes as they land, falls back to polling, reports failures, stops on unmount', async () => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; vi.useFakeTimers();
  fixture.latest.mockReset(); fixture.count.mockReset(); fixture.removed.mockReset(); fixture.owners = []; fixture.heads = [];
  fixture.latest.mockResolvedValue({ data: [{ updated_at: 'one' }], error: null });
  fixture.count.mockResolvedValue({ data: null, count: 891, error: null });
  const revisions: string[] = [], node = document.createElement('div'), root = createRoot(node);
  function Reader() { const live = useAccountingRevision('owner'); revisions.push(live.revision); return <p>{live.message}</p>; }
  await act(async () => root.render(<Reader />));
  expect(revisions.at(-1)).toBe('891:one'); expect(node.textContent).toContain('every 5 seconds');
  expect(fixture.owners.every(owner => owner === 'owner')).toBe(true); expect(fixture.heads).toEqual([false, true]);
  expect(fixture.latest.mock.calls[0]).toEqual([1]); expect(fixture.filter).toBe('owner_id=eq.owner');
  // Polling while realtime is not subscribed.
  fixture.latest.mockResolvedValue({ data: [{ updated_at: 'two' }], error: null });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(revisions.at(-1)).toBe('891:two');
  // Subscribed: a change arrives through the channel, and the poll slows to a heartbeat.
  await act(async () => { fixture.status!('SUBSCRIBED'); await Promise.resolve(); });
  expect(node.textContent).toContain('as they happen');
  fixture.latest.mockResolvedValue({ data: [{ updated_at: 'three' }], error: null });
  await act(async () => { fixture.change!(); await Promise.resolve(); });
  expect(revisions.at(-1)).toBe('891:three');
  fixture.count.mockResolvedValue({ data: null, count: 892, error: null });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(revisions.at(-1)).toBe('891:three');
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(revisions.at(-1)).toBe('892:three');
  // The channel drops: back to 5-second polling.
  await act(async () => { fixture.status!('CHANNEL_ERROR'); await Promise.resolve(); });
  expect(node.textContent).toContain('every 5 seconds');
  fixture.latest.mockResolvedValue({ data: [{ updated_at: 'four' }], error: null });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(revisions.at(-1)).toBe('892:four');
  // A failed read is reported, never shown as an empty book.
  fixture.count.mockResolvedValue({ data: null, count: null, error: new Error('offline') });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(node.textContent).toContain('Live updates unavailable'); expect(revisions.at(-1)).toBe('892:four');
  await act(async () => root.unmount()); const calls = fixture.latest.mock.calls.length;
  expect(fixture.removed).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(120000); }); expect(fixture.latest.mock.calls).toHaveLength(calls);
  vi.useRealTimers();
});
