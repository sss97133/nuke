import React from 'react';
import { renderToString } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
import UserMoneyFlow, { computeMoneyFlow, type PaymentEventRow } from './UserMoneyFlow';
const payment = (overrides: Partial<PaymentEventRow>): PaymentEventRow => ({ id: 'fixture', direction: 'in', amount_usd: 10, paid_at: '2026-01-01T00:00:00Z', counterparty_name: null, ...overrides });
it('withholds cash flow from visitors', () => {
  expect(renderToString(<UserMoneyFlow userId="owner" isOwnProfile={false} />)).toBe('');
});
it('does not treat unknown directions or unknown/invalid amounts as income', () => {
  const flow = computeMoneyFlow([
    payment({ direction: 'unknown', amount_usd: 100 }), payment({ amount_usd: null }),
    payment({ amount_usd: '' }), payment({ amount_usd: 'Infinity' }), payment({ amount_usd: -3 }),
    payment({ amount_usd: 0 }), payment({ direction: 'out', amount_usd: 4 }), payment({}),
  ]);
  expect(flow.inTotal).toBe(10); expect(flow.outTotal).toBe(4); expect(flow.excluded).toBe(5);
});
it('retains valid undated cash flow without inventing a year and uses UTC for recorded years', () => {
  const flow = computeMoneyFlow([payment({ paid_at: null }), payment({ paid_at: 'not-a-date', direction: 'out', amount_usd: 3 }), payment({ paid_at: '2025-12-31T23:30:00-02:00' })]);
  expect(flow.inTotal).toBe(20); expect(flow.outTotal).toBe(3); expect(flow.undated).toBe(2);
  expect(flow.years).toEqual([{ year: 2026, inTotal: 10, outTotal: 0 }]);
});
