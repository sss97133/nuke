// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  links: [] as any[],
  updated: [] as any[],
  writes: [] as any[][],
}));
// A chainable stand-in: reads resolve to the table's rows; update and insert are recorded with their filters.
vi.mock('../../lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    const rows = table === 'organization_vehicles' ? fixture.links
      : table === 'businesses' ? [{ id: 'org-1', business_name: 'Test Shop' }] : [];
    let result: any = { data: rows, error: null };
    const q: any = { then: (fn: any) => Promise.resolve(result).then(fn) };
    for (const m of ['select', 'order']) q[m] = () => q;
    q.eq = (key: string, value: any) => { fixture.writes.at(-1)?.push(['eq', key, value]); return q; };
    q.update = (payload: any) => { fixture.writes.push(['update', table, payload]); result = { data: fixture.updated, error: null }; return q; };
    q.insert = (payload: any) => { fixture.writes.push(['insert', table, payload]); result = { data: { id: 'new' }, error: null }; return q; };
    q.single = () => q;
    return q;
  },
} }));

import AddOrganizationRelationship from './AddOrganizationRelationship';

const onSuccess = vi.fn();
const onClose = vi.fn();
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  fixture.links = [];
  fixture.updated = [{ id: 'link-1' }];
  fixture.writes = [];
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); }); };
const open = async () => {
  await act(async () => root.render(
    <AddOrganizationRelationship vehicleId="car" vehicleName="1977 Test" userId="owner" onSuccess={onSuccess} onClose={onClose} />,
  ));
  await flush();
  const select = host.querySelector('select')!;
  await act(async () => { select.value = 'org-1'; select.dispatchEvent(new Event('change', { bubbles: true })); });
};
const saveButton = () => [...host.querySelectorAll('button')].at(-1)!;
const save = async () => { await act(async () => { saveButton().click(); }); await flush(); };
const pending = (changes: Record<string, unknown> = {}) => ({
  id: 'link-1', organization_id: 'org-1', relationship_type: 'service_provider', status: 'pending', user_rejected: false, ...changes,
});

it('confirms a pending link in place instead of inserting a duplicate', async () => {
  fixture.links = [pending()];
  await open();
  expect(saveButton().textContent).toBe('Confirm Relationship');
  await save();
  expect(fixture.writes).toHaveLength(1);
  const [op, table, payload, filter] = fixture.writes[0];
  expect([op, table, filter]).toEqual(['update', 'organization_vehicles', ['eq', 'id', 'link-1']]);
  expect(payload).toMatchObject({ status: 'active', user_rejected: false, user_confirmed: true, user_confirmed_by: 'owner' });
  expect(payload).not.toHaveProperty('notes');
  expect(onSuccess).toHaveBeenCalledTimes(1);
});

it('reactivates a link the owner rejected earlier', async () => {
  fixture.links = [pending({ user_rejected: true })];
  await open();
  await save();
  expect(fixture.writes[0][0]).toBe('update');
  expect(fixture.writes[0][2]).toMatchObject({ status: 'active', user_rejected: false, user_confirmed: true });
});

it('says who may confirm when RLS leaves the row unchanged', async () => {
  fixture.links = [pending()];
  fixture.updated = [];
  await open();
  await save();
  expect(host.textContent).toContain('Only the person who linked it, the vehicle owner or a manager of the organization can confirm it.');
  expect(onSuccess).not.toHaveBeenCalled();
});

it('still blocks an active duplicate and inserts a new link', async () => {
  fixture.links = [pending({ status: 'active' })];
  await open();
  expect(saveButton().disabled).toBe(true);
  expect(host.textContent).toContain('This relationship already exists.');

  await act(async () => root.unmount());
  root = createRoot(host);
  fixture.links = [];
  await open();
  await save();
  expect(fixture.writes[0].slice(0, 2)).toEqual(['insert', 'organization_vehicles']);
  expect(fixture.writes[0][2]).toMatchObject({ organization_id: 'org-1', vehicle_id: 'car', status: 'active', auto_tagged: false });
});
