// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ read: vi.fn(), owners: [] as string[] }));
vi.mock('../../lib/supabase', () => ({ supabase: { from() { const q = { select() { return q; }, eq(_field: string, owner: string) { fixture.owners.push(owner); return q; }, order() { return q; }, limit: fixture.read }; return q; } } }));
import { useAccountingRevision } from './useAccountingRevision';
it('observes another session’s metadata update, reports failures, and stops reads on unmount', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; vi.useFakeTimers();
  fixture.read.mockReset(); fixture.owners = [];
  fixture.read.mockResolvedValue({ data: [{ id: 'source', updated_at: 'one' }], error: null });
  const revisions: string[] = [], node = document.createElement('div'), root = createRoot(node);
  function Reader() { const live = useAccountingRevision('owner'); revisions.push(live.revision); return <p>{live.message}</p>; }
  await act(async () => root.render(<Reader />));
  fixture.read.mockResolvedValue({ data: [{ id: 'source', updated_at: 'two' }], error: null });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(revisions.at(-1)).toContain('two'); expect(fixture.owners.every(owner => owner === 'owner')).toBe(true);
  fixture.read.mockResolvedValue({ data: null, error: new Error('offline') });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(node.textContent).toContain('Live updates unavailable');
  await act(async () => root.unmount()); const calls = fixture.read.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); }); expect(fixture.read.mock.calls).toHaveLength(calls);
  vi.useRealTimers();
});
