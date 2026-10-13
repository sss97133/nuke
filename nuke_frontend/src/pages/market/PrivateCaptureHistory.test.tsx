// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ user: null as { id: string } | null, admin: false, sessionUser: 'owner', invoke: vi.fn() }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: fixture.user }) }));
vi.mock('../../hooks/useAdminAccess', () => ({ useAdminAccess: () => ({ isAdmin: fixture.admin, loading: false }) }));
vi.mock('../../lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: fixture.sessionUser }, access_token: `synthetic-${fixture.sessionUser}-token` } } }) }, functions: { invoke: fixture.invoke } } }));
import PrivateCaptureHistory, { readPrivateCaptureHistory } from './PrivateCaptureHistory';

function reading(title = 'Synthetic private listing') {
  const observation = { sighting_id: 'fixture-sighting', capture_id: 'fixture-capture', observed_at: '2025-01-03T06:00:00Z',
    intake_started_at: '2025-01-03T06:01:00Z', capture_acknowledged_at: '2025-01-03T06:01:00Z', known_by: '2025-01-03T06:01:00Z',
    asking_amount: 0, asking_currency: null, source_reported_listed_at: null, source_reported_age_label: null,
    detail_observation: false, retrieval_surface: 'search', actual_region: 'Fixture region', actual_url: 'https://www.facebook.com/marketplace/category/vehicles/',
    target_url: 'https://www.facebook.com/marketplace/category/vehicles/', source_scope_complete: false };
  return { contract: 'facebook_listing_history_v1', section: 'listing_history', status: 'measured', measured_at: '2025-01-03T12:00:00Z', capture_window_complete: false,
    summary: { selected_runs: 1, acknowledged_runs: 1, withheld_runs: 0, retained_sightings: 1, listing_histories: 1, repeated_histories: 0, histories_with_asking_changes: 0 },
    scope: { event_from: '2025-01-02T12:00:00Z', event_before: '2025-01-03T12:00:00Z', knowledge_cutoff: '2025-01-03T12:00:00Z', capture_limit: 100, listing_limit: 20,
      basis: 'retained_listing_sightings_in_selected_acknowledged_captures', knowledge_basis: 'capture_completion_upper_bound_not_per_sighting_admission_or_commit_time',
      availability_between_observations: 'unobserved', continuous_active_duration: null, confirmed_sale: null, relist_identity: 'unresolved' },
    rows: [{ listing_id: 'fixture-listing', facebook_id: '700000000001', title, current_vehicle_id: null, first_observed_at: observation.observed_at,
      last_observed_at: observation.observed_at, observed_span_minutes: 0, observation_count: 1, search_sightings: 1, detail_observations: 0,
      same_query_revisits: 0, observed_asking_changes: 0, observations: [observation] }] };
}
let client: QueryClient, container: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; fixture.user = null; fixture.admin = false; fixture.sessionUser = 'owner'; fixture.invoke.mockReset();
  fixture.invoke.mockResolvedValue({ data: reading(), error: null });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); });
async function render(source = 'classifieds') {
  await act(async () => root.render(<QueryClientProvider client={client}><PrivateCaptureHistory source={source} /></QueryClientProvider>));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1)); });
}
it('makes no private read for anonymous, nonadmin or a different source filter', async () => {
  await render(); fixture.user = { id: 'owner' }; await render(); fixture.admin = true; await render('craigslist');
  expect(fixture.invoke).not.toHaveBeenCalled(); expect(container.textContent).toBe('');
});
it('shows bounded existing authenticated history without resolving an asset, inventing currency or claiming source coverage', async () => {
  fixture.user = { id: 'owner' }; fixture.admin = true; await render();
  expect(fixture.invoke.mock.calls[0][0]).toBe('db-stats?intake=listing_history');
  expect(fixture.invoke.mock.calls[0][1].method).toBe('GET');
  expect(container.textContent).toContain('Synthetic private listing'); expect(container.textContent).toContain('Vehicle unresolved');
  expect(container.textContent).toContain('0 · currency unrecorded'); expect(container.textContent).toContain('20 listing histories');
  expect(container.textContent).toContain('Capture window partial'); expect(container.textContent).toContain('not full Facebook inventory');
  expect(container.querySelector('a')?.getAttribute('href')).toBe('https://www.facebook.com/marketplace/item/700000000001/');
});
it('clears displayed history and the principal cache on logout', async () => {
  fixture.user = { id: 'owner' }; fixture.admin = true; await render();
  expect(client.getQueryData(['market-private-capture-history', 'owner'])).toBeDefined();
  fixture.user = null; fixture.admin = false; await render();
  expect(container.textContent).toBe(''); expect(client.getQueryData(['market-private-capture-history', 'owner'])).toBeUndefined();
});
it('aborts an old principal request and never caches a late private response after switching users', async () => {
  let resolve!: (value: unknown) => void; fixture.invoke.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  fixture.user = { id: 'owner' }; fixture.admin = true; await render();
  const oldSignal = fixture.invoke.mock.calls[0][1].signal;
  fixture.user = { id: 'second-owner' }; fixture.sessionUser = 'second-owner'; await render();
  expect(oldSignal.aborted).toBe(true);
  await act(async () => resolve({ data: reading('Late former-owner private title'), error: null }));
  expect(container.textContent).not.toContain('Late former-owner'); expect(client.getQueryData(['market-private-capture-history', 'owner'])).toBeUndefined();
});
it('refuses a session/principal mismatch before requesting private history', async () => {
  await expect(readPrivateCaptureHistory('wrong-user', new AbortController().signal)).rejects.toThrow('session unavailable');
  expect(fixture.invoke).not.toHaveBeenCalled();
});
it('binds the request to the same principal-checked session rather than a newly selected implicit session', async () => {
  fixture.invoke.mockImplementationOnce((_name, options) => {
    fixture.sessionUser = 'second-owner';
    expect(options.headers.Authorization).toBe('Bearer synthetic-owner-token');
    return Promise.resolve({ data: reading(), error: null });
  });
  await readPrivateCaptureHistory('owner', new AbortController().signal);
  expect(fixture.invoke).toHaveBeenCalledOnce();
});
it('keeps a different captured detail-page URL as evidence while linking the actual retained native listing ID', async () => {
  const result = reading(); result.rows[0].observations[0].actual_url = 'https://www.facebook.com/marketplace/item/700000000099/';
  fixture.invoke.mockResolvedValueOnce({ data: result, error: null }); fixture.user = { id: 'owner' }; fixture.admin = true; await render();
  expect(container.querySelector('a')?.getAttribute('href')).toBe('https://www.facebook.com/marketplace/item/700000000001/');
  expect([...container.querySelectorAll('a')].find(a => a.textContent === 'Capture surface')?.getAttribute('href')).toBe('https://www.facebook.com/marketplace/item/700000000099/');
});
