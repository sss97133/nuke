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
import HeldAssetsPage, { ledgerLine, proposalLine, reasonLine } from './HeldAssets';

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
  expect(node.textContent).toContain('2 held: 1 artworks, 1 publications · 0 with a public sale recorded');
  expect(node.querySelectorAll('.ad-item').length).toBe(2);
  expect(node.querySelector('a[href="/assets/a1"]')).not.toBeNull();
  expect(node.textContent).toContain('no public sale recorded');
  expect(ledgerLine({ total: 0, by_type: {}, as_of: '', assets: [] })).toBe('0 held · 0 with a public sale recorded');
});

it('shows works found in the photos with Open, Keep as documentation and Not a work, and dismisses through the writer', async () => {
  fixture.user.current = { id: 'u1' };
  const found = { total: 0, by_type: {}, as_of: '2026-11-09T01:00:00Z', assets: [], proposed_total: 2, proposed: [
    { id: '33333333-3333-4333-8333-333333333333', title: 'Proposed painting, Jul 2024', kind: 'painting', labels: ['Painting', 'Modern Art'], photos: 2, span_from: '2024-07-03T18:00:00Z', span_to: '2026-09-13T20:00:00Z', filenames: ['IMG_1.HEIC'], labeller: 'apple_photos_on_device_v1', proposed_at: '2026-11-09T00:50:00Z' },
    { id: '44444444-4444-4444-8444-444444444444', title: 'Proposed drawing, Mar 2020', kind: 'drawing', labels: ['Drawing'], photos: 21, span_from: '2020-03-09T14:52:00Z', span_to: '2021-06-17T10:39:00Z', filenames: null, labeller: 'apple_photos_on_device_v1', proposed_at: '2026-11-09T00:50:00Z' },
  ] };
  fixture.rpc.mockImplementation(async (fn: string) => fn === 'held_assets_read' ? { data: found, error: null } : { data: { asset_id: '44444444-4444-4444-8444-444444444444', duplicate: false }, error: null });
  await act(async () => render('/assets/mine'));
  expect(node.textContent).toContain('2 found in your photos, awaiting you');
  expect(node.textContent).toContain('Found in your photos');
  expect(node.querySelector('a[href="/assets/new?confirm=33333333-3333-4333-8333-333333333333"]')).not.toBeNull();
  expect(proposalLine(found.proposed[0])).toContain('painting · 2 photos · ');
  const notMine = Array.from(node.querySelectorAll('button.ad-verb'))[1] as HTMLButtonElement;
  await act(async () => notMine.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(fixture.rpc).toHaveBeenCalledWith('dismiss_held_asset', { p_asset_id: '44444444-4444-4444-8444-444444444444', p_reason: 'not a work' });
});

it('names a found work through confirm_held_asset when the form opens with ?confirm', async () => {
  fixture.user.current = { id: 'u1' };
  fixture.rpc.mockResolvedValue({ data: { asset_id: '33333333-3333-4333-8333-333333333333', duplicate: false, visibility: 'private' }, error: null });
  await act(async () => render('/assets/new?confirm=33333333-3333-4333-8333-333333333333'));
  expect(node.querySelector('h1')?.textContent).toBe('Keep a work found in your photos');
  expect(node.querySelector('select')).toBeNull();
  const inputs = node.querySelectorAll('input.jb-input');
  await act(async () => { type(inputs[0], 'Red Car'); });
  await act(async () => node.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(fixture.rpc).toHaveBeenCalledWith('confirm_held_asset', expect.objectContaining({ p_asset_id: '33333333-3333-4333-8333-333333333333', p_title: 'Red Car' }));
  expect(node.querySelector('h1')?.textContent).toBe('Profile');
});

it('a museum photo kept as documentation stays findable under Documented with no role claim (PR #3190 finding 1)', async () => {
  fixture.user.current = { id: 'u1' };
  const id = '55555555-5555-4555-8555-555555555555';
  let kept = false;
  fixture.rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
    if (fn === 'confirm_held_asset') { kept = true; return { data: { asset_id: id, duplicate: false, visibility: 'private' }, error: null }; }
    if (fn === 'held_assets_read') return { data: { total: 0, by_type: {}, as_of: '2026-11-09T01:00:00Z', assets: [], recorded: [], recorded_total: 0,
      documented_total: kept ? 1 : 0, documented: kept ? [{ id, asset_type: 'artwork', title: 'Water Lilies at the museum', visibility: 'private', created_at: '2026-11-09T00:00:00Z',
        declared: { notes: 'Seen at the museum.' }, identity_basis: 'photo_proposal', presentations: 0, photos: 3, public_sale_recorded: false,
        standing: 'documented', reasons: [], my_roles: [], legacy_compound: false, documentation_records: 1 }] : [],
      proposed_total: kept ? 0 : 1, proposed: kept ? [] : [{ id, title: 'Proposed painting', kind: 'painting', labels: ['Painting'], photos: 3, span_from: '2025-05-01T12:00:00Z', span_to: '2025-05-01T12:00:00Z', filenames: null, labeller: 'apple_photos_on_device_v1', proposed_at: '2026-11-08T00:00:00Z' }] }, error: null };
    return { data: null, error: { message: `unexpected ${fn} ${JSON.stringify(args)}` } };
  });
  await act(async () => render(`/assets/new?confirm=${id}`));
  expect(node.textContent).toContain('it does not say you made it or hold it');
  expect(node.textContent).not.toMatch(/becomes yours|This is my work/);
  await act(async () => { type(node.querySelectorAll('input.jb-input')[0], 'Water Lilies at the museum'); });
  await act(async () => node.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(fixture.rpc).toHaveBeenCalledWith('confirm_held_asset', expect.objectContaining({ p_asset_id: id }));
  expect(fixture.rpc.mock.calls.map(c => c[0])).not.toContain('record_asset_role_claim');
  expect(node.querySelector('h1')?.textContent).toBe('Profile');
  await act(async () => root.unmount()); root = createRoot(node);
  await act(async () => render('/assets/mine'));
  expect(node.textContent).toContain('Documented from your photos');
  expect(node.textContent).toContain('1 documented from your photos');
  expect(node.querySelector(`a[href="/assets/${id}"]`)).not.toBeNull();
  expect(node.textContent).toContain('documentation · 3 photos');
  expect(node.textContent).not.toContain('Works you hold');
});

it('shows legacy and role-claim records under Other records with the reason each is there', async () => {
  fixture.user.current = { id: 'u1' };
  const legacy = { id: 'l1', asset_type: 'artwork', title: 'Old confirm', visibility: 'private', created_at: '2026-11-01T00:00:00Z', declared: null, identity_basis: 'photo_proposal', presentations: 0, public_sale_recorded: false,
    standing: 'recorded' as const, reasons: ['legacy_compound'], legacy_compound: true };
  const lapsed = { ...legacy, id: 'l2', title: 'Lapsed', reasons: ['holder:acceptance_lapsed', 'creator:stated_unverified'], legacy_compound: false };
  fixture.rpc.mockResolvedValue({ data: { total: 0, by_type: {}, as_of: '2026-11-09T01:00:00Z', assets: [], documented: [], documented_total: 0, recorded: [legacy, lapsed], recorded_total: 2 }, error: null });
  await act(async () => render('/assets/mine'));
  expect(node.textContent).toContain('2 other records');
  expect(node.textContent).toContain('earlier single confirmation: whether you hold it or made it is unresolved');
  expect(reasonLine(lapsed)).toBe('you said you hold it (was accepted; a record it cited was withdrawn or replaced) · you said you made it (stated, not verified)');
  expect((node.textContent ?? '').replace(/not verified/g, '')).not.toContain('verified');
});
