// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ client: null as any, providerAddresses: [] as string[] }));
vi.mock('../lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => fixture.client.rpc(...args) } }));
// Probe the real route's provider boundary; no UUID-dependent subtree may mount under a VIN.
vi.mock('./vehicle-profile/VehicleProfileContext', async () => {
  const React = await import('react');
  const { useParams } = await import('react-router-dom');
  return {
    VehicleProfileProvider: () => {
      const { vehicleId } = useParams();
      fixture.providerAddresses.push(vehicleId!);
      return React.createElement('div', { 'data-profile-address': vehicleId }, 'UUID profile boundary');
    },
    useVehicleProfile: () => { throw new Error('Provider probe does not mount the inner UUID readers'); },
  };
});
vi.mock('./vehicle-profile/ProfileHeader', () => ({ default: () => null }));
vi.mock('../components/vehicle/VehicleMemeOverlay', () => ({ default: () => null }));
import VehicleProfile from './VehicleProfile';

const vin = '1GCEK14K8EJ123456';
const otherVin = 'WP0ZZZ91ZES123456';
const id = '00000000-0000-0000-0000-0000000000a1';
const otherId = '00000000-0000-0000-0000-0000000000b2';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
let container: HTMLDivElement, root: Root, go: ReturnType<typeof useNavigate>;
const requests: { url: URL; body: unknown }[] = [];
let testClientNumber = 0;

function LocationProbe() {
  const location = useLocation();
  go = useNavigate();
  return <output data-location>{location.pathname}{location.search}{location.hash}</output>;
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.providerAddresses = [];
  requests.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function render(address: string, reply: (body: any) => Response | Promise<Response>, strict = false) {
  fixture.client = createClient('https://profile-vin.test', 'anonymous-fixture', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
      storageKey: `profile-vin-fixture-${++testClientNumber}` },
    global: { fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      requests.push({ url, body });
      if (url.pathname !== '/rest/v1/rpc/vehicle_by_vin_public') throw new Error('Unexpected UUID-dependent request');
      return reply(body);
    } },
  });
  const app = <MemoryRouter initialEntries={[`/vehicle/${address}`]}>
    <Routes><Route path="/vehicle/:vehicleId" element={<VehicleProfile />} /></Routes><LocationProbe />
  </MemoryRouter>;
  await act(async () => root.render(strict ? <React.StrictMode>{app}</React.StrictMode> : app));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
const location = () => container.querySelector('[data-location]')!.textContent;

it('holds the actual route before its UUID provider mounts while the VIN read is pending', async () => {
  let release!: (value: Response) => void;
  const pending = new Promise<Response>(resolve => { release = resolve; });
  await render(vin, () => pending);
  expect(container.textContent).toContain('Resolving VIN');
  expect(fixture.providerAddresses).toEqual([]);
  expect(requests).toHaveLength(1);
  await act(async () => release(json([])));
  expect(container.textContent).toContain('No public vehicle matches this VIN');
  expect(fixture.providerAddresses).toEqual([]);
});

it('normalizes VIN case once and preserves URL context when replacing with the sole public UUID', async () => {
  await render(`${vin.toLowerCase()}?performanceLot=episode#evidence`, () => json([{ id, vin: ` ${vin.toLowerCase()} ` }]));
  expect(requests.map(request => request.url.pathname)).toEqual(['/rest/v1/rpc/vehicle_by_vin_public']);
  expect(requests[0].body).toEqual({ p_vin: vin });
  expect(location()).toBe(`/vehicle/${id}?performanceLot=episode#evidence`);
  expect(fixture.providerAddresses).toEqual([id]);
});

it.each([
  { body: [], status: 200, message: 'No public vehicle matches this VIN' },
  { body: [{ id, vin }, { id: otherId, vin }], status: 200, message: 'More than one public vehicle matches this VIN' },
  { body: { code: '42501', message: 'permission denied' }, status: 403, message: 'The VIN record could not be read' },
  { body: null, status: 200, message: 'The VIN record could not be resolved' },
  { body: [{ id: 'not-a-uuid', vin }], status: 200, message: 'The VIN record could not be resolved' },
  { body: [{ id, vin: otherVin }], status: 200, message: 'The VIN record could not be resolved' },
])('keeps $message outside the UUID-dependent profile', async ({ body, status, message }) => {
  await render(vin, () => json(body, status));
  expect(location()).toBe(`/vehicle/${vin}`);
  expect(container.textContent).toContain(message);
  expect(fixture.providerAddresses).toEqual([]);
  expect(requests).toHaveLength(1);
});

it.each(['resolved', 'missing', 'denied'])('ignores a late %s VIN response after navigation to another UUID', async state => {
  let release!: (value: Response) => void;
  const pending = new Promise<Response>(resolve => { release = resolve; });
  await render(vin, () => pending);
  await act(async () => go(`/vehicle/${otherId}`));
  expect(location()).toBe(`/vehicle/${otherId}`);
  expect(fixture.providerAddresses).toEqual([otherId]);
  await act(async () => release(state === 'resolved' ? json([{ id, vin }]) : state === 'missing' ? json([])
    : json({ code: '42501', message: 'permission denied' }, 403)));
  expect(location()).toBe(`/vehicle/${otherId}`);
  expect(fixture.providerAddresses).toEqual([otherId]);
  expect(container.textContent).not.toContain('VIN record');
});

it('keeps two pending VIN addresses separate when the earlier response arrives late', async () => {
  let releaseA!: (value: Response) => void, releaseB!: (value: Response) => void;
  const a = new Promise<Response>(resolve => { releaseA = resolve; });
  const b = new Promise<Response>(resolve => { releaseB = resolve; });
  await render(vin, body => body.p_vin === vin ? a : b);
  await act(async () => go(`/vehicle/${otherVin}`));
  await act(async () => releaseA(json([{ id, vin }])));
  expect(location()).toBe(`/vehicle/${otherVin}`);
  expect(container.textContent).toContain('Resolving VIN');
  expect(fixture.providerAddresses).toEqual([]);
  await act(async () => releaseB(json([{ id: otherId, vin: otherVin }])));
  expect(location()).toBe(`/vehicle/${otherId}`);
  expect(fixture.providerAddresses).toEqual([otherId]);
  expect(requests).toHaveLength(2);
});

it('coalesces StrictMode VIN lookups without mounting the provider under the VIN', async () => {
  await render(vin, () => json([{ id, vin }]), true);
  expect(requests).toHaveLength(1);
  expect(location()).toBe(`/vehicle/${id}`);
  expect(new Set(fixture.providerAddresses)).toEqual(new Set([id]));
});

it('starts a fresh pending visit when returning to a previously refused VIN address', async () => {
  let release!: (value: Response) => void;
  const pending = new Promise<Response>(resolve => { release = resolve; });
  let reads = 0;
  await render(vin, () => ++reads === 1 ? json([]) : pending);
  expect(container.textContent).toContain('No public vehicle matches this VIN');
  await act(async () => go(`/vehicle/${otherId}`));
  await act(async () => go(`/vehicle/${vin}`));
  expect(container.textContent).toContain('Resolving VIN');
  expect(container.textContent).not.toContain('No public vehicle matches this VIN');
  await act(async () => release(json([{ id, vin }])));
  expect(location()).toBe(`/vehicle/${id}`);
  expect(fixture.providerAddresses).toEqual([otherId, id]);
});

it('leaves direct UUID mounting unchanged without a VIN lookup', async () => {
  await render(id, () => { throw new Error('UUID route must not resolve a VIN'); });
  expect(requests).toEqual([]);
  expect(fixture.providerAddresses).toEqual([id]);
});
