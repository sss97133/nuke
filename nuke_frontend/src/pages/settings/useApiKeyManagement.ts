import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabaseFunctionsUrl } from '../../lib/supabase';

export interface ManagedKey {
  id: string; name: string; key_prefix: string; scopes: string[]; is_active: boolean;
  rate_limit_per_hour: number; rate_limit_remaining: number;
  last_used_at: string | null; expires_at: string | null; created_at: string;
}
export interface CreatedKey extends Pick<ManagedKey, 'id' | 'name' | 'key_prefix' | 'scopes' | 'expires_at' | 'created_at'> { key: string }
type KeyRequest = { name: string; expires_in_days: number | null; scopes?: string[] };

/** Shared existing api-keys-manage client; no key values are retained outside the mounted page. */
export function useApiKeyManagement(userId: string, token: string | undefined) {
  const currentToken = useRef(token); currentToken.current = token;
  const mounted = useRef(true);
  const requestId = useRef(0);
  const readController = useRef<AbortController | null>(null);
  const mutation = useRef<string | null>(null);
  const [keys, setKeys] = useState<ManagedKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [pending, setPending] = useState<string | null>(null);

  const request = useCallback(async (method: string, path = '', body?: KeyRequest, signal?: AbortSignal) => {
    if (!currentToken.current) throw new Error('Sign in again to manage access keys.');
    const response = await fetch(`${getSupabaseFunctionsUrl()}/api-keys-manage${path}`, {
      method, signal,
      headers: { Authorization: `Bearer ${currentToken.current}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok || !result || result.error) throw new Error('The access-key request was not accepted.');
    return result;
  }, []);

  const loadKeys = useCallback(async () => {
    readController.current?.abort();
    const controller = new AbortController(); readController.current = controller;
    const id = ++requestId.current;
    const deadline = setTimeout(() => controller.abort(), 15_000);
    setLoading(true); setReadError('');
    try {
      const result = await request('GET', '', undefined, controller.signal);
      if (!Array.isArray(result.data) || !result.data.every((key: ManagedKey) => key && typeof key.id === 'string' && typeof key.name === 'string' && typeof key.key_prefix === 'string' && typeof key.is_active === 'boolean' && (key.scopes == null || Array.isArray(key.scopes) && key.scopes.every(scope => typeof scope === 'string')))) {
        throw new Error('Invalid key list');
      }
      if (mounted.current && id === requestId.current) setKeys(result.data.map((key: ManagedKey) => ({ ...key, scopes: key.scopes ?? [] })));
    } catch {
      if (mounted.current && id === requestId.current) setReadError('Your access keys could not be read. The list below may be out of date.');
    } finally {
      clearTimeout(deadline);
      if (mounted.current && id === requestId.current) setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    mounted.current = true;
    void loadKeys();
    return () => { mounted.current = false; readController.current?.abort(); };
  }, [userId, loadKeys]);

  const createKey = async (body: KeyRequest): Promise<CreatedKey | null> => {
    if (mutation.current || !mounted.current) return null;
    mutation.current = 'create'; setPending('create'); setActionError('');
    try {
      const result = await request('POST', '', body);
      if (!result.data || typeof result.data.id !== 'string' || typeof result.data.name !== 'string' || typeof result.data.key !== 'string' || !result.data.key || !Array.isArray(result.data.scopes) || !result.data.scopes.every((scope: unknown) => typeof scope === 'string')) throw new Error('Unconfirmed key');
      if (!mounted.current) return null;
      void loadKeys();
      return result.data;
    } catch {
      if (mounted.current) setActionError('Key creation could not be confirmed. Refresh the key list before trying again.');
      return null;
    } finally {
      mutation.current = null;
      if (mounted.current) setPending(null);
    }
  };

  const revokeKey = async (keyId: string) => {
    if (mutation.current || !mounted.current) return;
    mutation.current = keyId; setPending(keyId); setActionError('');
    try {
      const result = await request('DELETE', `/${encodeURIComponent(keyId)}`);
      if (result.message !== 'API key revoked') throw new Error('Unconfirmed revocation');
      if (!mounted.current) return;
      // Preserve the known list if its subsequent refresh fails.
      setKeys(current => current.map(key => key.id === keyId ? { ...key, is_active: false } : key));
      void loadKeys();
    } catch {
      if (mounted.current) setActionError('The key could not be revoked. Its access has not been confirmed as removed.');
    } finally {
      mutation.current = null;
      if (mounted.current) setPending(null);
    }
  };

  return { keys, loading, readError, actionError, pending, loadKeys, createKey, revokeKey };
}
