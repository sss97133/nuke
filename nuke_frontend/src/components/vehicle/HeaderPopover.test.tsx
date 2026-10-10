// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ mobile: true }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => fixture.mobile }));
import { HeaderPopover } from './HeaderPopover';
let host: HTMLDivElement, root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host=document.createElement('div'); document.body.append(host); root=createRoot(host); fixture.mobile=true; });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('places a phone sheet outside sticky stacking contexts and above the fixed navigation', async () => {
  const close=vi.fn();
  await act(async () => root.render(<HeaderPopover open title="Seller stack" onClose={close}><a href="/stacks">Evidence</a></HeaderPopover>));
  const dialog=document.querySelector<HTMLElement>('[role=dialog]')!;
  expect(host.contains(dialog)).toBe(false); expect(dialog.parentElement).toBe(document.body);
  expect(Number(dialog.style.zIndex)).toBeGreaterThan(1000);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})));
  expect(close).toHaveBeenCalledOnce();
});
it('keeps the desktop popover anchored to its trigger container', async () => {
  fixture.mobile=false;
  await act(async () => root.render(<HeaderPopover open title="Bids" onClose={() => {}}>Evidence</HeaderPopover>));
  expect(host.querySelector('[role=dialog]')).not.toBeNull();
});
