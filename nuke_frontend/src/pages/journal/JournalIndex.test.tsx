// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ vehicles: [] as any[], inIds: [] as string[] }));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        in: async (_col: string, ids: string[]) => { fixture.inIds = ids; return { data: fixture.vehicles.filter((v) => ids.includes(v.id)), error: null }; },
      }),
    }),
  },
}));
import JournalIndex from './JournalIndex';

const ROWS = [
  { date: '2026-10-14', photo_count: 0, receipt_count: 0, payment_count: 0, top_vehicle_id: null },
  { date: '2026-09-24', photo_count: 4, receipt_count: 0, payment_count: 0, top_vehicle_id: 'a90c008a-0000-0000-0000-000000000001' },
  { date: '2026-09-22', photo_count: 1, receipt_count: 1, payment_count: 0, top_vehicle_id: 'bbbbbbbb-0000-0000-0000-000000000002' },
  { date: '2026-09-20', photo_count: 0, receipt_count: 0, payment_count: 0, top_vehicle_id: null },
];

describe('JournalIndex', () => {
  let root: Root, container: HTMLDivElement;
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    fixture.vehicles = [{ id: 'a90c008a-0000-0000-0000-000000000001', year: 1977, make: 'Chevrolet', model: 'Blazer' }];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ rows: ROWS }), { status: 200 })));
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

  async function render() {
    await act(async () => { root.render(<MemoryRouter><JournalIndex /></MemoryRouter>); });
    for (let i = 0; i < 20 && !container.textContent?.includes('Blazer'); i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }

  it('lists only the days that hold a record', async () => {
    await render();
    const days = [...container.querySelectorAll('a[href^="/journal/"]')].map((a) => a.textContent);
    expect(days).toEqual(['2026-09-24', '2026-09-22']);
    expect(container.textContent).not.toContain('2026-10-14');
  });

  it('names and links the day’s vehicle when it is public, and leaves a private one unnamed', async () => {
    await render();
    const link = container.querySelector('a[href="/vehicle/a90c008a-0000-0000-0000-000000000001"]');
    expect(link?.textContent).toBe('1977 Chevrolet Blazer');
    expect(container.querySelector('a[href="/vehicle/bbbbbbbb-0000-0000-0000-000000000002"]')).toBeNull();
    expect(container.textContent).not.toContain('bbbbbbbb');
    expect(fixture.inIds.sort()).toEqual(['a90c008a-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002']);
  });

  it('says so once when no day holds a record', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ rows: [ROWS[0], ROWS[3]] }), { status: 200 })));
    await act(async () => { root.render(<MemoryRouter><JournalIndex /></MemoryRouter>); });
    for (let i = 0; i < 20 && !container.textContent?.includes('NO PUBLIC'); i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(container.textContent).toContain('NO PUBLIC WORK-LOG ENTRIES IN THE LAST 90 DAYS.');
    expect(container.querySelectorAll('a[href^="/journal/"]').length).toBe(0);
  });
});
