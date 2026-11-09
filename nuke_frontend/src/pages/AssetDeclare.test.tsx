// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ rpc: vi.fn(), user: { current: null as null | { id: string } } }));
vi.mock('../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
vi.mock('../hooks/usePageTitle', () => ({ usePageTitle: () => undefined }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: fixture.user.current, session: null, loading: false }) }));
vi.mock('../components/PrefetchLink', () => ({ PrefetchLink: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => <a href={to} className={className}>{children}</a> }));
import AssetDeclarePage, { problems, YEAR_RULE } from './AssetDeclare';
import HeldAssetsPage, { ledgerLine } from './HeldAssets';

let node: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.rpc.mockReset(); fixture.user.current = null;
  node = document.createElement('div'); document.body.append(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });
const render = (path: string) => root.render(<MemoryRouter initialEntries={[path]}><Routes>
  <Route path="/assets/new" element={<AssetDeclarePage />} />
  <Route path="/assets/mine" element={<HeldAssetsPage />} />
  <Route path="/assets/:assetId" element={<h1>Profile</h1>} />
</Routes></MemoryRouter>);
const type = (el: Element | null, value: string) => {
  const input = el as HTMLInputElement; const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
  setter?.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true }));
};

it('asks a visitor to sign in and never shows a price field', async () => {
  await act(async () => render('/assets/new'));
  expect(node.textContent).toContain('Sign in');
  expect(node.querySelector('form')).toBeNull();
});

it('a signed-in holder declares a work through one Sign and lands on its profile', async () => {
  fixture.user.current = { id: 'u1' };
  fixture.rpc.mockResolvedValue({ data: { asset_id: '11111111-1111-4111-8111-111111111111', duplicate: false, visibility: 'private' }, error: null });
  await act(async () => render('/assets/new'));
  expect(Array.from(node.querySelectorAll('label')).some(l => /price|value|worth/i.test(l.textContent ?? ''))).toBe(false);
  const inputs = node.querySelectorAll('input.jb-input');
  await act(async () => { type(inputs[0], ' Danger   End of Road '); type(inputs[1], 'oil and enamel on canvas'); type(inputs[2], 'c. 2024'); type(inputs[3], '48 x 60 in'); });
  await act(async () => node.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(fixture.rpc).toHaveBeenCalledWith('declare_held_asset', expect.objectContaining({ p_asset_type: 'artwork', p_title: ' Danger   End of Road ', p_medium: 'oil and enamel on canvas', p_year: 'c. 2024', p_dimensions: '48 x 60 in', p_edition: null, p_notes: null, p_visibility: 'private' }));
  expect(node.querySelector('h1')?.textContent).toBe('Profile');
});

it('stops a bad year before the Sign and says why, in the holder\'s words', async () => {
  fixture.user.current = { id: 'u1' };
  await act(async () => render('/assets/new'));
  const inputs = node.querySelectorAll('input.jb-input');
  await act(async () => { type(inputs[0], 'Untitled'); type(inputs[2], 'nineteen sixty'); });
  await act(async () => node.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(fixture.rpc).not.toHaveBeenCalled();
  expect(node.querySelector('[role="alert"]')?.textContent).toContain('A year that reads like 1965');
  expect(problems({ asset_type: 'artwork', title: '', medium: '', year: '', dimensions: '', edition: '', notes: '', visibility: 'private' })).toEqual(['A title of 1 to 200 characters.']);
  for (const ok of ['1965', 'c. 1965', 'c.1965', '1960s', '1998-2001', '1998 - 2001']) expect(YEAR_RULE.test(ok)).toBe(true);
  for (const bad of ['65', '19650', 'circa 1965', '1965-66']) expect(YEAR_RULE.test(bad)).toBe(false);
});

it('lists the holder\'s works with the ledger line and no public sale', async () => {
  fixture.user.current = { id: 'u1' };
  fixture.rpc.mockResolvedValue({ data: { total: 2, by_type: { artwork: 1, publication: 1 }, as_of: '2026-11-08T22:00:00Z', assets: [
    { id: 'a1', asset_type: 'artwork', title: 'Danger End of Road', visibility: 'private', created_at: '2026-11-08T21:00:00Z', declared: { medium: 'oil', year: 'c. 2024' }, identity_basis: 'holder_declaration', presentations: 0, public_sale_recorded: false },
    { id: 'a2', asset_type: 'publication', title: 'Snapshots', visibility: 'private', created_at: '2026-11-08T20:00:00Z', declared: {}, identity_basis: 'holder_declaration', presentations: 0, public_sale_recorded: false },
  ] }, error: null });
  await act(async () => render('/assets/mine'));
  expect(fixture.rpc).toHaveBeenCalledWith('held_assets_read', { p_limit: 500 });
  expect(node.textContent).toContain('2 works declared: 1 artworks, 1 publications · 0 with a public sale recorded');
  expect(node.querySelectorAll('.ad-item').length).toBe(2);
  expect(node.querySelector('a[href="/assets/a1"]')).not.toBeNull();
  expect(node.textContent).toContain('no public sale recorded');
  expect(ledgerLine({ total: 0, by_type: {}, as_of: '', assets: [] })).toBe('0 works declared · 0 with a public sale recorded');
});
