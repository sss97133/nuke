// @vitest-environment jsdom
import React, { act, StrictMode, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Link, MemoryRouter, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  reader: vi.fn(), getSession: vi.fn(), cached: null as unknown,
  listeners: new Set<(event: string, session: unknown) => void>(),
}));
vi.mock('../../utils/cachedSession', () => ({ readCachedSession: () => fixture.cached }));
vi.mock('../../lib/supabase', () => ({ supabase: {
  auth: { getSession: fixture.getSession, onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
    fixture.listeners.add(callback); return { data: { subscription: { unsubscribe: () => fixture.listeners.delete(callback) } } };
  } },
  from: () => { const query = { select: () => query, eq: () => query, order: fixture.reader }; return query; },
} }));
import { AuthProvider } from '../../contexts/AuthContext';
import { useOwnershipVerification } from '../../hooks/useOwnershipVerification';
import { AppLayoutProvider, useAppLayoutContext } from '../layout/AppLayoutContext';
import { ViewerWorkspace } from './ViewerWorkspace';

const session = (id: string, token = 'initial') => ({ user: { id }, access_token: token });
const result = (label: string) => ({ data: [{ id: label }], error: null });
const clients = new Set<QueryClient>();
let root: Root, host: HTMLDivElement;
function Probe() {
  const client = useQueryClient();
  useEffect(() => { clients.add(client); }, [client]);
  const { data } = useOwnershipVerification('synthetic-vehicle');
  const location = useLocation();
  const [draft, setDraft] = useState('');
  const { vehicleTabs, openVehicleTab } = useAppLayoutContext();
  return <><output aria-label="URL">{location.pathname + location.search}</output>
    <output aria-label="Private result">{JSON.stringify(data)}</output>
    <label>Draft<input value={draft} onChange={event => setDraft(event.target.value)} /></label>
    <button onClick={() => openVehicleTab({ vehicleId: 'synthetic-vehicle', title: 'Private vehicle tab' })}>Open tab</button>
    <output aria-label="Vehicle tabs">{vehicleTabs.map(tab => tab.title).join(', ')}</output>
    <Link to="/next?tab=records">Next route</Link></>;
}
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); };
const mount = async (child: React.ReactNode = <Probe />, strict = false) => {
  const tree = <AuthProvider><MemoryRouter initialEntries={['/providers/example?tab=work']}>
    <ViewerWorkspace fallback={<p role="status">Loading session</p>}><AppLayoutProvider>{child}</AppLayoutProvider></ViewerWorkspace>
  </MemoryRouter></AuthProvider>;
  await act(async () => root.render(strict ? <StrictMode>{tree}</StrictMode> : tree)); await settle();
};
const emit = async (event: string, currentSession: unknown) => { await act(async () => { fixture.listeners.forEach(callback => callback(event, currentSession)); }); await settle(); };
const output = (label: string) => host.querySelector(`output[aria-label="${label}"]`)?.textContent;
const draft = async (value: string) => { await act(async () => { const input = host.querySelector('input')!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }); };

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); fixture.cached = null; fixture.listeners.clear(); clients.clear();
  fixture.getSession.mockReset().mockResolvedValue({ data: { session: session('A') } }); fixture.reader.mockReset().mockResolvedValue(result('PRIVATE A'));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it('gives a new viewer fresh existing-hook data and clears old local and shell state without changing the URL', async () => {
  await mount(); await draft('private draft'); await act(async () => host.querySelector('button')!.click());
  const priorClient = [...clients][0]; expect(output('Private result')).toContain('PRIVATE A'); expect(output('Vehicle tabs')).toContain('Private vehicle tab');
  let finish!: (value: unknown) => void; fixture.reader.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await emit('SIGNED_IN', session('B'));
  expect(output('Private result')).not.toContain('PRIVATE A'); expect(host.querySelector('input')?.value).toBe(''); expect(output('Vehicle tabs')).toBe('');
  expect(output('URL')).toBe('/providers/example?tab=work'); expect(clients.size).toBe(2); expect(priorClient.getQueryCache().getAll()).toHaveLength(0);
  await act(async () => finish(result('B RESULT'))); await settle(); expect(output('Private result')).toContain('B RESULT'); expect(fixture.reader).toHaveBeenCalledTimes(2);
});

