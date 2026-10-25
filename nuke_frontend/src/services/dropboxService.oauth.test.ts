// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DROPBOX_OAUTH_STATE_KEY, readPendingDropboxAuthorization } from './dropboxOAuth';

const sdk = vi.hoisted(() => ({
  usersGetCurrentAccount: vi.fn(), filesListFolder: vi.fn(), checkUser: vi.fn(),
}));
vi.mock('dropbox', () => ({ Dropbox: class {
  usersGetCurrentAccount = sdk.usersGetCurrentAccount;
  filesListFolder = sdk.filesListFolder;
  checkUser = sdk.checkUser;
} }));
import { DropboxService } from './dropboxService';

const importPath = '/dealer/11111111-1111-4111-8111-111111111111/dropbox-import';
beforeEach(() => {
  vi.clearAllMocks();
  // Match browser storage without Node 25's host-storage placeholder.
  const saved = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    clear: () => saved.clear(), getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value), removeItem: (key: string) => saved.delete(key),
  });
  vi.stubEnv('VITE_DROPBOX_CLIENT_ID', 'synthetic-client-id');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('binds a fresh cryptographic state to the originating organization without changing the provider contract or logging it', () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const random = vi.spyOn(crypto, 'getRandomValues');
  const service = new DropboxService({ clientId: 'synthetic-client-id' });
  const first = new URL(service.generateAuthUrl(importPath));
  expect(first.origin + first.pathname).toBe('https://www.dropbox.com/oauth2/authorize');
  expect(first.searchParams.get('client_id')).toBe('synthetic-client-id');
  expect(first.searchParams.get('response_type')).toBe('token');
  expect(first.searchParams.get('redirect_uri')).toBe(window.location.origin + '/dropbox-callback');
  expect(first.searchParams.get('scope')).toBe('files.metadata.read files.content.read account_info.read');
  expect(first.searchParams.get('force_reapproval')).toBe('true');
  const state = first.searchParams.get('state');
  expect(state).toMatch(/^[0-9a-f]{64}$/);
  expect(readPendingDropboxAuthorization(localStorage.getItem(DROPBOX_OAUTH_STATE_KEY))).toEqual({ state, returnPath: importPath });
  const otherPath = importPath.replace('11111111-', '22222222-');
  const second = new URL(service.generateAuthUrl(otherPath));
  expect(second.searchParams.get('state')).not.toBe(state);
  expect(readPendingDropboxAuthorization(localStorage.getItem(DROPBOX_OAUTH_STATE_KEY))).toEqual({ state: second.searchParams.get('state'), returnPath: otherPath });
  expect(random).toHaveBeenCalledTimes(2);
  expect(log).not.toHaveBeenCalled();
});

it('does not begin an authorization without a valid organization destination', () => {
  const service = new DropboxService({ clientId: 'synthetic-client-id' });
  const writes = vi.spyOn(localStorage, 'setItem');
  expect(() => service.generateAuthUrl('https://example.com')).toThrow('Open Dropbox import from your organization');
  expect(writes).not.toHaveBeenCalled();
});

it('updates the SDK and verifies account access without token/account diagnostics or a debug token probe', async () => {
  const logs = ['log', 'warn', 'error'].map(method => vi.spyOn(console, method as 'log').mockImplementation(() => {}));
  const config = { clientId: 'synthetic-client-id', accessToken: 'test-token' };
  DropboxService.refreshInstance(config);
  const service = DropboxService.getInstance(config);
  sdk.usersGetCurrentAccount.mockResolvedValue({ result: { name: { display_name: 'synthetic-private-name' } } });
  sdk.filesListFolder.mockResolvedValue({ result: { entries: [] } });
  expect(await service.listFolders('/')).toEqual([]);
  expect(sdk.usersGetCurrentAccount).toHaveBeenCalledOnce();
  expect(sdk.checkUser).not.toHaveBeenCalled();
  expect(sdk.filesListFolder).toHaveBeenCalledExactlyOnceWith({ path: '', recursive: false });
  for (const log of logs) expect(log).not.toHaveBeenCalled();
});
