// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ vehicles: [] as any[], result: null as any, pending: false }));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        in: async (_col: string, ids: string[]) => ({ data: fixture.vehicles.filter((v) => ids.includes(v.id)), error: null }),
      }),
    }),
  },
}));
vi.mock('../../lib/mcp', () => ({ callTool: () => (fixture.pending ? new Promise(() => {}) : Promise.resolve(fixture.result)) }));
import JournalPage from './JournalPage';

const PUBLIC_ID = 'a90c008a-0000-0000-0000-000000000001';
const PRIVATE_ID = 'bbbbbbbb-0000-0000-0000-000000000002';

describe('JournalPage', () => {
  let root: Root, container: HTMLDivElement;
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    fixture.vehicles = [{ id: PUBLIC_ID, year: 1977, make: 'Chevrolet', model: 'Blazer' }];
    fixture.result = {
      confidence: 0.76, observation_count: 7, projection_event_id: '3fb4d983-0000-0000-0000-000000000009',
      work_log: {
        date: '2026-09-24', vehicle_id: null, audience: 'public', work_orders: [], receipts: [],
        summary: { photo_count: 3, work_order_count: 0, labor_lines: 0, parts_lines: 0, payment_count: 0 },
        photos: [
          { id: 'p1', url: 'https://example.test/1.jpg', angle: 'front', vehicle_id: PUBLIC_ID, taken_at: null },
          { id: 'p2', url: 'https://example.test/2.jpg', angle: 'rear', vehicle_id: PRIVATE_ID, taken_at: null },
          { id: 'p3', url: 'https://example.test/3.jpg', angle: null, vehicle_id: null, taken_at: null },
        ],
      },
    };
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); fixture.pending = false; vi.unstubAllGlobals(); });

  async function render() {
    await act(async () => {
      root.render(<MemoryRouter initialEntries={['/journal/2026-09-24']}><Routes><Route path="/journal/:date" element={<JournalPage />} /></Routes></MemoryRouter>);
    });
    for (let i = 0; i < 20 && !container.textContent?.includes('Blazer'); i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }

  it('names a public vehicle and links it', async () => {
    await render();
    const link = container.querySelector(`a[href="/vehicle/${PUBLIC_ID}"]`);
    expect(link?.textContent).toBe('1977 Chevrolet Blazer');
  });

  it('shows no id fragments: a private vehicle is labelled, not linked', async () => {
    await render();
    expect(container.textContent).toContain('PRIVATE VEHICLE');
    expect(container.querySelector(`a[href="/vehicle/${PRIVATE_ID}"]`)).toBeNull();
    expect(container.textContent).not.toMatch(/a90c008a|bbbbbbbb|3fb4d983/i);
    expect(container.textContent).toContain('UNATTRIBUTED');
  });

  it('renders the public record from the fast read while the projection is still pending', async () => {
    fixture.pending = true;
    const fast = { date: '2026-09-24', audience: 'public', work_log: fixture.result.work_log };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(fast), { status: 200 })));
    await render();
    expect(container.querySelector(`a[href="/vehicle/${PUBLIC_ID}"]`)?.textContent).toBe('1977 Chevrolet Blazer');
    expect(container.textContent).not.toContain('LOADING');
  });
});
