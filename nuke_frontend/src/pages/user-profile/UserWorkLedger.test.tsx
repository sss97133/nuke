// @vitest-environment jsdom
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ count: 1200, fields: [] as string[], ranges: [] as number[][] }));
vi.mock('../../lib/supabase', () => ({ supabase: { from: () => {
  const query: any = {
    select: (fields: string) => { fixture.fields.push(fields); return query; }, eq: () => query, order: () => query,
    range: async (first: number, last: number) => {
      fixture.ranges.push([first, last]);
      return { count: fixture.count, error: null, data: Array.from({ length: Math.max(0, Math.min(last + 1, fixture.count) - first) }, (_, i) => ({
        id: `fixture-${first + i}`, session_date: '2026-01-01', duration_minutes: 60, vehicle_id: 'fixture-car',
        title: 'Synthetic session', work_type: 'fixture', status: 'derived', finalized_at: null, owner_confirmed_at: null,
        technician_id: null, ...(fixture.fields.at(-1)?.includes('total_job_cost') ? { total_job_cost: 2 } : {}),
      })) };
    },
  }; return query;
} } }));
import UserWorkLedger from './UserWorkLedger';
let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.fields = []; fixture.ranges = []; fixture.count = 1200;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it('reads past the API row cap and distinguishes derived evidence from verified performed work', async () => {
  await act(async () => root.render(<UserWorkLedger userId="owner" isOwnProfile />));
  expect(fixture.ranges).toEqual([[0,499],[500,999],[1000,1499]]);
  expect(container.textContent).toContain('1200 of 1200 visible session records');
  expect(container.textContent).toContain('1200 derived or auto-inferred');
  expect(container.textContent).toContain('0 finalized');
  expect(container.textContent).toContain('does not establish hours personally performed');
});
it('public readers never request financial columns', async () => {
  fixture.count = 2;
  await act(async () => root.render(<UserWorkLedger userId="other" isOwnProfile={false} />));
  expect(fixture.fields.every(fields => !fields.includes('total_job_cost'))).toBe(true);
  expect(container.textContent).not.toContain('RECORDED COST');
});
