// @vitest-environment jsdom
import React, { act, useContext } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PopupStackContext, PopupStackProvider } from './PopupStack';

function Contents({ searchQuery = '', popupExpanded = false }: { searchQuery?: string; popupExpanded?: boolean }) {
  return <p data-testid="reader">Query: {searchQuery || '(empty)'}; expanded: {String(popupExpanded)}</p>;
}
function Launcher() {
  const stack = useContext(PopupStackContext)!;
  return <><button onClick={() => stack.push(<Contents />, 'Source evidence', 460, false)}>Open field</button>
    <button onClick={() => stack.push(<Contents />, 'Searchable records', 460, true)}>Open records</button></>;
}
let root: Root, host: HTMLDivElement;
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<PopupStackProvider><Launcher /></PopupStackProvider>));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.getAttribute('aria-label') === label || item.textContent === label);
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
it('preserves expand, minimize, semantic restore, and close paths', async () => {
  await click('Open field');
  expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Source evidence');
  await click('Toggle expand');
  expect(document.querySelector('[data-testid="reader"]')?.textContent).toContain('expanded: true');
  expect(document.querySelector<HTMLElement>('[role="dialog"]')?.style.width).toBe('700px');
  await click('Minimize popup');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  const restore = document.querySelector('[aria-label="Restore Source evidence"]');
  expect(restore?.tagName).toBe('BUTTON');
  await click('Restore Source evidence');
  expect(document.querySelector('[data-testid="reader"]')?.textContent).toContain('expanded: true');
  await click('Close popup');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it('closes only the top visible window with Escape and preserves the underlying reader', async () => {
  await click('Open field'); await click('Open records');
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Source evidence');
});
it('retains the searchable popup contract and clears pending work when closed', async () => {
  vi.useFakeTimers(); await click('Open records');
  const input = document.querySelector<HTMLInputElement>('[aria-label="Search Searchable records"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'retained source');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(document.querySelector('[data-testid="reader"]')?.textContent).toContain('(empty)');
  await act(async () => vi.advanceTimersByTime(300));
  expect(document.querySelector('[data-testid="reader"]')?.textContent).toContain('retained source');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'unfinished');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('Close popup');
  expect(vi.getTimerCount()).toBe(0);
});
it('keeps mouse drag and resize attached to the existing window', async () => {
  await click('Open field');
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  await act(async () => dialog.querySelector('.popup-window-title')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 50, clientY: 50 })));
  await act(async () => document.dispatchEvent(new MouseEvent('mousemove', { clientX: 75, clientY: 80 })));
  await act(async () => document.dispatchEvent(new MouseEvent('mouseup')));
  // jsdom does not parse the existing clamp/min expression used for horizontal positioning.
  expect(dialog.style.top).toContain('30px');
  await act(async () => dialog.querySelector('[data-popup-resize]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 0, clientY: 0 })));
  await act(async () => document.dispatchEvent(new MouseEvent('mousemove', { clientX: 600, clientY: 500 })));
  await act(async () => document.dispatchEvent(new MouseEvent('mouseup')));
  expect(dialog.style.width).toBe('600px'); expect(dialog.style.height).toBe('500px');
});
