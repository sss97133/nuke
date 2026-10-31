// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ context: {} as any, condition: null as any, price: null as any,
  priceSettled: true, client: null as any, readOverride: null as (() => any) | null }));
vi.mock('./VehicleProfileContext', () => ({ useVehicleProfile: () => fixture.context }));
vi.mock('./hooks/useVehiclePriceFacts', () => ({
  useVehiclePriceFacts: () => ({ priceFacts: fixture.price, priceSettled: fixture.priceSettled }), priceKindLabel: () => null,
}));
vi.mock('../../lib/supabase', () => ({ supabase: {
  from: (...args: unknown[]) => fixture.readOverride ? fixture.readOverride() : fixture.client.from(...args),
} }));
vi.mock('../../components/PrefetchLink', () => ({ PrefetchLink: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a> }));
import VehicleBriefing from './VehicleBriefing';

let root: Root, host: HTMLDivElement;
let reply: ((vehicleId: string) => Response | Promise<Response>) | null;
const requests: URL[] = [];
let clientNumber = 0;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.context = { vehicle: { id: 'offline-subject' }, vehicleIntelLoading: false, observationCount: 0 };
  fixture.condition = null; fixture.price = null; fixture.priceSettled = true; fixture.readOverride = null;
  reply = null; requests.length = 0;
  fixture.client = createClient('https://briefing-appraisal.test', 'anonymous-fixture', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
      storageKey: `briefing-appraisal-fixture-${++clientNumber}` },
    global: { fetch: async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push(url);
      if (url.pathname !== '/rest/v1/vehicle_condition_scores') throw new Error('Unexpected reader');
      const subject = url.searchParams.get('vehicle_id')?.replace(/^eq\./, '');
      if (!subject) throw new Error('Missing exact appraisal subject');
      return reply ? reply(subject) : json(fixture.condition);
    } },
  });
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

it('leaves model sale exploration to its contextual owner instead of injecting it into the briefing', async () => {
  fixture.context.vehicleIntel = { recent_comps: [{ id: 'offline-sale', year: 1966, model: 'Mustang', sale_price: 20000, sale_date: '2026-09-01', mileage: 30000 }],
    recent_comps_scope: { label: 'Registered source scope' } };
  await act(async () => root.render(<VehicleBriefing />));
  expect(host.querySelector('.vp-sold-context')).toBeNull();
  expect(host.querySelector('a[href="/vehicle/offline-sale"]')).toBeNull();
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

it.each([
  [20000], [20000, null], [null, 30000], [20000, ''], [20000, ' '], [false, 30000],
  ['NaN', 30000], [20000, 'Infinity'], [20000, '-Infinity'], ['not-money', 30000], {},
].map(band => ({ band })))('withholds incomplete or nonfinite stored amount bounds: $band', async ({ band }) => {
  fixture.condition = { descriptor_summary: { as_is_band_usd: band }, observation_count: 79,
    computed_at: '2026-07-14T00:30:00Z' };
  await mount(null);
  expect(host.textContent).toBe('');
  expect(host.textContent).not.toMatch(/NaN|Infinity|APPRAISAL|COMPUTED|INPUT COUNT/);
});

it.each([
  { band: [0, 30000], range: '$0k–$30k' },
  { band: [0, 0], range: '$0k–$0k' },
  { band: ['20000', '30000'], range: '$20k–$30k' },
])('preserves finite stored bounds $band without losing a reported zero', async ({ band, range }) => {
  fixture.condition = { descriptor_summary: { as_is_band_usd: band }, observation_count: 79,
    computed_at: '2026-07-14T00:30:00Z' };
  await mount(null);
  expect(host.textContent).toContain(`Stored appraisal range: ${range} USD`);
  expect(host.textContent).toContain('INPUT COUNT79 reported');
  expect(host.textContent).toContain('COMPUTED (UTC)Jul 14, 2026');
  expect(host.textContent).toContain('Input IDs, count meaning and calibration unavailable. Condition matching unverified.');
});

const subjectA = '00000000-0000-0000-0000-0000000000a1';
const subjectB = '00000000-0000-0000-0000-0000000000b2';
const appraisalA = { descriptor_summary: { as_is_band_usd: [20000, 30000], condition_class: 'Driver' },
  observation_count: 79, computed_at: '2026-07-14T00:30:00Z' };
const appraisalB = { descriptor_summary: { as_is_band_usd: [40000, 50000], condition_class: 'Restored' },
  observation_count: 12, computed_at: '2026-08-15T00:30:00Z' };
const frames: string[] = [];
function FrameProbe() {
  React.useLayoutEffect(() => { frames.push(host.textContent ?? ''); });
  return null;
}
async function renderSubject(vehicleId: string | undefined, priceSettled = true) {
  fixture.context.vehicle = vehicleId ? { id: vehicleId } : null;
  fixture.context.vehicleIntel = { comment_intel: { overall_sentiment: 'unknown' } };
  fixture.priceSettled = priceSettled;
  frames.length = 0;
  await act(async () => root.render(<><VehicleBriefing /><FrameProbe /></>));
}
function expectNoAppraisalA() {
  for (const text of [host.textContent ?? '', ...frames]) {
    expect(text).not.toContain('$20k');
    expect(text).not.toContain('Driver');
    expect(text).not.toContain('79 reported');
    expect(text).not.toContain('Jul 14, 2026');
  }
}

it.each(['empty', 'denied', 'network'])('withholds A appraisal while B is pending and after B is %s', async result => {
  let release!: (response: Response) => void, reject!: (reason: Error) => void;
  const pending = new Promise<Response>((resolve, fail) => { release = resolve; reject = fail; });
  reply = vehicleId => vehicleId === subjectA ? json([appraisalA]) : pending;
  await renderSubject(subjectA);
  expect(host.textContent).toContain('Stored appraisal range: $20k–$30k USD');
  await renderSubject(subjectB, false);
  expect(host.textContent).toBe('');
  await renderSubject(subjectB);
  expectNoAppraisalA();
  expect(host.textContent).toContain('Reported comment summary: unknown');
  await act(async () => result === 'network' ? reject(new TypeError('fixture connection failed'))
    : release(result === 'empty' ? json([]) : json({ code: '42501', message: 'permission denied' }, 403)));
  expectNoAppraisalA();
  expect(host.textContent).toContain('Reported comment summary: unknown');
  expect(requests.map(url => url.searchParams.get('vehicle_id'))).toEqual([`eq.${subjectA}`, `eq.${subjectB}`]);
  expect(requests[1].searchParams.get('select')).toBe('condition_score,condition_tier,descriptor_summary,observation_count,computed_at,computation_version');
});

it('shows only the current B stored appraisal and preserves its reported qualifications', async () => {
  let release!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { release = resolve; });
  reply = vehicleId => vehicleId === subjectA ? json([appraisalA]) : pending;
  await renderSubject(subjectA);
  await renderSubject(subjectB);
  expectNoAppraisalA();
  await act(async () => release(json([appraisalB])));
  expectNoAppraisalA();
  expect(host.textContent).toContain('Stored appraisal range: $40k–$50k USD · reported condition: Restored');
  expect(host.textContent).toContain('INPUT COUNT12 reported');
  expect(host.textContent).toContain('COMPUTED (UTC)Aug 15, 2026');
  expect(host.textContent).toContain('Input IDs, count meaning and calibration unavailable. Condition matching unverified.');
  await renderSubject(subjectB);
  expect(host.textContent).toContain('Stored appraisal range: $40k–$50k USD');
  expect(requests).toHaveLength(2);
});

it('does not resurrect an appraisal after the vehicle is removed and revisited pending', async () => {
  let release!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { release = resolve; });
  let reads = 0;
  reply = () => ++reads === 1 ? json([appraisalA]) : pending;
  await renderSubject(subjectA);
  expect(host.textContent).toContain('79 reported');
  await renderSubject(undefined);
  expect(host.textContent).toBe('');
  await renderSubject(subjectA);
  expectNoAppraisalA();
  await act(async () => release(json([])));
  expectNoAppraisalA();
  expect(host.textContent).toContain('Reported comment summary: unknown');
  expect(requests).toHaveLength(2);
});

