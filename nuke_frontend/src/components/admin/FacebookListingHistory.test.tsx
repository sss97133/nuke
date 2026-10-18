// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({ result: null as any,calls: [] as any[] }));
vi.mock('../../lib/supabase',()=>({ supabase: { functions: { invoke: (name: string,options: any)=>{
  fixture.calls.push({ name,options });return Promise.resolve(fixture.result);
} } } }));
import FacebookListingHistory, { validListingHistory } from './FacebookListingHistory';
let root: Root,container: HTMLDivElement;
const observed='2025-01-03T06:00:00Z';
const acknowledged='2025-01-03T06:01:00Z';
function reading() {
  const observation={ sighting_id: 's1',capture_id: 'c1',observed_at: observed,
    intake_started_at: acknowledged,capture_acknowledged_at: acknowledged,known_by: acknowledged,
    asking_amount: 0,asking_currency: null,source_reported_listed_at: null,source_reported_age_label: '13 hours ago',
    detail_observation: false,retrieval_surface: 'search',actual_region: 'Nevada',
    actual_url: 'https://www.facebook.com/marketplace/category/vehicles/',
    target_url: 'https://www.facebook.com/marketplace/las-vegas/vehicles/',source_scope_complete: false };
  return { contract: 'facebook_listing_history_v1',section: 'listing_history',status: 'measured',
    measured_at: '2025-01-03T12:00:00Z',capture_window_complete: true,
    summary: { selected_runs: 1,acknowledged_runs: 1,withheld_runs: 0,retained_sightings: 1,listing_histories: 1,repeated_histories: 0,histories_with_asking_changes: 0 },
    scope: { event_from: '2025-01-02T12:00:00Z',event_before: '2025-01-03T12:00:00Z',knowledge_cutoff: '2025-01-03T12:00:00Z',
      capture_limit: 100,listing_limit: 20,basis: 'retained_listing_sightings_in_selected_acknowledged_captures',
      knowledge_basis: 'capture_completion_upper_bound_not_per_sighting_admission_or_commit_time',
      availability_between_observations: 'unobserved',continuous_active_duration: null,confirmed_sale: null,relist_identity: 'unresolved' },
    rows: [{ listing_id: 'listing1',facebook_id: '1001',title: 'Retained coupe',current_vehicle_id: null,
      first_observed_at: observed,last_observed_at: observed,observed_span_minutes: 0,observation_count: 1,
      search_sightings: 1,detail_observations: 0,same_query_revisits: 0,observed_asking_changes: 0,observations: [observation] }] };
}
beforeEach(()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  fixture.calls=[];fixture.result={ data: reading() };
  container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
});
afterEach(async()=>{ await act(async()=>root.unmount());container.remove(); });
async function load() { await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{ bubbles: true,cancelable: true }))); }
it('requests private history on demand and preserves unknown currency/listed time and unresolved vehicle',async()=>{
  await act(async()=>root.render(<FacebookListingHistory />));expect(fixture.calls).toHaveLength(0);
  await load();expect(fixture.calls[0].name).toBe('db-stats?intake=listing_history');expect(fixture.calls[0].options.method).toBe('GET');
  expect(container.textContent).toContain('0 · currency unknown');
  expect(container.textContent).toContain('Vehicle identity unresolved');expect(container.textContent).toContain('Exact listed time unmeasured');
  expect(container.textContent).toContain('Source age label: 13 hours ago');
  expect(container.textContent).toContain('Presence between observations unobserved');expect(container.textContent).not.toContain('$0');
  expect(container.querySelector('tbody a')?.getAttribute('href')).toBe('https://www.facebook.com/marketplace/item/1001/');
});
it('keeps source search revisits separate from detail enrichment and scope limits visible',async()=>{
  const d=reading();d.capture_window_complete=false;d.summary.selected_runs=100;d.summary.acknowledged_runs=100;
  d.rows[0].observation_count=2;d.rows[0].detail_observations=1;d.rows[0].observations.push({ ...d.rows[0].observations[0],sighting_id: 's2',capture_id: 'c2',detail_observation: true });
  d.summary.retained_sightings=2;d.summary.repeated_histories=1;fixture.result={ data: d };
  await act(async()=>root.render(<FacebookListingHistory />));await load();
  expect(container.textContent).toContain('First 100 captures only');
  expect(container.textContent).toContain('0 same-query revisits · 1 search sightings · 1 detail observations');
  expect(container.textContent).toContain('per-sighting admission and commit time are unmeasured');
});
it('rejects future knowledge/source evidence and invented active duration in a historical reading',()=>{
  for (const mutation of [
    (d: any)=>{ d.rows[0].observations[0].known_by='2025-01-04T00:00:00Z'; },
    (d: any)=>{ d.rows[0].observations[0].observed_at=d.scope.event_before; },
    (d: any)=>{ d.scope.continuous_active_duration=24; },
    (d: any)=>{ d.rows[0].observations[0].asking_currency='dollars'; },
  ]) { const d=reading();mutation(d);expect(validListingHistory(d)).toBe(false); }
});
it('retains the previous dated scope when a read fails without showing private error bodies',async()=>{
  await act(async()=>root.render(<FacebookListingHistory />));await load();
  fixture.result={ error: { message: 'PRIVATE_SOURCE_AND_CONTACT' } };await load();
  expect(container.textContent).toContain('Listing history unavailable');expect(container.textContent).toContain('Retained coupe');
  expect(container.textContent).not.toContain('PRIVATE_');
});
it('empty histories retain unknown availability and never report a running monitor',async()=>{
  const d=reading();d.rows=[];Object.keys(d.summary).forEach(k=>(d.summary as any)[k]=0);fixture.result={ data: d };
  await act(async()=>root.render(<FacebookListingHistory />));await load();
  expect(container.textContent).toContain('No acknowledged listing history in this reading');
  expect(container.textContent).toContain('Source coverage and availability remain unknown');
  expect(container.textContent).not.toContain('Monitor is running');
});
