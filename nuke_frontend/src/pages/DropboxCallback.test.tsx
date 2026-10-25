// @vitest-environment jsdom
import React, { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DROPBOX_OAUTH_STATE_KEY } from '../services/dropboxOAuth';

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
import DropboxCallback from './DropboxCallback';

const importPath = '/dealer/11111111-1111-4111-8111-111111111111/dropbox-import';
const token = 'test-token';
let host: HTMLDivElement, root: Root;
let writes: ReturnType<typeof vi.spyOn>;
let logs: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  // Node 25 exposes host web storage to the worker; use isolated browser storage.
  const saved = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    clear: () => saved.clear(), getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value), removeItem: (key: string) => saved.delete(key),
  });
  localStorage.setItem(DROPBOX_OAUTH_STATE_KEY, JSON.stringify({ state: 'synthetic-pending-state', returnPath: importPath }));
  window.history.replaceState({}, '', '/dropbox-callback');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  writes = vi.spyOn(localStorage, 'setItem');
  logs = ['log', 'warn', 'error'].map(method => vi.spyOn(console, method as 'log').mockImplementation(() => {}));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  vi.restoreAllMocks(); vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mount(params: Record<string, string | null> = {}, strict = false) {
  const fragment = new URLSearchParams({ access_token: token, token_type: 'bearer', state: 'synthetic-pending-state', expires_in: '14400' });
  for (const [key, value] of Object.entries(params)) {
    if (value === null) fragment.delete(key);
    else fragment.set(key, value);
  }
  window.history.replaceState({}, '', '/dropbox-callback#' + fragment);
  writes.mockClear();
  await act(async () => root.render(strict ? <StrictMode><DropboxCallback /></StrictMode> : <DropboxCallback />));
}
const continueButton = () => Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Start Dropbox import');
function expectRejected() {
  expect(host.textContent).toContain('Connection Failed');
  expect(continueButton()).toBeUndefined();
  expect(writes).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
  expect(window.location.hash).toBe('');
  for (const log of logs) expect(log).not.toHaveBeenCalled();
}

it.each(['missing-returned', 'missing-saved', 'both-missing', 'empty-returned', 'empty-saved', 'mismatched'])('rejects %s state before storing anything', async scenario => {
  // An invalid callback must not replace an already connected account either.
  localStorage.setItem('dropbox_access_token', 'synthetic-existing-token');
  if (scenario.includes('saved') || scenario === 'both-missing') localStorage.removeItem(DROPBOX_OAUTH_STATE_KEY);
  if (scenario === 'empty-saved') localStorage.setItem(DROPBOX_OAUTH_STATE_KEY, JSON.stringify({ state: '', returnPath: importPath }));
  const returned = scenario === 'mismatched' ? 'other-state' : scenario === 'missing-returned' || scenario === 'both-missing' ? null : scenario === 'empty-returned' ? '' : 'synthetic-pending-state';
  await mount({ state: returned });
  expectRejected();
  expect(localStorage.getItem('dropbox_access_token')).toBe('synthetic-existing-token');
});

it.each([null, 'https://example.com/', '//example.com/', '/dropbox-import', '/dealer/not-an-id/dropbox-import', importPath + '?redirect=https://example.com', importPath + '\n'])('rejects absent or unsafe organization context: %s', async path => {
  localStorage.setItem(DROPBOX_OAUTH_STATE_KEY, JSON.stringify({ state: 'synthetic-pending-state', returnPath: path }));
  await mount();
  expectRejected();
});

it.each(['synthetic-pending-state', '{broken', 'null', '[]'])('rejects legacy or malformed pending authorization: %s', async pending => {
  localStorage.setItem(DROPBOX_OAUTH_STATE_KEY, pending);
  await mount();
  expectRejected();
});

it('does not pair an older callback with another tab’s newer organization', async () => {
  localStorage.setItem(DROPBOX_OAUTH_STATE_KEY, JSON.stringify({
    state: 'synthetic-newer-state', returnPath: importPath.replace('11111111-', '22222222-'),
  }));
  await mount();
  expectRejected();
});

it('does not reflect or log provider error details, store a token, or continue', async () => {
  await mount({ error: 'access_denied synthetic-sensitive-detail' });
  expectRejected();
  expect(host.textContent).not.toContain('synthetic-sensitive-detail');
});

it('rejects a missing token before changing storage', async () => {
  await mount({ access_token: '' });
  expectRejected();
});

it.each(['invalid', '-1', '0', '1.5', '9999999999999999'])('rejects invalid expiration %s without partial token storage', async expires_in => {
  await mount({ expires_in });
  expectRejected();
});

it('connects once under StrictMode, clears credentials from the URL, and waits for an explicit import action', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-25T10:00:00Z'));
  await mount({}, true);
  expect(host.textContent).toContain('Successfully Connected!');
  expect(host.textContent).toContain('scans');
  expect(host.textContent).toContain('syncs missing vehicle images');
  expect(localStorage.getItem('dropbox_access_token')).toBe(token);
  expect(localStorage.getItem('dropbox_token_type')).toBe('bearer');
  expect(localStorage.getItem('dropbox_token_expires')).toBe(String(Date.now() + 14400 * 1000));
  expect(writes.mock.calls.filter(([key]) => key === 'dropbox_access_token')).toHaveLength(1);
  expect(localStorage.getItem(DROPBOX_OAUTH_STATE_KEY)).toBeNull();
  expect(window.location.hash).toBe('');
  await act(async () => vi.advanceTimersByTime(10000));
  expect(navigate).not.toHaveBeenCalled();
  await act(async () => continueButton()!.click());
  expect(navigate).toHaveBeenCalledExactlyOnceWith(importPath);
  for (const log of logs) expect(log).not.toHaveBeenCalled();
});

it('rejects replay of a consumed callback without replacing the stored token', async () => {
  await mount();
  await act(async () => root.unmount());
  root = createRoot(host);
  await mount({ access_token: 'test-replay' });
  expectRejected();
  expect(localStorage.getItem('dropbox_access_token')).toBe(token);
});

it('clears the previous token expiration when Dropbox omits expiration', async () => {
  localStorage.setItem('dropbox_token_expires', '123');
  await mount({ expires_in: null, token_type: null });
  expect(localStorage.getItem('dropbox_token_expires')).toBeNull();
  expect(localStorage.getItem('dropbox_token_type')).toBe('bearer');
  expect(continueButton()).toBeDefined();
  expect(navigate).not.toHaveBeenCalled();
});

it('offers a registered home route after failure, without starting an import', async () => {
  await mount({ state: 'wrong' });
  await act(async () => host.querySelector('button')!.click());
  expect(navigate).toHaveBeenCalledExactlyOnceWith('/');
});

it.each(['changed', 'removed'])('does not start an import if the verified token was %s in another tab', async change => {
  await mount();
  if (change === 'changed') localStorage.setItem('dropbox_access_token', 'synthetic-other-account-token');
  else localStorage.removeItem('dropbox_access_token');
  writes.mockClear();
  await act(async () => continueButton()!.click());
  expectRejected();
  expect(host.textContent).toContain('The Dropbox connection changed');
});
