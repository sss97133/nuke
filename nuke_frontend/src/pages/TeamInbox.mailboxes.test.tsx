// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const fixture = vi.hoisted(() => ({
  user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
  rows: [{ to_address: 'support@example.invalid', total: 4, unread: 1 }],
  refuseCounts: false,
  refresh: null as null | (() => void),
  reads: [] as { table: string; filters: [string, unknown][] }[],
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: fixture.user, loading: false }) }));
vi.mock('../lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    const filters: [string, unknown][] = [];
    const query = {
      select: () => query, order: () => query, limit: () => query,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      not: () => query, or: () => query, is: () => query,
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
        fixture.reads.push({ table, filters });
        return Promise.resolve(table === 'v_inbox_summary'
          ? { data: fixture.refuseCounts ? null : fixture.rows, error: fixture.refuseCounts ? { code: '42501' } : null }
          : { data: [], error: null, count: 0 }).then(resolve, reject);
      },
    };
    return query;
  },
  channel: () => {
    const channel = { on: (_event: unknown, _filter: unknown, callback: () => void) => { fixture.refresh = callback; return channel; }, subscribe: () => channel };
    return channel;
  },
  removeChannel: () => Promise.resolve('ok'),
} }));

import TeamInbox from './TeamInbox';

let host: HTMLDivElement, root: Root;
const mount = () => act(async () => root.render(<MemoryRouter><TeamInbox /></MemoryRouter>));
const mailbox = (unread: number, total: number) => host.querySelector<HTMLButtonElement>(`button[aria-label="support@example.invalid: ${unread} unread, ${total} total"]`)!;
const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent === text)!;

describe('visible inbox mailbox controls', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    fixture.rows = [{ to_address: 'support@example.invalid', total: 4, unread: 1 }];
    fixture.refuseCounts = false; fixture.refresh = null; fixture.reads = [];
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

  it('shows recorded counts and filters through the existing mailbox query', async () => {
    await mount();
    expect(host.querySelector('[role="group"][aria-label="Mailbox totals"]')).not.toBeNull();
    expect(mailbox(1, 4).textContent).toContain('1 unread · 4 total');
    await act(async () => mailbox(1, 4).click());
    expect(fixture.reads.some(r => r.table === 'contact_inbox' && r.filters.some(([key, value]) => key === 'to_address' && value === 'support@example.invalid'))).toBe(true);
    expect(mailbox(1, 4).getAttribute('aria-pressed')).toBe('true');
    await act(async () => button('All mailboxes').click());
    expect(button('All mailboxes').getAttribute('aria-pressed')).toBe('true');
  });

  it('labels a failed refresh, keeps prior counts and retries successfully', async () => {
    await mount();
    expect(mailbox(1, 4)).not.toBeNull();
    fixture.refuseCounts = true;
    await act(async () => { fixture.refresh?.(); });
    expect(host.querySelector('[role="status"]')?.textContent).toContain('last loaded totals are shown');
    expect(mailbox(1, 4)).not.toBeNull();
    fixture.refuseCounts = false;
    fixture.rows = [{ to_address: 'support@example.invalid', total: 6, unread: 3 }];
    await act(async () => button('Retry counts').click());
    expect(mailbox(3, 6)).not.toBeNull();
    expect(host.querySelector('[role="status"]')).toBeNull();
  });
});
