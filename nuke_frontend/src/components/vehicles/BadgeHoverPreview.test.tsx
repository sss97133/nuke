// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useBadgeHover } from './BadgeHoverPreview';
it('retains the element rectangle after React releases the event currentTarget', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  const host = document.createElement('div'), root = createRoot(host);
  function Probe() {
    const hover = useBadgeHover();
    return <button onMouseEnter={e => hover.onBadgeEnter('tier', e)}>{hover.badgeRect ? `rect:${hover.badgeRect.x}` : 'closed'}</button>;
  }
  try {
    await act(async () => root.render(<Probe />));
    host.querySelector('button')!.getBoundingClientRect = () => new DOMRect(42, 20, 30, 10);
    await act(async () => { host.querySelector('button')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    await act(async () => { vi.advanceTimersByTime(150); });
    expect(host.textContent).toBe('rect:42');
  } finally { await act(async () => root.unmount()); vi.useRealTimers(); }
});
