export const DROPBOX_OAUTH_STATE_KEY = 'dropbox_oauth_state';

export interface PendingDropboxAuthorization {
  state: string;
  returnPath: string;
}

// Only the registered dealer importer may receive this continuation. Never accept
// an arbitrary return URL from the callback or browser storage.
export function validDropboxImportPath(value: string | null): string | null {
  return value && value === value.trim() && /^\/dealer\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/dropbox-import$/i.test(value)
    ? value
    : null;
}

export function readPendingDropboxAuthorization(value: string | null): PendingDropboxAuthorization | null {
  try {
    const pending: unknown = JSON.parse(value ?? 'null');
    if (!pending || typeof pending !== 'object' || !('state' in pending) || !('returnPath' in pending)) return null;
    if (typeof pending.state !== 'string' || !pending.state || typeof pending.returnPath !== 'string') return null;
    const returnPath = validDropboxImportPath(pending.returnPath);
    return returnPath ? { state: pending.state, returnPath } : null;
  } catch {
    return null;
  }
}
