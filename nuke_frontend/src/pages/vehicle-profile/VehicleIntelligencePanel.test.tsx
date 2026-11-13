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
it('shows an acceptance milestone as awaiting schedule without an auction date', async () => {
  fixture.context.vehicleIntel = { apparitions: [
    { platform: 'bat', event_type: 'auction', event_date: null, price: null, url: null, schedule_status: 'accepted_awaiting_schedule' },
    { platform: 'owner_import', event_type: 'listing', event_date: null, price: null, url: null },
  ] };
  await mount();
  const heading = [...host.querySelectorAll('button,[role="button"]')].find(element => element.textContent?.includes('Apparition History')) as HTMLElement;
  await act(async () => heading.click());
  expect(host.textContent).toContain('Accepted · awaiting schedule');
  expect(host.textContent).toContain('Date TBD');
});

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
  for (const label of ['REPORTED EXCERPTS', "MODEL'S READING OF THE COMMENTS · NOT VERIFIED", 'REPORTED CONCERNS',
    'Reported wording', 'Extracted observation', 'Reported concern']) expect(host.textContent).toContain(label);
  // A model's market labels are never rendered as statuses.
  for (const chip of ['DEMAND LABEL', 'RARITY LABEL', 'PRICE TREND LABEL']) expect(host.textContent).not.toContain(chip);
  for (const claim of ['Community Intelligence', 'EXPERT INSIGHTS', 'KEY QUOTES']) expect(host.textContent).not.toContain(claim);
  expect(host.querySelector('[style*="vp-brg"], [style*="vp-danger"]')).toBeNull();
});

it('names the model, date and input count when the summary carries them, and shows no market labels', async () => {
  const insight = 'An extracted observation long enough that the old card would have cut it off before the reader reached the part that matters to a buyer deciding on the car.';
  await mount({ overall_sentiment: 'mixed', comment_count: 84, comments_analyzed: 84, model_used: 'claude-haiku-5-5',
    analyzed_at: '2026-11-12T12:15:24.689+00:00', expert_insights: [insight],
    market_signals: { demand_level: 'high', rarity_assessment: 'unknown', price_trend: 'unknown' } });
  expect(host.textContent).toContain('Stored model interpretation · claude-haiku-5-5 · written Nov 12, 2026 · read 84 of 84 comments.');
  expect(host.textContent).not.toContain('analysis time unavailable');
  expect(host.textContent).toContain('Market performance remains unverified');
  expect(host.textContent).toContain(insight);
  expect(host.textContent).not.toContain('DEMAND LABEL');
  expect(host.textContent).not.toContain('RARITY LABEL');
  expect(host.textContent).not.toContain('PRICE TREND LABEL');
});

it('attributes a quote to its comment with a link when the summary carries one', async () => {
  await mount({ overall_sentiment: 'mixed', comment_count: 2, key_quotes: [
    { quote: 'Sold my last one too early', author: 'gearhead77', posted_at: '2026-11-11T12:00:00+00:00',
      url: 'https://bringatrailer.com/listing/example/#comment-123', comment_id: 'c1' },
    { quote: 'Older text-only quote' }] });
  expect(host.textContent).toContain('@gearhead77');
  const link = host.querySelector('a[href="https://bringatrailer.com/listing/example/#comment-123"]');
  expect(link?.textContent).toContain('Open comment');
  expect(host.textContent).toContain('Older text-only quote');
  expect(host.querySelectorAll('a[href*="#comment-"]').length).toBe(1);
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
