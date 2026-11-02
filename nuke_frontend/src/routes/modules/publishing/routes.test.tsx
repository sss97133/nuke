// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../../pages/publishing/PublishingDashboard', () => ({ default: () => <div>publishing home</div> }));
import PublishingModuleRoutes from './routes';

// The office is mounted once, at /accounting, behind its one sign-in gate (DomainRoutes). The older /publishing/finance path only points there, so there
// is no second mount to keep guarded: a visitor who follows it ends where /accounting sends a visitor.
const Where = ({ label }: { label: string }) => { const l = useLocation(); return <div data-testid={label}>{l.pathname}{l.search}</div>; };
let node: HTMLDivElement, root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; node = document.createElement('div'); document.body.append(node); root = createRoot(node); });
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });
const visit = async (path: string) => {
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/accounting" element={<Where label="accounting" />} /><Route path="/publishing/*" element={<PublishingModuleRoutes />} />
  </Routes></MemoryRouter>));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
};

it('/publishing/finance is only a pointer: it replaces itself with /accounting, where the one gate is, and mounts nothing of its own', async () => {
  await visit('/publishing/finance');
  expect(node.querySelector('[data-testid="accounting"]')?.textContent).toBe('/accounting');
});

it('the rest of the publishing module is untouched', async () => {
  await visit('/publishing');
  expect(node.textContent).toContain('publishing home');
});
