// @vitest-environment jsdom
import React, { act, lazy, Suspense } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ErrorBoundary from './ErrorBoundary';
import AppErrorBoundary from './util/ErrorBoundary';
import { AuthErrorBoundary } from './auth/AuthErrorBoundary';

describe('route chunk recovery', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    sessionStorage.clear();
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(globalThis, 'setTimeout');
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
    sessionStorage.clear();
  });

  async function rejectRoute(message: string, key = 'route') {
    const Page = lazy(() => Promise.reject(new TypeError(message)));
    await act(async () => {
      root.render(
        <AppErrorBoundary>
          <ErrorBoundary key={key}>
            <AuthErrorBoundary>
              <Suspense fallback={null}><Page /></Suspense>
            </AuthErrorBoundary>
          </ErrorBoundary>
        </AppErrorBoundary>,
      );
    });
    // The inner route boundary catches this; the app boundary never receives it.
    expect(host.textContent).toContain('Something went wrong');
  }

  const reloads = () => vi.mocked(setTimeout).mock.calls.filter(([, delay]) => delay === 50);

  it.each([
    'Failed to fetch dynamically imported module: /assets/FeedPage-old.js',
    'Importing a module script failed.',
    'Loading chunk 42 failed.',
  ])('recovers a rejected lazy route: %s', async (message) => {
    await rejectRoute(message);
    expect(sessionStorage.getItem('__nuke_chunk_reload__')).toBe('1');
    expect(reloads()).toHaveLength(1);
  });

  it('does not reload for an ordinary render error', async () => {
    await rejectRoute('Cannot read properties of undefined');
    expect(sessionStorage.getItem('__nuke_chunk_reload__')).toBeNull();
    expect(reloads()).toHaveLength(0);
  });

  it('keeps the fallback when the tab has already tried to reload', async () => {
    sessionStorage.setItem('__nuke_chunk_reload__', '1');
    await rejectRoute('Failed to fetch dynamically imported module: /assets/FeedPage-old.js');
    expect(reloads()).toHaveLength(0);
    expect(host.textContent).toContain('Reload Page');
  });

  it('shares the existing app guard across route failures', async () => {
    await rejectRoute('Loading chunk 42 failed.');
    await rejectRoute('Loading chunk 43 failed.', 'next-route');
    expect(reloads()).toHaveLength(1);
  });
});
