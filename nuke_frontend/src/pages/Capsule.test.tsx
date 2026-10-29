// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ legacy: vi.fn(), getSession: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: { auth: { getSession: fixture.getSession } } }));
vi.mock('../services/profileService', () => ({ ProfileService: { getProfileRecord: async () => ({ data: {} }) } }));
vi.mock('../utils/cachedSession', () => ({ readCachedSession: () => null }));
vi.mock('../components/PrefetchLink', () => ({ default: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));
vi.mock('./ShopFinancials', () => ({ default: () => { fixture.legacy(); return <div>Legacy financials</div>; } }));
vi.mock('./PersonalPhotoLibrary', () => ({ PersonalPhotoLibrary: () => null }));
vi.mock('../components/profile/OrganizationAffiliations', () => ({ default: () => null }));
vi.mock('../components/profile/ProfessionalToolbox', () => ({ default: () => null }));
vi.mock('../components/ProfileVerification', () => ({ ProfileVerification: () => null }));
vi.mock('../components/auth/ChangePasswordForm', () => ({ default: () => null }));
vi.mock('../components/settings/StripeKeysManager', () => ({ default: () => null }));
vi.mock('../components/settings/AIProviderSettings', () => ({ default: () => null }));
vi.mock('../components/settings/APIAccessSubscription', () => ({ default: () => null }));
vi.mock('../components/profile/KnowledgeLibrary', () => ({ default: () => null }));
vi.mock('../components/profile/StreamingDashboard', () => ({ default: () => null }));
vi.mock('../components/settings/AppearanceSpecimen', () => ({ default: () => <h2>Appearance controls</h2> }));
vi.mock('../components/facebook/FacebookConnectionSettings', () => ({ default: () => null }));
import Capsule from './Capsule';

let node: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.legacy.mockReset(); fixture.getSession.mockReset();
  fixture.getSession.mockResolvedValue({ data: { session: { user: { id: 'synthetic-owner' } } } });
  node = document.createElement('div'); document.body.append(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });
const render = (path: string) => root.render(<MemoryRouter initialEntries={[path]}><Routes>
  <Route path="/capsule" element={<Capsule />} />
  <Route path="/accounting" element={<h1>Canonical accounting office</h1>} />
  <Route path="/login" element={<h1>Sign in</h1>} />
</Routes></MemoryRouter>);

it('opens saved financials links in the current accounting office without running the retired reader', async () => {
  await act(async () => render('/capsule?tab=financials'));
  expect(node.textContent).toBe('Canonical accounting office');
  expect(fixture.legacy).not.toHaveBeenCalled();
});
it('offers useful workspace destinations and opens the same office from navigation', async () => {
  await act(async () => render('/capsule'));
  expect(node.querySelector('h1')?.textContent).toBe('Your workspace');
  expect(node.textContent).not.toContain('Cash Balance');
  expect(node.querySelector('a[href="/accounting"]')).not.toBeNull();
  expect(node.querySelector('a[href="/work"]')).not.toBeNull();
  await act(async () => Array.from(node.querySelectorAll('nav button')).find(button => button.textContent === 'Accounting')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(node.textContent).toBe('Canonical accounting office');
});
it('preserves the appearance deep link and active navigation state', async () => {
  await act(async () => render('/capsule?tab=appearance'));
  expect(node.textContent).toContain('Appearance controls');
  expect(node.querySelector('[aria-current="page"]')?.textContent).toBe('Appearance');
});
it('falls back to the dashboard for an unknown saved tab', async () => {
  await act(async () => render('/capsule?tab=retired-panel'));
  expect(node.querySelector('h1')?.textContent).toBe('Your workspace');
  expect(node.querySelector('[aria-current="page"]')?.textContent).toBe('Dashboard');
});
it('keeps the existing signed-out boundary before forwarding a financials link', async () => {
  fixture.getSession.mockResolvedValue({ data: { session: null } });
  await act(async () => render('/capsule?tab=financials'));
  expect(node.textContent).toBe('Sign in');
  expect(fixture.legacy).not.toHaveBeenCalled();
});
