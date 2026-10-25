import { expect, it, vi } from 'vitest';
import { createViewerScopedInflight, ViewerReadInvalidatedError } from './viewerScopedInflight';

type Session = { user: { id: string } } | null;
const session = (id: string | null): Session => id ? { user: { id } } : null;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function clientFixture() {
  let viewer: string | null = 'A';
  const listeners = new Set<(event: string, value: Session) => void>();
  const client = { auth: {
    getSession: vi.fn(async () => ({ data: { session: session(viewer) }, error: null as unknown })),
    onAuthStateChange: (fn: (event: string, value: Session) => void) => {
      listeners.add(fn);
      return { data: { subscription: { unsubscribe: () => { listeners.delete(fn); } } } };
    },
  } };
  const change = (id: string | null, event = 'SIGNED_IN') => {
    viewer = id; listeners.forEach(fn => fn(event, session(id)));
  };
  return { client, change, listeners };
}

it('coalesces same-viewer requests through token refresh, but never caches settled payloads', async () => {
  const f = clientFixture(), read = createViewerScopedInflight<string>(), pending = deferred<string>();
  const loader = vi.fn(() => pending.promise);
  const first = read(f.client, 'vehicle', loader);
  await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
  f.change('A', 'TOKEN_REFRESHED');
  const second = read(f.client, 'vehicle', loader);
  await vi.waitFor(() => expect(f.client.auth.getSession).toHaveBeenCalledTimes(2));
  pending.resolve('A');
  expect(await Promise.all([first, second])).toEqual(['A', 'A']);
  expect(loader).toHaveBeenCalledTimes(1);
  expect(f.listeners.size).toBe(0);
  await read(f.client, 'vehicle', loader);
  expect(loader).toHaveBeenCalledTimes(2);
});

it.each(['B', null])('rejects immediately on transition to %s and never returns the late former payload', async viewer => {
  const f = clientFixture(), read = createViewerScopedInflight<string>(), pending = deferred<string>();
  const loader = vi.fn(() => pending.promise);
  const first = read(f.client, 'vehicle', loader);
  const rejected = expect(first).rejects.toBeInstanceOf(ViewerReadInvalidatedError);
  await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
  f.change(viewer);
  await rejected; // Does not wait for the old network request (or its profile timeout).
  expect(f.listeners.size).toBe(0);
  expect(await read(f.client, 'vehicle', async () => 'current')).toBe('current');
  pending.resolve('PRIVATE A');
});

it('does not rejoin invalidated A after A → anonymous → A, even before the old request settles', async () => {
  const f = clientFixture(), read = createViewerScopedInflight<string>(), pending = deferred<string>();
  const old = read(f.client, 'vehicle', () => pending.promise).catch(error => error);
  await vi.waitFor(() => expect(f.client.auth.getSession).toHaveBeenCalledTimes(1));
  f.change(null); f.change('A');
  expect(await read(f.client, 'vehicle', async () => 'NEW A')).toBe('NEW A');
  pending.resolve('OLD A');
  expect(await old).toBeInstanceOf(ViewerReadInvalidatedError);
});

it('subscribes before session sampling and refuses a stale sample without dispatching the read', async () => {
  const f = clientFixture(), read = createViewerScopedInflight<string>();
  const sample = deferred<{ data: { session: Session }; error: unknown }>();
  f.client.auth.getSession.mockReturnValueOnce(sample.promise);
  const loader = vi.fn(async () => 'private');
  const result = read(f.client, 'vehicle', loader);
  const rejected = expect(result).rejects.toBeInstanceOf(ViewerReadInvalidatedError);
  expect(f.listeners.size).toBe(1);
  f.change('B'); sample.resolve({ data: { session: session('A') }, error: null });
  await rejected;
  expect(loader).not.toHaveBeenCalled(); expect(f.listeners.size).toBe(0);
});

it.each(['returned', 'thrown'])('does not dispatch when the session lookup fails (%s)', async kind => {
  const f = clientFixture(), read = createViewerScopedInflight<string>(), loader = vi.fn(async () => 'private');
  if (kind === 'returned') f.client.auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: new Error('unavailable') });
  else f.client.auth.getSession.mockRejectedValueOnce(new Error('unavailable'));
  await expect(read(f.client, 'vehicle', loader)).rejects.toBeInstanceOf(ViewerReadInvalidatedError);
  expect(loader).not.toHaveBeenCalled(); expect(f.listeners.size).toBe(0);
});

it('does not share across client instances or operation keys, and cleans up rejected reads', async () => {
  const first = clientFixture(), second = clientFixture(), read = createViewerScopedInflight<string>();
  const pending = deferred<string>();
  const prior = read(first.client, 'vehicle', () => pending.promise).catch(error => error);
  expect(await read(second.client, 'vehicle', async () => 'other client')).toBe('other client');
  expect(await read(first.client, 'different vehicle', async () => 'other vehicle')).toBe('other vehicle');
  pending.reject(new Error('reader failed'));
  expect(await prior).toEqual(new Error('reader failed'));
  expect(first.listeners.size).toBe(0); expect(second.listeners.size).toBe(0);
  expect(await read(first.client, 'vehicle', async () => 'retry')).toBe('retry');
});

it('reads afresh when an injected reader cannot establish viewer scope', async () => {
  const read = createViewerScopedInflight<string>(), client = {}, pending = deferred<string>();
  const loader = vi.fn(() => pending.promise);
  const first = read(client, 'vehicle', loader), second = read(client, 'vehicle', loader);
  pending.resolve('fresh'); await Promise.all([first, second]); expect(loader).toHaveBeenCalledTimes(2);
});
