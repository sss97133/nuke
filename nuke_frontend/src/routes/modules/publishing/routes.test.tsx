// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ value: { user: null as null | { id: string }, loading: false } }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => auth.value }));
vi.mock('../../../pages/publishing/FinanceDashboard', () => ({ default: () => <div>the private office</div> }));
vi.mock('../../../pages/publishing/PublishingDashboard', () => ({ default: () => <div>publishing home</div> }));
import PublishingModuleRoutes from './routes';

const Where = () => { const l = useLocation(); return <div data-testid="where">{l.pathname}{l.search}</div>; };
let node: HTMLDivElement, root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; node = document.createElement('div'); document.body.append(node); root = createRoot(node); });
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });
const visit = async (path: string) => {
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/login" element={<Where />} /><Route path="/publishing/*" element={<PublishingModuleRoutes />} />
  </Routes></MemoryRouter>));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
};

it('a visitor on /publishing/finance is sent to sign in and the office never mounts', async () => {
  auth.value = { user: null, loading: false };
  await visit('/publishing/finance');
  expect(node.textContent).not.toContain('the private office');
  expect(node.querySelector('[data-testid="where"]')?.textContent).toBe('/login?returnUrl=%2Fpublishing%2Ffinance');
});

it('while sign-in is still being resolved the office does not mount either', async () => {
  auth.value = { user: null, loading: true };
  await visit('/publishing/finance');
  expect(node.textContent).not.toContain('the private office');
});

it('a signed-in account reaches the office', async () => {
  auth.value = { user: { id: 'u-1' }, loading: false };
  await visit('/publishing/finance');
  expect(node.textContent).toContain('the private office');
});

it('the rest of the publishing module is untouched by the gate', async () => {
  auth.value = { user: null, loading: false };
  await visit('/publishing');
  expect(node.textContent).toContain('publishing home');
});
