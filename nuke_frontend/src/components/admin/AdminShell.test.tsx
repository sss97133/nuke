// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ access: { loading: false, isAdmin: true } }));
vi.mock('../../hooks/useAdminAccess', () => ({ useAdminAccess: () => fixture.access }));
vi.mock('../../lib/supabase', () => ({ supabase: { from: () => {
  const query = { select: () => query, eq: () => query, is: () => query, then: (resolve: (value: unknown) => unknown) => Promise.resolve({ count: 0, error: null }).then(resolve) };
  return query;
} } }));
import AdminShell from './AdminShell';
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  fixture.access = { loading: false, isAdmin: true };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = async () => { await act(async () => root.render(<MemoryRouter initialEntries={['/admin/sources']}><Routes>
  <Route path="/admin" element={<AdminShell />}><Route path="sources" element={<h1>Source fixture</h1>} /><Route path="image-processing" element={<h1>Image fixture</h1>} /></Route>
  <Route path="/org/dashboard" element={<h1>Organization fixture</h1>} />
</Routes></MemoryRouter>)); };
const button = (text: string) => [...host.querySelectorAll('button')].find(node => node.textContent?.includes(text))!;
const click = async (node: HTMLElement) => { await act(async () => node.click()); };
it('opens navigation and closes it after a destination changes without hiding the page', async () => {
  await render(); expect(host.textContent).toContain('Source fixture');
  expect(button('Admin navigation').getAttribute('aria-expanded')).toBe('false');
  await click(button('Admin navigation')); expect(button('Admin navigation').getAttribute('aria-expanded')).toBe('true');
  await click(host.querySelector<HTMLAnchorElement>('a[href="/admin/image-processing"]')!);
  expect(host.textContent).toContain('Image fixture'); expect(button('Admin navigation').getAttribute('aria-expanded')).toBe('false');
  expect(host.querySelector('.admin-shell-mobile-header strong')?.textContent).toBe('Image Processing');
});
it('opens the collapsed navigation and focuses its search for the existing keyboard shortcut', async () => {
  await render();
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true })));
  expect(button('Admin navigation').getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement).toBe(host.querySelector('input'));
});
it('searches all destinations including collapsed sections, then restores grouped navigation', async () => {
  await render(); const input = host.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'diagnostic');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(host.querySelectorAll('nav a')).toHaveLength(1);
  expect(host.querySelector('nav a')?.getAttribute('href')).toBe('/admin/data-diagnostic');
  await click(button('Clear search')); expect(host.querySelectorAll('nav a').length).toBeGreaterThan(1);
  await click(button('Tools'));
  expect(button('Tools').getAttribute('aria-expanded')).toBe('true');
  expect(localStorage.getItem('nuke_admin_nav_showTools')).toBe('1');
});
it('preserves the existing non-admin redirect and does not expose the nested page', async () => {
  fixture.access.isAdmin = false; await render();
  expect(host.textContent).toContain('Organization fixture'); expect(host.textContent).not.toContain('Source fixture');
});
