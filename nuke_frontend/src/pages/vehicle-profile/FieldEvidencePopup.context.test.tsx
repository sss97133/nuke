// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ client: null as unknown as SupabaseClient, open: vi.fn(), photo: vi.fn(), refused: false }));
vi.mock('../../lib/supabase', () => ({ supabase: { from: (...args: any[]) => (fixture.client.from as any)(...args) } }));
vi.mock('../../components/popups/usePopup', () => ({ usePopup: () => ({ closeTop: vi.fn(), openPopup: fixture.open }) }));
vi.mock('./VehiclePhotoLightbox', () => ({ openVehiclePhoto: fixture.photo }));
vi.mock('./hooks/useFieldEvidence', () => ({ useFieldEvidence: () => ({ evidence: {}, loading: false, error: null }) }));
vi.mock('./hooks/useFieldProvenance', async original => ({
  ...await original<typeof import('./hooks/useFieldProvenance')>(),
  useFieldProvenance: () => ({ data: { value: 'Automatic', evidence: [], coverage: fixture.refused ? { status: 'refused_input_limit' } : undefined, observations: [
    { id: 'specific-report', value: '6L90', content: 'Specific transmission retained in the vehicle report.', source_slug: 'synthetic_source', observed_at: '2026-01-02T00:00:00Z' },
  ] }, isLoading: false }),
}));
vi.mock('./hooks/useVehicleImageEvidence', async original => ({
  ...await original<typeof import('./hooks/useVehicleImageEvidence')>(),
  useVehicleImageEvidence: () => ({ isLoading: false, data: { complete: true, images: [
    { id: 'transmission-photo', image_url: 'https://images.test/transmission.jpg', vehicle_zone: 'mech_drivetrain', is_document: false },
    { id: 'unrelated-engine', image_url: 'https://images.test/engine.jpg', vehicle_zone: 'mech_engine_bay', is_document: false },
  ] } }),
}));
vi.mock('../../components/PrefetchLink', () => ({ default: ({ to, children }: any) => <a href={to}>{children}</a> }));
import FieldEvidencePopup from './FieldEvidencePopup';

let root: Root, host: HTMLDivElement, cache: QueryClient;
let requests: URL[], fail: boolean;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  requests = []; fail = false; fixture.refused = false; fixture.open.mockReset(); fixture.photo.mockReset();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network forbidden'); }));
  fixture.client = createClient('https://context.test', 'synthetic-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async input => {
      const url = new URL(String(input)); requests.push(url);
      expect(url.pathname).toBe('/rest/v1/vehicles');
      return new Response(JSON.stringify(fail ? { message: 'Synthetic read refused' } : [
        { id: 'peer', year: 1977, make: 'Synthetic', model: 'Specimen', trim: null, thumbnail_url: null, created_at: '2026-01-01T00:00:00Z' },
      ]), { status: fail ? 500 : 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); cache.clear(); host.remove(); expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
async function render() {
  await act(async () => root.render(<QueryClientProvider client={cache}><FieldEvidencePopup vehicleId="subject" field="transmission" label="Transmission" value="6L90"
    context={{ subject: { id: 'subject', year: 1977, make: 'Synthetic', model: 'Specimen', transmission: 'Automatic' }, matchField: 'transmission_model' }} /></QueryClientProvider>));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

it('opens the specific component through this vehicle and widens the same label without leaving the page', async () => {
  await render();
  expect(requests).toHaveLength(0);
  await act(async () => (host.querySelector('.vp-field-context__segment-head button') as HTMLButtonElement).click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  const first = requests[0].searchParams;
  expect(Object.fromEntries(first)).toMatchObject({ transmission_model: 'eq.6L90', year: 'eq.1977', make: 'eq.Synthetic', model: 'eq.Specimen', id: 'neq.subject', is_public: 'eq.true', limit: '8' });
  expect(first.has('transmission')).toBe(false);
  expect(host.querySelector('.vp-field-context__report')?.textContent).toContain('Specific transmission retained');
  expect(host.querySelector('.vp-field-context__images')?.querySelectorAll('button')).toHaveLength(1);
  await act(async () => (host.querySelector('.vp-field-context__images button') as HTMLButtonElement).click());
  expect(fixture.photo).toHaveBeenCalledWith('transmission-photo');
  await act(async () => ([...host.querySelectorAll('button')].find(button => button.textContent === 'All profiles') as HTMLButtonElement).click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  const wider = requests[1].searchParams;
  expect(wider.get('transmission_model')).toBe('eq.6L90');
  expect(wider.has('make')).toBe(false); expect(wider.has('model')).toBe(false); expect(wider.has('year')).toBe(false);
  await act(async () => (host.querySelector('.vp-field-context__peers button') as HTMLButtonElement).click());
  expect(fixture.open).toHaveBeenCalledOnce();
  expect(host.textContent).not.toContain('Auction performance unavailable');
});

it('reports a failed segment read without turning it into an empty population', async () => {
  fail = true; await render();
  await act(async () => (host.querySelector('.vp-field-context__segment-head button') as HTMLButtonElement).click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(host.textContent).toContain('Related profiles could not be read');
  expect(host.textContent).not.toContain('No other profiles returned');
});

it('withholds refused source collections in the contextual presentation as well as the evidence drawer', async () => {
  fixture.refused = true; await render();
  expect(host.textContent).toContain('Source evidence could not be loaded completely');
  expect(host.textContent).not.toContain('Specific transmission retained');
});
