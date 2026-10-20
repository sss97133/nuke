// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const loaded = vi.hoisted(() => ({ count: 0 }));
vi.mock('./HeaderSearch', () => { loaded.count += 1; return { default: () => <input type="text" aria-label="real" /> }; });
import HeaderSearchLauncher from './HeaderSearchLauncher';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; vi.useRealTimers(); });

describe('HeaderSearchLauncher prefetch', () => {
  it('does not fetch the real search until the page has loaded and paused', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
    const el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => { root!.render(<HeaderSearchLauncher />); });
    await act(async () => { vi.advanceTimersByTime(1900); });
    expect(loaded.count).toBe(0);
    await act(async () => { vi.advanceTimersByTime(200); });
    vi.useRealTimers();
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(loaded.count).toBe(1);
  });
});
