// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ context: {} as any }));
vi.mock('./VehicleProfileContext', () => ({ useVehicleProfile: () => fixture.context }));
import VehicleIntelligencePanel from './VehicleIntelligencePanel';

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.context = { vehicle: {}, vehicleIntelLoading: false, vehicleIntel: null };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function mount(commentIntel?: any) {
  if (commentIntel) fixture.context.vehicleIntel = { comment_intel: commentIntel };
  await act(async () => root.render(<VehicleIntelligencePanel />));
}

it('qualifies stored interpretations without certifying experts, excerpts or market performance', async () => {
  await mount({ overall_sentiment: 'positive', comment_count: 73,
    key_quotes: [{ quote: 'Reported wording' }], expert_insights: ['Extracted observation'],
    community_concerns: [{ concern: 'Reported concern' }],
    market_signals: { demand: 'high', rarity: 'rare', price_trend: 'rising' } });
  expect(host.textContent).toContain('Comment summary');
  expect(host.textContent).toContain('REPORTED: positive');
  expect(host.textContent).toContain('73 COMMENTS REPORTED');
  expect(host.textContent).toContain('input sample, method and analysis time unavailable');
  expect(host.textContent).toContain('Market performance remains unverified');
  for (const label of ['REPORTED EXCERPTS', 'EXTRACTED INSIGHTS', 'REPORTED CONCERNS',
    'DEMAND LABEL: high', 'RARITY LABEL: rare', 'PRICE TREND LABEL: rising',
    'Reported wording', 'Extracted observation', 'Reported concern']) expect(host.textContent).toContain(label);
  for (const claim of ['Community Intelligence', 'EXPERT INSIGHTS', 'KEY QUOTES']) expect(host.textContent).not.toContain(claim);
  expect(host.querySelector('[style*="vp-brg"], [style*="vp-danger"]')).toBeNull();
});

it.each([0, null, undefined])('keeps reported count %s distinct from absent count', async count => {
  await mount({ overall_sentiment: 'unknown', comment_count: count });
  expect(host.textContent?.includes('0 COMMENTS REPORTED')).toBe(count === 0);
  expect(host.textContent).toContain('REPORTED: unknown');
  expect(host.textContent).not.toContain('null COMMENTS');
  expect(host.textContent).not.toContain('undefined COMMENTS');
});

it('keeps the qualification inside the keyboard-accessible summary', async () => {
  await mount({ overall_sentiment: 'negative' });
  const header = host.querySelector('[role="button"]')!;
  expect(header.getAttribute('tabindex')).toBe('0');
  await act(async () => { header.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  expect(host.textContent).not.toContain('Stored interpretation');
  expect(host.textContent).toContain('REPORTED: negative');
  await act(async () => { header.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); });
  expect(host.textContent).toContain('Stored interpretation');
});

it.each([null, { comment_intel: null }, { comment_intel: {} }])('leaves absent summary %j empty', async intel => {
  fixture.context.vehicleIntel = intel; await mount(); expect(host.textContent).toBe('');
});

it('does not render stale analysis while the existing reader loads', async () => {
  fixture.context.vehicleIntelLoading = true;
  await mount({ overall_sentiment: 'positive' }); expect(host.textContent).toBe('');
});

it('preserves the independent description section when no comment analysis exists', async () => {
  fixture.context.vehicleIntel = { description_intel: { condition_note: 'Attributed description' } };
  await mount();
  expect(host.textContent).toContain('Description extraction');
  expect(host.textContent).toContain('Attributed description');
  expect(host.textContent).not.toContain('Comment summary');
});

it('retains reported mileage uncertainty when the vehicle has a clean title', async () => {
  fixture.context.vehicle = { title_status: 'clean' };
  fixture.context.vehicleIntel = { description_intel: {
    condition_note: 'Odometer shows approximately 12,000 TMU.',
    red_flags: [{ f: 'True mileage unknown', sev: 'medium' }], title_status: 'clean',
  } };
  await mount();
  expect(host.textContent).toContain('Odometer shows approximately 12,000 TMU.');
  expect(host.textContent).toContain('True mileage unknown');
  expect(host.textContent).toContain('REPORTED FLAGS');
  expect(host.textContent).toContain('RECORDED TITLE: clean');
  expect(host.textContent).not.toContain('EXTRACTED TITLE: clean');
  expect(host.textContent).toContain('source sample, method and analysis time unavailable');
});

it('does not classify a conversion name as a resolved positive build finding', async () => {
  fixture.context.vehicleIntel = { description_intel: { red_flags: [{ f: '4x4 conversion reported', sev: 'medium' }] } };
  await mount();
  expect(host.textContent).toContain('4x4 conversion reported');
  expect(host.textContent).toContain('REPORTED FLAGS');
});

it('preserves contradictory title labels without silently resolving the extracted claim', async () => {
  fixture.context.vehicle = { title_status: 'clean' };
  fixture.context.vehicleIntel = { description_intel: { title_status: 'salvage', matching_numbers: false } };
  await mount();
  expect(host.textContent).toContain('RECORDED TITLE: clean');
  expect(host.textContent).toContain('EXTRACTED TITLE: salvage');
  expect(host.textContent).toContain('Title values differ · resolution unverified');
  expect(host.textContent).toContain('REPORTED NON-MATCHING');
  expect(host.querySelector('[style*="vp-danger"], [style*="vp-brg"]')).toBeNull();
});

it.each([0, [{ previous_owner: 'offline owner record' }], { notes: 'offline title extraction' }])(
  'does not convert polymorphic extraction %j into an owner count or title fact', async value => {
    fixture.context.vehicleIntel = { description_intel: { condition_note: 'Reported description', owner_count: value, title_status: value } };
    await mount();
    expect(host.textContent?.includes('0 OWNERS REPORTED')).toBe(value === 0);
    expect(host.textContent).not.toContain('[object Object]');
    expect(host.textContent).not.toContain('EXTRACTED TITLE');
  },
);
