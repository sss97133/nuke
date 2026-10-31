// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ mobile: true }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => fixture.mobile }));
import { HeaderPopover } from './HeaderPopover';
import { PopupStackContext } from '../popups/PopupStack';
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
it('retains its vehicle context while a nested exploration window handles dismissal', async () => {
  const close = vi.fn();
  const stack = { stack: [{ id: 'nested' }], push: vi.fn(), pop: vi.fn(), popTop: vi.fn(), closeAll: vi.fn(), toggleMinimize: vi.fn(), toggleExpanded: vi.fn() };
  const render = (nested: boolean) => root.render(<PopupStackContext.Provider value={{ ...stack, stack: nested ? stack.stack : [] } as any}>
    <HeaderPopover open title="Transmission" onClose={close}>Vehicle context</HeaderPopover>
  </PopupStackContext.Provider>);
  await act(async () => render(true));
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
  expect(close).not.toHaveBeenCalled();
  await act(async () => render(false));
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(close).toHaveBeenCalledOnce();
});
it('keeps the field open when its source-photo modal is closed by mouse', async () => {
  fixture.mobile = false;
  const close = vi.fn(), photo = document.createElement('div');
  photo.setAttribute('role', 'dialog'); photo.setAttribute('aria-modal', 'true'); document.body.append(photo);
  try {
    await act(async () => root.render(<HeaderPopover open title="Transmission" onClose={close}>Vehicle context</HeaderPopover>));
    await act(async () => photo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(close).not.toHaveBeenCalled();
    await act(async () => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(close).toHaveBeenCalledOnce();
  } finally { photo.remove(); }
});
