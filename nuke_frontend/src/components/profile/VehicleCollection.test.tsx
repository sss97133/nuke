// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ garage: { vehicles: [] as any[], isLoading: false, error: null as string | null },
  rows: [{ id: 'title' }, { id: 'photo' }], publicRows: [{ vehicle_id: 'title', relationship: 'owner' }],
  fail: false, calls: [] as string[], auth: { user: { id: 'viewer' } as { id: string } | null, loading: false },
  dashboardIds: [] as (string | null)[],
  deferCards: false, resolveCards: null as null | (() => void) }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => fixture.auth }));
vi.mock('../../hooks/useVehiclesDashboard', async original => ({ ...await original<any>(), useVehiclesDashboard: (id: string | null) => {
  fixture.dashboardIds.push(id); return fixture.garage;
} }));
vi.mock('../vehicles/VehicleCardDense', () => ({ default: ({ vehicle }: any) => <a href={`/vehicle/${vehicle.id}`}>{vehicle.id}</a> }));
vi.mock('../../lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    fixture.calls.push(table); let rows = fixture.rows;
    const q: any = { select: () => q, in: (_key: string, ids: string[]) => { rows = rows.filter(row => ids.includes(row.id)); return q; },
      eq: () => q, order: () => q, limit: () => q,
      then: (fn: any) => {
        const response = { data: rows, error: fixture.fail ? { message: 'read failed' } : null };
        return (fixture.deferCards ? new Promise(resolve => { fixture.resolveCards = () => resolve(response); }) : Promise.resolve(response)).then(fn);
      } };
    return q;
  },
  rpc: (name: string) => {
    fixture.calls.push(name); let rows = fixture.publicRows;
    const q: any = { eq: (key: string, value: string) => { rows = rows.filter(row => (row as any)[key] === value); return q; },
      limit: () => q, then: (fn: any) => Promise.resolve({ data: rows, error: fixture.fail ? { message: 'read failed' } : null }).then(fn) };
    return q;
  },
} }));
import VehicleCollection from './VehicleCollection';
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  fixture.calls = []; fixture.fail = false;
  fixture.auth = { user: { id: 'user' }, loading: false }; fixture.dashboardIds = [];
  fixture.deferCards = false; fixture.resolveCards = null;
  fixture.garage = { vehicles: [{ id: 'title', relationship_type: 'OWNER' }, { id: 'photo', relationship_type: 'RELATIONSHIP REVIEW' }], isLoading: false, error: null };
  host = document.createElement('div'); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); });
const render = (own = true, user = 'user') => act(async () => root.render(<MemoryRouter><VehicleCollection userId={user} isOwnProfile={own} /></MemoryRouter>));
it('uses the qualified own-account projection and never the photo-backed permission union', async () => {
  await render();
  expect(host.querySelector('a[href="/vehicle/title"]')).not.toBeNull();
  expect(host.querySelector('a[href="/vehicle/photo"]')).toBeNull();
  expect(fixture.calls).toEqual(['vehicles']);
});
it('uses only qualified public reader rows for a visitor', async () => {
  await render(false);
  expect(fixture.calls).toEqual(['get_user_garage', 'vehicles']);
  expect(host.querySelector('a[href="/vehicle/photo"]')).toBeNull();
});
it('does not request authenticated collection evidence for the logged-out live profile', async () => {
  fixture.auth.user = null;
  await render(false, '01718395-bd19-47d3-b701-9867b653dd5b');
  expect(fixture.calls).toEqual([]);
  expect(fixture.dashboardIds.every(id => id === null)).toBe(true);
  expect(host.textContent).toContain('Sign in to view this collection.');
  expect(host.textContent).not.toContain('No public vehicles');
});
it('waits for auth resolution before requesting collection evidence', async () => {
  fixture.auth.loading = true;
  await render(false);
  expect(fixture.calls).toEqual([]);
  expect(host.textContent).toContain('Loading collection');
  expect(host.textContent).not.toContain('Sign in');
  fixture.auth.loading = false;
  await render(false);
  expect(fixture.calls).toEqual(['get_user_garage', 'vehicles']);
});
it('does not start an own-account dashboard while auth is unresolved or absent', async () => {
  fixture.auth.loading = true;
  await render();
  fixture.auth = { user: null, loading: false };
  await render();
  expect(fixture.calls).toEqual([]);
  expect(fixture.dashboardIds.every(id => id === null)).toBe(true);
});
it('withdraws rendered cards and ignores in-flight cards after logout', async () => {
  await render(false);
  expect(host.querySelector('a[href="/vehicle/title"]')).not.toBeNull();
  fixture.deferCards = true;
  await render(false, 'another-profile');
  const finishOldRead = fixture.resolveCards!;
  fixture.auth.user = null;
  await render(false, 'another-profile');
  await act(async () => finishOldRead());
  expect(host.querySelector('a')).toBeNull();
  expect(host.textContent).toContain('Sign in to view this collection.');
});
it('does not admit the previous signed-in viewer card response after an account switch', async () => {
  fixture.deferCards = true;
  await render(false);
  const finishOldRead = fixture.resolveCards!;
  fixture.auth.user = { id: 'next-viewer' };
  await render(false);
  const finishNewRead = fixture.resolveCards!;
  expect(fixture.calls).toEqual(['get_user_garage', 'vehicles', 'get_user_garage', 'vehicles']);
  await act(async () => finishOldRead());
  expect(host.querySelector('a')).toBeNull();
  await act(async () => finishNewRead());
  expect(host.querySelector('a[href="/vehicle/title"]')).not.toBeNull();
});
it('withholds the previous own-account dashboard while the parent profile catches up to an account switch', async () => {
  await render();
  fixture.auth.user = { id: 'next-viewer' };
  fixture.calls = []; fixture.dashboardIds = [];
  await render();
  expect(fixture.calls).toEqual([]);
  expect(fixture.dashboardIds.every(id => id === null)).toBe(true);
  expect(host.querySelector('a')).toBeNull();
  expect(host.textContent).toContain('Loading collection');
});
it('withdraws previously rendered ownership when its evidence read fails', async () => {
  await render(); fixture.garage = { ...fixture.garage, error: 'proof unavailable' };
  await render();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.querySelector('a[href="/vehicle/title"]')).toBeNull();
  expect(host.textContent).not.toContain('No vehicles yet');
});
it('withdraws an old owner result as soon as the new projection no longer supports it', async () => {
  await render(); fixture.garage = { ...fixture.garage, vehicles: [{ id: 'photo', relationship_type: 'RELATIONSHIP REVIEW' }] };
  await render();
  expect(host.querySelector('a[href="/vehicle/title"]')).toBeNull();
});

it('never renders a false empty collection between evidence loading and its detail read', async () => {
  const changes: string[] = [];
  const observer = new MutationObserver(records => {
    for (const record of records) {
      changes.push(record.oldValue ?? '', ...[...record.addedNodes, ...record.removedNodes].map(node => node.textContent ?? ''));
    }
  });
  observer.observe(host, { childList: true, subtree: true, characterData: true, characterDataOldValue: true });
  try {
    fixture.garage = { ...fixture.garage, isLoading: true };
    await render();
    fixture.garage = { ...fixture.garage, isLoading: false };
    await render();
    expect(changes.some(text => text.includes('No vehicles yet'))).toBe(false);
    expect(host.querySelector('a[href="/vehicle/title"]')).not.toBeNull();
  } finally { observer.disconnect(); }
});
