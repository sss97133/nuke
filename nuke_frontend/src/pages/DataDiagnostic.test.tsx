// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';

const fixture = vi.hoisted(() => ({
  session: { user: { id: 'viewer-a' } } as { user: { id: string } } | null,
  result: { data: [] as unknown[], error: null as null | { message: string } },
  read: vi.fn(), filters: [] as unknown[][], limits: [] as number[],
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ session: fixture.session }) }));
vi.mock('../hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('../components/ImageTrackingBackfill', () => ({ default: () => <p>Existing advanced tools</p> }));
vi.mock('../components/PrefetchLink', () => ({ PrefetchLink: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));
vi.mock('../lib/supabase', () => ({ supabase: { from: () => {
  const q = {
    select: () => q,
    eq: (...args: unknown[]) => { fixture.filters.push(args); return q; },
    order: () => q,
    limit: (n: number) => { fixture.limits.push(n); return q; },
    then: (resolve: (value: unknown) => unknown) => fixture.read().then(resolve),
  }; return q;
} } }));
import DataDiagnostic from './DataDiagnostic';
let host: HTMLDivElement, root: Root;
const backup = '[{"id":"local-one","year":1980,"make":"Synthetic","model":"Retained"}]';
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fixture.session = { user: { id: 'viewer-a' } }; fixture.result = { data: [], error: null };
  fixture.filters = []; fixture.limits = []; fixture.read.mockReset().mockImplementation(async () => fixture.result);
  const storage = new Map<string, string>([['anonymousVehicles', backup]]);
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key), clear: () => storage.clear() });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(<DataDiagnostic />)); }
const button = (text: string) => [...host.querySelectorAll('button')].find(e => e.textContent === text)!;

describe('retained browser and saved vehicle diagnostic', () => {
  it('bounds the owner read and distinguishes loaded records from all vehicles', async () => {
    fixture.result.data = Array.from({ length: 101 }, (_, n) => ({ id: `saved-${n}`, year: 1990, make: 'Synthetic' }));
    await render();
    expect(fixture.filters).toEqual([['user_id', 'viewer-a']]); expect(fixture.limits).toEqual([101]);
    expect(host.textContent).toContain('Showing the first 100 matching saved vehicles.');
    expect(host.querySelectorAll('a[href^="/vehicle/saved-"]')).toHaveLength(100);
    expect(host.querySelector('a[href="/vehicle/list"]')).not.toBeNull();
    expect(localStorage.getItem('anonymousVehicles')).toBe(backup);
    expect(host.textContent).not.toContain('Clear localStorage');
  });
  it('reports a reader failure without claiming an empty cloud', async () => {
    fixture.result = { data: [], error: { message: 'not readable' } }; await render();
    expect(host.querySelector('[role=alert]')?.textContent).toContain('count is unknown');
    expect(host.textContent).not.toContain('No saved vehicles matched');
    expect(host.textContent).toContain('1 retained browser record.');
  });
  it.each(['not-json', '{"wrong":"shape"}', '[null]'])('preserves unreadable browser bytes: %s', async raw => {
    localStorage.setItem('anonymousVehicles', raw); await render();
    expect(host.textContent).toContain('Browser vehicle data could not be read');
    expect(button('Download browser backup').disabled).toBe(false);
    expect(localStorage.getItem('anonymousVehicles')).toBe(raw);
  });
  it('downloads a reversible recovery envelope, including malformed Unicode, without deleting or syncing', async () => {
    vi.useFakeTimers();
    const raw = 'invalid original ' + String.fromCharCode(0xd800) + ' value'; localStorage.setItem('anonymousVehicles', raw);
    vi.stubGlobal('Blob', NodeBlob);
    const createObjectURL = vi.fn((_blob: NodeBlob) => 'blob:synthetic');
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await render(); await act(async () => { button('Download browser backup').click(); vi.runAllTimers(); });
    const held = createObjectURL.mock.calls[0][0] as NodeBlob;
    expect(JSON.parse(await held.text())).toEqual({ format: 'nuke-browser-vehicles-backup/v1', storage_key: 'anonymousVehicles', value: raw });
    expect(click).toHaveBeenCalledOnce();
    expect(localStorage.getItem('anonymousVehicles')).toBe(raw);
    expect(fixture.read).toHaveBeenCalledOnce();
  });
  it('discards late private reads when the viewer changes', async () => {
    let prior!: (value: unknown) => void;
    fixture.read.mockImplementationOnce(() => new Promise(resolve => { prior = resolve; }));
    await render(); fixture.session = { user: { id: 'viewer-b' } }; await render();
    await act(async () => prior({ data: [{ id: 'a-private', make: 'Prior account' }], error: null }));
    expect(host.textContent).not.toContain('Prior account');
    expect(fixture.filters).toEqual([['user_id', 'viewer-a'], ['user_id', 'viewer-b']]);
  });
  it('leaves saved counts unknown while signed out and makes no private query', async () => {
    fixture.session = null; await render(); expect(fixture.read).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Count unknown until you sign in.');
    expect(host.querySelector('a[href^="/login?returnUrl="]')).not.toBeNull();
  });
});
