// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createClient } from '@supabase/supabase-js';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ client: null as any, user: { id: 'viewer' } as any, open: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ get supabase() { return fixture.client; } }));
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: fixture.user }) }));
vi.mock('./VehiclePhotoLightbox', () => ({ openVehiclePhoto: fixture.open }));
import WorkSessionContext from './WorkSessionContext';
import { readWorkSessionContext } from './workSessionEvidenceReader';
const vehicle = '11111111-1111-4111-8111-111111111111';
const session = '22222222-2222-4222-8222-222222222222';
const image = '33333333-3333-4333-8333-333333333333';
const missing = '44444444-4444-4444-8444-444444444444';
const day = '2021-05-08';
let host: HTMLDivElement, root: Root, client: QueryClient;
let requests: URL[], row: any, photos: any[], deny: boolean, denyPhotos: boolean;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.user = { id: 'viewer' }; fixture.open.mockClear(); requests = []; deny = false; denyPhotos = false;
  row = { id: session, vehicle_id: vehicle, session_date: day, synthesis_model: 'retained-model',
    synthesized_at: '2026-06-18T00:48:27Z', work_items: [{ task: 'Brake service', component: 'front brakes',
      completeness: { before: 'Scored rotor', after: 'Clean rotor; caliper identity uncertain' }, labor_signal: 'physical_work',
      evidence_frame_ids: [image, image, missing, 'invalid'] }] };
  photos = [{ id: image, image_url: 'https://images.test/brake.jpg', vehicle_id: vehicle, work_session_id: session }];
  fixture.client = createClient('https://context.test', 'synthetic-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `context-${crypto.randomUUID()}` },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input)); requests.push(url);
      expect(init?.method ?? 'GET').toBe('GET');
      const refused = deny || (denyPhotos && url.pathname.endsWith('vehicle_images'));
      const data = refused ? { message: 'Unavailable' } : url.pathname.endsWith('work_sessions') ? row : photos;
      return new Response(JSON.stringify(data), { status: refused ? 403 : 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function render() { await act(async () => { root.render(<QueryClientProvider client={client}><WorkSessionContext vehicleId={vehicle} sessionId={session} date={day} /></QueryClientProvider>); }); }
async function expand() { await act(async () => { const detail = host.querySelector('details')!; detail.open = true; detail.dispatchEvent(new Event('toggle')); await new Promise(r => setTimeout(r, 30)); }); }
it('reads lazily and opens the cited photo without converting analysis to installed value', async () => {
  await render(); expect(requests).toHaveLength(0); await expand();
  await act(async () => { await new Promise(r => setTimeout(r, 30)); });
  expect(host.textContent).toContain('Scored rotor'); expect(host.textContent).toContain('do not confirm installed quantities or labor value');
  expect(host.textContent).toContain('1 cited photo is unavailable');
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click()); expect(fixture.open).toHaveBeenCalledWith(image);
  expect(requests[0].searchParams.get('id')).toBe(`eq.${session}`);
  expect(requests[0].searchParams.get('session_date')).toBe(`eq.${day}`);
  expect(requests[0].searchParams.get('select')).not.toContain('synthesis:metadata');
  expect(requests[1].searchParams.get('vehicle_image_gallery_eligible')).toBe('eq.true');
  expect(requests[1].searchParams.get('work_session_id')).toBe(`eq.${session}`);
});
it('does not read signed-out evidence', async () => { fixture.user = null; await render(); await expand(); expect(requests).toHaveLength(0); expect(host.textContent).toContain('Sign in'); });
it.each(['id', 'vehicle_id', 'session_date'])('refuses a mismatched %s before fetching images', async key => {
  row[key] = 'wrong'; await expect(readWorkSessionContext(vehicle, session, day)).rejects.toThrow('unavailable'); expect(requests).toHaveLength(1);
});
it('rejects cross-session and cross-vehicle photos even if returned by transport', async () => {
  photos = [{ ...photos[0], vehicle_id: 'other' }, { ...photos[0], work_session_id: 'other' }];
  expect((await readWorkSessionContext(vehicle, session, day)).photos).toEqual([]);
});
it('distinguishes absent structured work from an unavailable session', async () => {
  row.work_items = null; expect((await readWorkSessionContext(vehicle, session, day)).operations).toEqual([]); expect(requests).toHaveLength(1);
  deny = true; await expect(readWorkSessionContext(vehicle, session, day)).rejects.toThrow('unavailable');
});
it('removes evidence when the viewer signs out', async () => {
  await render(); await expand(); await act(async () => { await new Promise(r => setTimeout(r, 30)); });
  expect(host.textContent).toContain('Scored rotor'); fixture.user = null; await render(); expect(host.textContent).not.toContain('Scored rotor');
});

it('keeps retained analysis distinguishable from an unavailable photo read', async () => {
  denyPhotos = true; const result = await readWorkSessionContext(vehicle, session, day);
  expect(result.operations).toHaveLength(1); expect(result.photos).toEqual([]); expect(result.photosUnavailable).toBe(true);
});
it('hides previous evidence when a refreshed permission check fails', async () => {
  await render(); await expand(); await act(async () => { await new Promise(r => setTimeout(r, 30)); });
  expect(host.textContent).toContain('Scored rotor'); deny = true;
  await act(async () => { await client.invalidateQueries(); await new Promise(r => setTimeout(r, 30)); });
  expect(host.textContent).not.toContain('Scored rotor'); expect(host.textContent).toContain('Work evidence could not load');
});
