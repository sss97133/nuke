// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ updates: [] as any[], failed: '' }));
vi.mock('../lib/supabase', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'fixture-user' } } }) },
  from(table: string) {
    let update: any;
    const q: any = {
      select() { return q; }, order() { return q; }, limit() { return q; },
      eq(field: string, value: string) { if (update) update.filters[field] = value; return q; },
      update(payload: any) { update = { table, payload, filters: {} }; fixture.updates.push(update); return q; },
      then(resolve: any) {
        return Promise.resolve({ data: update ? [] : [{ id: 'same-id', title: table, created_at: '2026-01-01', read: false, is_read: false, status: 'unread' }], error: fixture.failed === table ? { message: 'fixture reader failed' } : null }).then(resolve);
      },
    }; return q;
  },
} }));
import Notifications from './Notifications';
beforeEach(() => { fixture.updates = []; fixture.failed = ''; (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
it.each([
  ['user_notifications', 'is_read', true], ['notifications', 'read', true], ['duplicate_notifications', 'status', 'read'],
])('marks %s in its own origin with the signed-in user constraint', async (table, field, value) => {
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<Notifications />));
    const row = Array.from(host.querySelectorAll('.card')).find(el => el.querySelector('button') && el.textContent?.startsWith(table));
    await act(async () => row!.querySelector('button')!.click());
    expect(fixture.updates).toHaveLength(1);
    expect(fixture.updates[0]).toMatchObject({ table, payload: { [field]: value }, filters: { id: 'same-id', user_id: 'fixture-user' } });
  } finally { await act(async () => root.unmount()); }
});
it('reports an unavailable origin instead of claiming an empty notification set', async () => {
  fixture.failed = 'notifications';
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<Notifications />));
    expect(host.textContent).toContain('fixture reader failed');
    expect(host.textContent).not.toContain('No notifications.');
  } finally { await act(async () => root.unmount()); }
});
