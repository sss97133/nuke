// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ApiKeysPage from './ApiKeysPage';
import ConnectedAgentsPage from './ConnectedAgentsPage';

const auth = vi.hoisted(() => ({ user: { id: 'viewer-a' } as { id: string } | null, session: { access_token: 'synthetic-a' }, loading: false }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../../lib/supabase', () => ({ getSupabaseFunctionsUrl: () => 'https://fixture.invalid/functions' }));
vi.mock('../../components/PrefetchLink', () => ({ default: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));
const key = { id: 'synthetic-key', name: 'Garage reader', key_prefix: 'synthetic', scopes: ['read'], is_active: true, rate_limit_per_hour: 1000, rate_limit_remaining: 800, last_used_at: null, expires_at: null, created_at: '2026-10-01T00:00:00Z', requests_24h: 987654 };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fetchMock = vi.fn<typeof fetch>();
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.assign(auth, { user: { id: 'viewer-a' }, session: { access_token: 'synthetic-a' }, loading: false });
  fetchMock.mockReset(); fetchMock.mockImplementation(async () => response({ data: [key] })); vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('confirm', vi.fn(() => true));
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount(agent = false) { await act(async () => root.render(agent ? <ConnectedAgentsPage /> : <ApiKeysPage />)); }
async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === label);
  expect(button, label).toBeDefined(); await act(async () => button!.click());
}
async function fill(label: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  expect(input).not.toBeNull();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}

it.each([false, true])('keeps an HTTP list failure distinct from no keys and supports retry (agents=%s)', async agent => {
  fetchMock.mockResolvedValueOnce(response({ error: 'private backend details' }, 503));
  await mount(agent);
  expect(host.textContent).toContain('access keys could not be read');
  expect(host.textContent).not.toMatch(/No (API keys|agents connected)/);
  expect(host.textContent).not.toContain('private backend details');
  await click('Retry key list'); expect(host.textContent).toContain('Garage reader');
  expect(host.textContent).not.toContain('could not be read');
});
it('does not present user-wide traffic as per-key usage and keeps null last-use unknown', async () => {
  await mount(); expect(host.textContent).not.toContain('987654');
  expect(host.textContent).toContain('stored snapshot'); expect(host.textContent).toContain('No recorded use');
});
it.each([false, true])('keeps a key active and reports rejected revocation (agents=%s)', async agent => {
  await mount(agent); fetchMock.mockResolvedValueOnce(response({ error: 'private failure' }, 403));
  await click('Revoke'); expect(host.textContent).toContain('could not be revoked'); expect(host.textContent).toContain('Active');
  expect(fetchMock).toHaveBeenCalledTimes(2); expect(host.textContent).not.toContain('private failure');
});
it('does not accept an unrecognized successful revocation response', async () => {
  await mount(); fetchMock.mockResolvedValueOnce(response({})); await click('Revoke');
  expect(host.textContent).toContain('could not be revoked'); expect(host.textContent).toContain('Active');
});
it('keeps confirmed revoked state when the follow-up list is unavailable', async () => {
  await mount(); fetchMock.mockResolvedValueOnce(response({ message: 'API key revoked' })).mockResolvedValueOnce(response({ error: 'unavailable' }, 503));
  await click('Revoke'); expect(host.textContent).toContain('Revoked'); expect(host.textContent).toContain('could not be read');
});
it('waits for auth and avoids rereading on same-viewer token refresh', async () => {
  auth.loading = true; await mount(); expect(fetchMock).not.toHaveBeenCalled();
  auth.loading = false; await mount(); auth.session = { access_token: 'token-new' }; await mount(); expect(fetchMock).toHaveBeenCalledTimes(1);
  await click('Refresh keys'); expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({ Authorization: 'Bearer token-new' });
});
it('rejects a late old-viewer list and clears prior keys on identity change', async () => {
  let release: (value: Response) => void = () => {};
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })); await mount();
  auth.user = { id: 'viewer-b' }; auth.session = { access_token: 'synthetic-b' }; fetchMock.mockResolvedValueOnce(response({ data: [] })); await mount();
  await act(async () => release(response({ data: [key] }))); expect(host.textContent).not.toContain('Garage reader');
  expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
});
it('keeps the established agent scope and expiration and blocks duplicate issue requests', async () => {
  await mount(true); await click('+ Connect Agent'); await fill('Agent name', 'Synthetic helper'); await fill('Vehicle VIN', 'abc123');
  let release: (value: Response) => void = () => {};
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const issue = [...host.querySelectorAll('button')].find(button => button.textContent === 'Issue Key')!;
  await act(async () => { issue.click(); issue.click(); });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({ name: 'Synthetic helper', expires_in_days: 90, scopes: ['events:write:vehicle:ABC123'] });
  await act(async () => release(response({ data: { ...key, key: 'synthetic-secret' } })));
  expect(host.textContent).toContain('synthetic-secret');
  auth.user = { id: 'viewer-b' }; await mount(true); expect(host.textContent).not.toContain('synthetic-secret');
});
it('does not display data from a failed create response and keeps the draft', async () => {
  await mount(); await click('+ Create Key'); await fill('Key name', 'Synthetic test');
  fetchMock.mockResolvedValueOnce(response({ data: { ...key, key: 'must-not-display' } }, 500)); await click('Create Key');
  expect(host.textContent).toContain('creation could not be confirmed'); expect(host.textContent).not.toContain('must-not-display');
  expect(host.querySelector<HTMLInputElement>('[aria-label="Key name"]')?.value).toBe('Synthetic test');
});
it('does not surface a late created secret after the viewer changes', async () => {
  await mount(); await click('+ Create Key'); await fill('Key name', 'Synthetic test');
  let release: (value: Response) => void = () => {};
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })); await click('Create Key');
  auth.user = { id: 'viewer-b' }; auth.session = { access_token: 'synthetic-b' }; await mount();
  await act(async () => release(response({ data: { ...key, key: 'old-viewer-secret' } })));
  expect(host.textContent).not.toContain('old-viewer-secret'); expect(host.querySelector('dialog')).toBeNull();
});
it('treats a missing active flag as unreadable instead of claiming a key is revoked', async () => {
  fetchMock.mockResolvedValueOnce(response({ data: [{ ...key, is_active: undefined }] })); await mount();
  expect(host.textContent).toContain('could not be read'); expect(host.textContent).not.toContain('Revoked');
});
it('rejects a malformed creation scope without rendering it or its secret', async () => {
  await mount(true); await click('+ Connect Agent'); await fill('Agent name', 'Synthetic helper'); await fill('Vehicle VIN', 'abc123');
  fetchMock.mockResolvedValueOnce(response({ data: { ...key, key: 'must-not-display', scopes: [17] } })); await click('Issue Key');
  expect(host.textContent).toContain('creation could not be confirmed'); expect(host.textContent).not.toContain('must-not-display');
});
it('allows dismissing a pending issue request and retains its successful result for the same viewer', async () => {
  await mount(); await click('+ Create Key'); await fill('Key name', 'Synthetic test');
  expect(host.querySelector('dialog')?.textContent).toContain('legacy read and write');
  let release: (value: Response) => void = () => {};
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })); await click('Create Key'); await click('Cancel');
  expect(host.querySelector('dialog')).toBeNull(); expect(host.textContent).toContain('Creating the key');
  await act(async () => release(response({ data: { ...key, key: 'synthetic-delayed-key' } })));
  expect(host.textContent).toContain('synthetic-delayed-key');
});