it('does not reuse old cached data across signout and later sign-in to the same account', async () => {
  await mount(); fixture.reader.mockResolvedValueOnce({ data: [], error: null }); await emit('SIGNED_OUT', null);
  expect(output('Private result')).not.toContain('PRIVATE A'); fixture.reader.mockResolvedValueOnce(result('FRESH A')); await emit('SIGNED_IN', session('A'));
  expect(output('Private result')).toContain('FRESH A'); expect(output('Private result')).not.toContain('PRIVATE A'); expect(fixture.reader).toHaveBeenCalledTimes(3); expect(clients.size).toBe(3);
});

it('keeps the same client and drafts for same-ID token refresh and sign-in notifications', async () => {
  await mount(); await draft('keep my draft'); await emit('TOKEN_REFRESHED', session('A', 'fresh')); await emit('SIGNED_IN', session('A', 'newer'));
  expect(host.querySelector('input')?.value).toBe('keep my draft'); expect(fixture.reader).toHaveBeenCalledTimes(1); expect(clients.size).toBe(1);
  expect([...clients][0].getDefaultOptions().queries).toMatchObject({ staleTime: 300000, retry: 1 });
});

it('keeps ordinary public navigation inside the same viewer workspace', async () => {
  await mount(); await draft('route draft'); await act(async () => (host.querySelector('a') as HTMLAnchorElement).click());
  expect(output('URL')).toBe('/next?tab=records'); expect(host.querySelector('input')?.value).toBe('route draft'); expect(clients.size).toBe(1); expect(fixture.reader).toHaveBeenCalledTimes(1);
});

it('discards a late query from a former viewer even when its reader ignores cancellation', async () => {
  let finish!: (value: unknown) => void; fixture.reader.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await mount();
  fixture.reader.mockResolvedValueOnce(result('B RESULT')); await emit('SIGNED_IN', session('B')); await act(async () => finish(result('PRIVATE LATE A'))); await settle();
  expect(output('Private result')).toContain('B RESULT'); expect(output('Private result')).not.toContain('PRIVATE LATE A');
});

it('waits for existing auth readiness without mounting queries or redirecting the requested URL', async () => {
  let finish!: (value: unknown) => void; fixture.getSession.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await mount();
  expect(host.textContent).toBe('Loading session'); expect(fixture.reader).not.toHaveBeenCalled();
  await act(async () => finish({ data: { session: null } })); await settle(); expect(output('URL')).toBe('/providers/example?tab=work'); expect(fixture.reader).toHaveBeenCalledTimes(1);
});

it('preserves cached-session startup and survives StrictMode effect replay', async () => {
  fixture.cached = session('A'); fixture.getSession.mockImplementation(() => new Promise(() => {})); await mount(<Probe />, true);
  expect(output('Private result')).toContain('PRIVATE A'); expect([...clients][0].getQueryData(['ownership-verification', 'synthetic-vehicle'])).toEqual([{ id: 'PRIVATE A' }]);
  await draft('strict draft'); await emit('TOKEN_REFRESHED', session('A', 'fresh')); expect(host.querySelector('input')?.value).toBe('strict draft'); expect(clients.size).toBe(1); expect(fixture.reader).toHaveBeenCalledTimes(1);
});

it('aborts signal-aware work on disposal without aborting the new viewer request', async () => {
  const signals: AbortSignal[] = [];
  function SlowRead() { useQuery({ queryKey: ['slow'], queryFn: ({ signal }) => { signals.push(signal); return new Promise(() => {}); } }); return <p>Pending reader</p>; }
  await mount(<SlowRead />); expect(signals[0].aborted).toBe(false); await emit('SIGNED_IN', session('B'));
  expect(signals[0].aborted).toBe(true); expect(signals[1].aborted).toBe(false);
});
