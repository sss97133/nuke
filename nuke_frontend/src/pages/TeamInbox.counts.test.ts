import { beforeEach, describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({
  response: null as Response | null,
  fail: false,
  calls: [] as [RequestInfo | URL, RequestInit | undefined][],
}));
vi.mock('../lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  return {
    supabase: createClient('https://sdk-test.invalid', 'synthetic-anon-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: async (input, init) => {
          transport.calls.push([input, init]);
          if (transport.fail) throw new TypeError('synthetic network failure');
          if (!transport.response) throw new Error('missing synthetic response');
          return transport.response.clone();
        },
      },
    }),
  };
});
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));

import { supabase } from '../lib/supabase';
import { readInboxCounts } from './TeamInbox';

describe('inbox counts through the installed Supabase query builder', () => {
  beforeEach(() => { transport.response = null; transport.fail = false; transport.calls = []; });

  it('loads each mailbox count without calling catch on the then-only builder', async () => {
    const builder = supabase.from('v_inbox_summary').select('*');
    expect(typeof builder.then).toBe('function');
    expect((builder as unknown as { catch?: unknown }).catch).toBeUndefined();
    transport.response = new Response(JSON.stringify([
      { to_address: 'support@example.invalid', total: 4, unread: 1 },
      { to_address: 'info@example.invalid', total: 2, unread: 0 },
    ]), { status: 200, headers: { 'Content-Type': 'application/json' } });

    await expect(readInboxCounts()).resolves.toEqual({
      'support@example.invalid': { total: 4, unread: 1 },
      'info@example.invalid': { total: 2, unread: 0 },
    });
    const [input, init] = transport.calls[0];
    const url = new URL(String(input));
    expect(url.pathname).toBe('/rest/v1/v_inbox_summary');
    expect(url.searchParams.get('select')).toBe('*');
    expect(init?.method).toBe('GET');
  });

  it('returns an empty map for a successful empty inbox', async () => {
    transport.response = new Response('[]', { status: 200 });
    await expect(readInboxCounts()).resolves.toEqual({});
  });

  it('keeps a refused read distinct from a successful zero count', async () => {
    transport.response = new Response(JSON.stringify({ code: '42501', message: 'permission denied' }), { status: 403 });
    await expect(readInboxCounts()).resolves.toBeNull();
  });

  it('does not reject the refresh when transport fails', async () => {
    transport.fail = true;
    await expect(readInboxCounts()).resolves.toBeNull();
  });
});
