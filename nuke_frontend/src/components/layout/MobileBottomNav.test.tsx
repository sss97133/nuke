// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  count: 0 as unknown,
  rpc: vi.fn(),
  from: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: fixture.user } }) },
    rpc: (...args: unknown[]) => fixture.rpc(...args),
    from: (...args: unknown[]) => fixture.from(...args),
  },
}));
import { MobileBottomNav } from './MobileBottomNav';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  fixture.user = { id: 'user-1' };
  fixture.count = 0;
  fixture.rpc.mockImplementation(async () => ({ data: fixture.count, error: null }));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const mount = async (path = '/') => {
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><MobileBottomNav /></MemoryRouter>));
};
const badge = () => host.querySelector('a[aria-label="Inbox"] span')?.textContent ?? null;

it('reads the capped inbox count through the reader, not an exact count of vehicle_images', async () => {
  fixture.count = 7;
  await mount();
  expect(fixture.rpc).toHaveBeenCalledWith('my_unorganized_photo_count');
  expect(fixture.from).not.toHaveBeenCalled();
  expect(badge()).toBe('7');
});

it('prints 999+ when the reader stops at its cap of 1,000', async () => {
  fixture.count = 1000;
  await mount();
  expect(badge()).toBe('999+');
});

it('shows no badge for an empty inbox', async () => {
  fixture.count = 0;
  await mount();
  expect(fixture.rpc).toHaveBeenCalledTimes(1);
  expect(badge()).toBeNull();
});

it('shows no badge when the reading is not a number', async () => {
  fixture.count = null;
  await mount();
  expect(fixture.rpc).toHaveBeenCalledTimes(1);
  expect(badge()).toBeNull();
});

it('does not ask for a count when nobody is signed in', async () => {
  fixture.user = null;
  await mount();
  expect(fixture.rpc).not.toHaveBeenCalled();
  expect(badge()).toBeNull();
});
