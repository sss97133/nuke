// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it } from 'vitest';
import DayCard from './DayCard';
import type { DailyReceipt, WorkSession } from './hooks/useBuildLog';

// Offline fixtures only; nothing here enters production.
const session: WorkSession = {
  date: '2025-01-24', title: 'Engine bay', work_type: 'heavy_work', image_count: 0, duration_minutes: 240,
  total_parts_cost: 0, has_receipts: true, work_description: 'Harness routing', status: 'completed',
};
function receipt(moneyMasked: boolean): DailyReceipt {
  const money = (n: number) => (moneyMasked ? (null as unknown as number) : n);
  return {
    receipt_date: '2025-01-24', vehicle: { id: 'offline-vehicle' }, work_session: null, photos: [], photo_count: 0,
    receipts: [{ id: 'r1', vendor_name: 'Offline Vendor', receipt_date: '2025-01-24', total: money(120.5), total_amount: money(120.5),
      items: [{ name: 'Bracket', quantity: 1, unit_price: money(120.5), total: money(120.5) }], order_number: 'X-1', payment_method: 'card' }],
    parts_count: 1, parts_total: money(120.5),
    component_events: [{ id: 'e1', event_type: 'installed', event_date: '2025-01-24', description: 'Bracket fitted', component_table: 'parts', cost_cents: money(12050), work_order_id: 'w1' } as any],
    line_items: [],
    summary: { has_photos: false, has_parts: true, has_events: true, has_session: false, activity_level: 'parts_only' },
    money_masked: moneyMasked,
  };
}

let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = (detail: DailyReceipt) => act(() => root.render(
  <MemoryRouter><DayCard session={session} detail={detail} isLoading={false} onExpand={() => {}} isPopup hideOpenFullLink /></MemoryRouter>,
));

it('shows masked amounts, never $0, when the reader masked money for this caller', () => {
  render(receipt(true));
  expect(host.textContent).toContain('Offline Vendor');
  expect(host.textContent).toContain('Bracket fitted');
  expect((host.textContent!.match(/\$•••/g) || []).length).toBe(3);
  expect(host.textContent).not.toMatch(/\$0\b/);
  expect(host.textContent).not.toContain('$120');
});

it('shows the amounts to a caller the reader did not mask', () => {
  render(receipt(false));
  expect(host.textContent).toContain('$121');
  expect(host.textContent).not.toContain('$•••');
});