it.each(['resolved', 'empty', 'denied'])('ignores a late %s A response after B has its own appraisal', async result => {
  let release!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { release = resolve; });
  reply = vehicleId => vehicleId === subjectA ? pending : json([appraisalB]);
  await renderSubject(subjectA);
  await renderSubject(subjectB);
  expect(host.textContent).toContain('Stored appraisal range: $40k–$50k USD');
  await act(async () => release(result === 'resolved' ? json([appraisalA]) : result === 'empty' ? json([])
    : json({ code: '42501', message: 'permission denied' }, 403)));
  expectNoAppraisalA();
  expect(host.textContent).toContain('Stored appraisal range: $40k–$50k USD');
});

// The installed SDK returns normal HTTP/fetch failures as result.error above. These
// adapters separately exercise a throwing or rejecting additive reader boundary.
it.each(['throw', 'reject'])('settles a synthetic %s read without retaining A or leaking a rejection', async failure => {
  reply = () => json([appraisalA]);
  await renderSubject(subjectA);
  expect(host.textContent).toContain('79 reported');
  fixture.readOverride = () => {
    if (failure === 'throw') throw new Error('synthetic reader construction failed');
    return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.reject(new Error('synthetic read rejected')) }) }) };
  };
  await renderSubject(subjectB);
  expectNoAppraisalA();
  expect(host.textContent).toContain('Reported comment summary: unknown');
});

it('ignores a synthetic late A rejection after B has a supported current appraisal', async () => {
  let reject!: (reason: Error) => void;
  const pending = new Promise((_, fail) => { reject = fail; });
  fixture.readOverride = () => ({ select: () => ({ eq: () => ({ maybeSingle: () => pending }) }) });
  await renderSubject(subjectA);
  fixture.readOverride = null;
  reply = () => json([appraisalB]);
  await renderSubject(subjectB);
  expect(host.textContent).toContain('Stored appraisal range: $40k–$50k USD');
  await act(async () => reject(new Error('synthetic stale read rejected')));
  expectNoAppraisalA();
  expect(host.textContent).toContain('Stored appraisal range: $40k–$50k USD');
});
