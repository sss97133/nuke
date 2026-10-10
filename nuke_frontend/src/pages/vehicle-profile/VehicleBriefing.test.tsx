// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ context: {} as any, condition: null as any, price: null as any }));
vi.mock('./VehicleProfileContext', () => ({ useVehicleProfile: () => fixture.context }));
vi.mock('./hooks/useVehiclePriceFacts', () => ({
  useVehiclePriceFacts: () => ({ priceFacts: fixture.price, priceSettled: true }), priceKindLabel: () => null,
}));
vi.mock('../../lib/supabase', () => ({ supabase: {
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: fixture.condition }) }) }) }),
} }));
import VehicleBriefing from './VehicleBriefing';

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.context = { vehicle: { id: 'offline-subject' }, vehicleIntelLoading: false, observationCount: 0 };
  fixture.condition = null; fixture.price = null;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function mount(ci: any) {
  fixture.context.vehicleIntel = { comment_intel: ci };
  await act(async () => root.render(<VehicleBriefing />));
}

it.each(['positive', 'negative', 'unknown'])('keeps %s a reported interpretation without an analyzed-denominator claim', async label => {
  await mount({ overall_sentiment: label, comment_count: 73 });
  expect(host.textContent).toContain(`Reported comment summary: ${label}`);
  expect(host.textContent).toContain('input sample, method and analysis time unavailable');
  expect(host.textContent).toContain('SUMMARY COUNT73 reported');
  expect(host.textContent).not.toContain('comments analyzed');
  expect(host.textContent).not.toContain('community sentiment is');
  expect(host.querySelector('[style*="vp-brg"], [style*="vp-danger"]')).toBeNull();
});

it.each([0, null, undefined])('keeps summary count %s distinct from absence', async count => {
  await mount({ overall_sentiment: 'unknown', comment_count: count });
  expect(host.textContent?.includes('SUMMARY COUNT0 reported')).toBe(count === 0);
  expect(host.textContent).not.toContain('null reported');
  expect(host.textContent).not.toContain('undefined reported');
});

it('does not let an unqualified positive label resolve a reported concern', async () => {
  await mount({ overall_sentiment: 'positive', community_concerns: [{ concern: 'Reported concern' }] });
  expect(host.textContent).toContain('Reported comment concern (source unverified): Reported concern');
  expect(host.textContent).not.toContain('community sentiment is');
  expect(host.querySelector('[style*="vp-danger"]')).toBeNull();
});

it('leaves the empty briefing absent', async () => {
  await mount(null); expect(host.textContent).toBe('');
});

it('shows valid sold context without requiring an unrelated headline or raw observation count', async () => {
  fixture.context.vehicleIntel = { recent_comps: [{ id: 'offline-sale', year: 1966, model: 'Mustang', sale_price: 20000, sale_date: '2026-09-01', mileage: 30000 }],
    recent_comps_scope: { label: 'Registered source scope' } };
  await act(async () => root.render(<VehicleBriefing />));
  expect(host.querySelector('.vp-sold-context')).not.toBeNull();
  expect(host.textContent).toContain('Registered source scope');
  expect(host.textContent).toContain('condition unmatched');
  expect(host.querySelector('a[href="/vehicle/offline-sale"]')).not.toBeNull();
});

it.each([10000, 25000, 50000])('preserves the stored range without interpreting price %s as a proved deal', async amount => {
  fixture.condition = { descriptor_summary: { as_is_band_usd: [20000, 30000], condition_class: 'Driver (reported rubric)' },
    observation_count: 79, computed_at: '2026-07-14T00:30:00Z' };
  fixture.price = { price_kind: 'sold', price_amount: amount, price_as_of: '2026-07-01' };
  await mount(null);
  expect(host.textContent).toContain('Stored appraisal range: $20k–$30k USD');
  expect(host.textContent).toContain('reported condition: Driver');
  expect(host.textContent).toContain('INPUT COUNT79 reported');
  expect(host.textContent).toContain('COMPUTED (UTC)Jul 14, 2026');
  expect(host.textContent).toContain('Input IDs, count meaning and calibration unavailable. Condition matching unverified.');
  expect(host.textContent).not.toMatch(/what the evidence proves|Evidence read:|BELOW|IN BAND|FRAMES|READ ON/);
  expect(host.querySelector('[style*="vp-brg"], [style*="vp-danger"]')).toBeNull();
});

it.each([0, null, undefined])('distinguishes reported input count %s from unavailable count semantics', async count => {
  fixture.condition = { descriptor_summary: { as_is_band_usd: [20000, 30000] }, observation_count: count, computed_at: null };
  await mount(null);
  expect(host.textContent).toContain(count === 0 ? 'INPUT COUNT0 reported' : 'INPUT COUNTUnknown');
  expect(host.textContent).toContain('COMPUTED (UTC)Unknown');
  expect(host.textContent).not.toContain('Invalid Date');
  expect(host.textContent).not.toContain('1970');
});

it('keeps a score-only record outside the appraisal range surface', async () => {
  fixture.condition = { descriptor_summary: {}, observation_count: 79, computed_at: '2026-07-14T00:30:00Z' };
  await mount(null);
  expect(host.textContent).toBe('');
});
