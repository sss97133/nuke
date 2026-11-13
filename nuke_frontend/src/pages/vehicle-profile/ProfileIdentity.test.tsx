// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
import ProfileIdentity, { modelIdentityArtwork } from './ProfileIdentity';
const id = '10000000-0000-4000-8000-000000000001', other = '10000000-0000-4000-8000-000000000002';
const path = '/stacks/makes/emblems/k5-blazer-reference-pair-924a1de7d4cb.svg';
function response(vehicleId = id) {
  return { vehicle_id: vehicleId, marks: [{ identity_mark_id: 'mark', kind: 'model_wordmark', label: 'K5 Blazer', assets: [
    { id: 'source', identity_mark_id: 'mark', asset_kind: 'source', review_state: 'usable' },
    { id: 'vector', identity_mark_id: 'mark', source_asset_id: 'source', asset_kind: 'vector', review_state: 'usable',
      applicability_evidence: 'OER *157532 catalogue:1975–80 Chevrolet K5 Blazer', asset_path: path, width: 800, height: 325,
      source_context: 'Traced OER reproduction artwork, not evidence of actual installation.' },
  ] }] };
}
it('requires the exact vehicle/model, original-backed usable vector and qualified local path', () => {
  expect(modelIdentityArtwork(response(), id, 'K5 Blazer')?.path).toBe(path);
  expect(modelIdentityArtwork(response(), other, 'K5 Blazer')).toBeNull();
  expect(modelIdentityArtwork(response(), id, 'C10')).toBeNull();
  for (const change of [(r: any) => { r.marks[0].assets[0].review_state = 'withdrawn'; },
    (r: any) => { r.marks[0].assets[1].review_state = 'draft'; },
    (r: any) => { r.marks[0].assets[1].asset_path = 'https://evil.test/art.svg'; },
    (r: any) => { r.marks[0].assets[1].applicability_evidence = ''; },
    (r: any) => { r.marks.push(r.marks[0]); }]) {
    const r = response(); change(r); expect(modelIdentityArtwork(r, id, 'K5 Blazer')).toBeNull();
  }
});
it('replaces the model once, keeps exploration and text on image failure, and rejects a late prior-vehicle response', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'), root = createRoot(host), explore = vi.fn();
  let resolveFirst: (value: any) => void;
  fixture.rpc.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
  const render = (vehicleId: string) => root.render(<ProfileIdentity vehicleId={vehicleId} make="Chevrolet" model="K5 Blazer" year={1977} compact onExplore={explore} />);
  try {
    await act(async () => render(id));
    expect(host.querySelector('img')).toBeNull();
    fixture.rpc.mockResolvedValue({ data: response(other), error: null });
    await act(async () => render(other));
    expect(host.querySelector('img')?.getAttribute('src')).toBe(path);
    await act(async () => resolveFirst!({ data: { ...response(), marks: [] }, error: null }));
    expect(host.querySelector('img')?.getAttribute('src')).toBe(path);
    expect(host.querySelectorAll('button[aria-label="Explore K5 Blazer in this profile"]')).toHaveLength(1);
    await act(async () => (host.querySelector('button[aria-label="Explore K5 Blazer in this profile"]') as HTMLButtonElement).click());
    expect(explore).toHaveBeenCalledWith('model', 'K5 Blazer');
    await act(async () => host.querySelector('img')!.dispatchEvent(new Event('error')));
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('.vehicle-identity__model')?.textContent).toBe('K5 Blazer');
  } finally { await act(async () => root.unmount()); }
});
it('empty or failed catalogue reads keep readable identity', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'), root = createRoot(host);
  try {
    fixture.rpc.mockResolvedValueOnce({ data: { vehicle_id: id, marks: [] }, error: null });
    await act(async () => root.render(<ProfileIdentity vehicleId={id} make="Chevrolet" model="K5 Blazer" year={1977} compact />));
    expect(host.querySelector('.vehicle-identity__model')?.textContent).toBe('K5 Blazer');
    fixture.rpc.mockRejectedValueOnce(Error('unavailable'));
    await act(async () => root.render(<ProfileIdentity vehicleId={other} make="Chevrolet" model="K5 Blazer" year={1977} compact />));
    expect(host.querySelector('.vehicle-identity__model')?.textContent).toBe('K5 Blazer');
    expect(host.querySelector('img')).toBeNull();
  } finally { await act(async () => root.unmount()); }
});
