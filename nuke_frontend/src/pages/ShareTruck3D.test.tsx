// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
const fixture = vi.hoisted(() => ({ client: null as any, raw: null as any, site: null as any,
  navigate: null as any, mounts: 0, mapReads: vi.fn(), query: '' }));
vi.mock('../lib/supabase', () => ({ get supabase() { return fixture.client; } }));
vi.mock('../components/wiring/map/useWiringMap', () => ({ useWiringMap: (id: string) => { fixture.mapReads(id); return fixture.raw; } }));
vi.mock('../components/wiring/map/useWorkspaceSelection', () => ({ publicName: (s: string) => s,
  useSiteFiles: () => fixture.site, useWsIndex: () => ({}), relOf: () => ({}) }));
vi.mock('../components/wiring/map/ZoneModels3D', () => ({ default: ({ init, onScene }: any) => {
  const [mount] = useState(() => ++fixture.mounts);
  return <div data-testid="scene" data-mount={mount}>
    <span>{JSON.stringify({ cam: init.cam, layers: [...(init.layers ?? [])], pose: init.pose })}</span>
    <button onClick={() => onScene({ layers: 'frame' })}>Change layer</button>
  </div>;
} }));
import ShareTruck3D, { TRUCK_SCENE_VEHICLE_ID as subject } from './ShareTruck3D';
let host: HTMLDivElement, root: Root;
let row: any, refuse: boolean, pending: Promise<void> | undefined, reads: URL[];
function Navigation() { fixture.navigate = useNavigate(); fixture.query = useLocation().search; return null; }
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); }); }
async function render(url = `/share/truck/${subject}?cam=bay&layers=frame,engine`) {
  await act(async () => root.render(<MemoryRouter initialEntries={[url]}><Navigation /><Routes>
    <Route path="/share/truck/:vehicleId" element={<ShareTruck3D />} />
    <Route path="/share/truck" element={<ShareTruck3D />} />
  </Routes></MemoryRouter>)); await flush();
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.mounts = 0; fixture.mapReads.mockClear(); reads = []; row = { id: subject, deleted_at: null }; refuse = false; pending = undefined;
  fixture.raw = { loaded: true, error: null, nodes: [], wires: [], ends: [], calls: [] };
  fixture.site = { loaded: true, sourceVehicleId: subject, ends: {}, segs: [], models: null, routesOn: null };
  fixture.client = createClient('https://scene.test', 'synthetic-anon', { auth: { persistSession: false,
    autoRefreshToken: false, detectSessionInUrl: false, storageKey: `scene-${crypto.randomUUID()}` },
    global: { fetch: async input => { reads.push(new URL(String(input))); await pending;
      return new Response(JSON.stringify(refuse ? { message: 'Unavailable' } : row), {
        status: refuse ? 503 : 200, headers: { 'Content-Type': 'application/json' } });
    } } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('binds the scene to its retained public source manifests', () => {
  for (const name of ['k5-positions.json', 'k5-routes.json']) {
    expect(JSON.parse(readFileSync(new NodeURL(`../../public/wiring/${name}`, import.meta.url), 'utf8')).vehicle_id).toBe(subject);
  }
});
it('reads the exact subject before mounting the preserved scene', async () => {
  await render(); expect(host.querySelector('[data-testid="scene"]')).not.toBeNull();
  expect(reads[0].searchParams.get('id')).toBe(`eq.${subject}`);
  expect(reads[0].searchParams.get('select')).toBe('id,deleted_at');
  expect(reads[0].searchParams.get('deleted_at')).toBe('is.null');
  expect(host.textContent).toContain('bay'); expect(host.textContent).toContain('engine');
});
it.each(['/share/truck', '/share/truck/11111111-1111-4111-8111-111111111111'])('never renders fixed assets for %s', async url => {
  await render(url); expect(host.querySelector('[data-testid="scene"]')).toBeNull();
  expect(fixture.mapReads).not.toHaveBeenCalled(); expect(reads).toHaveLength(0);
});
it('keeps an invisible or missing subject out of the scene', async () => {
  row = null; await render(); expect(host.textContent).toContain('unavailable in this read');
  expect(host.querySelector('[data-testid="scene"]')).toBeNull(); expect(fixture.mapReads).not.toHaveBeenCalled();
});
it('refuses a soft-deleted vehicle even if the transport returns it', async () => {
  row.deleted_at = '2026-10-31T00:00:00Z'; await render();
  expect(host.textContent).toContain('unavailable in this read');
  expect(host.querySelector('[data-testid="scene"]')).toBeNull(); expect(fixture.mapReads).not.toHaveBeenCalled();
});
it('refuses design files belonging to another vehicle', async () => {
  fixture.site.sourceVehicleId = '11111111-1111-4111-8111-111111111111'; await render();
  expect(host.textContent).toContain('do not identify this truck');
  expect(host.querySelector('[data-testid="scene"]')).toBeNull();
});
it('waits for the subject read and retries a failed read', async () => {
  let release!: () => void; pending = new Promise<void>(resolve => { release = resolve; }); refuse = true;
  await render(); expect(host.textContent).toContain('Reading the shared truck'); expect(fixture.mapReads).not.toHaveBeenCalled();
  await act(async () => release()); await flush(); expect(host.textContent).toContain('could not be read');
  refuse = false; pending = undefined; await act(async () => host.querySelector<HTMLButtonElement>('button')!.click()); await flush();
  expect(host.querySelector('[data-testid="scene"]')).not.toBeNull();
});
it.each([{ loaded: false, error: null }, { loaded: true, error: 'read failed' }])('does not mount on pending/failed wiring data %j', async status => {
  fixture.raw = { ...fixture.raw, ...status }; await render(); expect(host.querySelector('[data-testid="scene"]')).toBeNull();
  expect(host.textContent).toContain(status.error ? 'could not be read' : 'Reading the truck scene');
});
it('does not render a plausible scene when its design files fail', async () => {
  fixture.site.error = 'Design read failed'; await render();
  expect(host.querySelector('[data-testid="scene"]')).toBeNull();
  expect(host.textContent).toContain('could not be read');
  fixture.site.error = null;
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click()); await flush();
  expect(host.querySelector('[data-testid="scene"]')).not.toBeNull();
});
it('keeps controls mounted but replaces camera/layers on URL navigation and Back', async () => {
  await render(); const first = host.querySelector('[data-testid="scene"]')!.getAttribute('data-mount');
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click()); await flush();
  expect(host.querySelector('[data-testid="scene"]')!.getAttribute('data-mount')).toBe(first);
  expect(new URLSearchParams(fixture.query).get('layers')).toBe('frame');
  await act(async () => fixture.navigate(`/share/truck/${subject}?cam=side&layers=engine`)); await flush();
  expect(host.querySelector('[data-testid="scene"]')!.getAttribute('data-mount')).not.toBe(first);
  expect(host.textContent).toContain('driver'); expect(host.textContent).toContain('engine');
  await act(async () => fixture.navigate(-1)); await flush();
  expect(host.textContent).toContain('bay'); expect(host.textContent).not.toContain('engine');
  await act(async () => fixture.navigate('/share/truck/11111111-1111-4111-8111-111111111111')); await flush();
  expect(host.querySelector('[data-testid="scene"]')).toBeNull();
});
