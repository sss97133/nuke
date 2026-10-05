// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ context: {} as any }));
vi.mock('./VehicleProfileContext', () => ({ useVehicleProfile: () => fixture.context }));
vi.mock('./hooks/useVehiclePriceFacts', () => ({
  useVehiclePriceFacts: () => ({ priceFacts: null, priceSettled: true }), priceKindLabel: () => null,
}));
vi.mock('../../lib/supabase', () => ({ supabase: {
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }),
} }));
import VehicleBriefing from './VehicleBriefing';

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.context = { vehicle: { id: 'offline-subject' }, vehicleIntelLoading: false, observationCount: 0 };
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

it('preserves the existing sold-context scope and unmatched-condition label', async () => {
  fixture.context.vehicleIntel = { recent_comps: [{ id: 'offline-sale', year: 1966, make: 'Ford', model: 'Mustang', sale_price: 20000 }],
    recent_comps_scope: { label: 'Registered source scope' } };
  await act(async () => root.render(<VehicleBriefing />));
  const button = host.querySelector('button');
  // A comps-only record stays behind the existing meaningful-intelligence guard.
  expect(button).toBeNull();
  fixture.context.observationCount = 1;
  await act(async () => root.render(<VehicleBriefing />));
  await act(async () => { host.querySelector('button')!.click(); });
  expect(host.textContent).toContain('RECENT SOLD RECORD');
  expect(host.textContent).toContain('Registered source scope');
  expect(host.textContent).toContain('Condition not matched');
});
