// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ user: { id: 'owner-a', is_anonymous: false } as { id: string; is_anonymous: boolean } | null,
  rpc: vi.fn(), signals: [] as AbortSignal[] }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: fixture.user }) }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: (name: string, args: unknown) => ({ abortSignal: (signal: AbortSignal) => {
  fixture.signals.push(signal); return fixture.rpc(name, args);
} }) } }));
import HarnessObservationWitness, { readHarnessWitness } from './HarnessObservationWitness';
function witness(extra = {}) { return { schema_version: 1, visibility: 'vehicle_owner', vehicle_id: 'vehicle-a', observation_id: 'observation-a',
  kind: 'specification', historical: false, content_text: 'Retained private wiring claim <script>not executable</script>', citation_excerpt: 'Cited source excerpt',
  citation_page_number: 4, observed_at: '2026-11-20T12:00:00Z', ingested_at: '2026-11-21T12:00:00Z',
  source: { display_name: 'Maker document' }, source_url: 'https://example.com/maker.pdf', confidence_score: 0.6,
  claim: { value: 'Recorded terminal requirement', state: 'open', order: 'UNPROJECTED ORDER' },
  evidence_edges: [{ id: 'edge-a', observation_id: 'observation-a', row_kind: 'termination', row_id: 'end-a', field: 'terminal', relation: 'needs_bench', target_revision: 'current_record' }], ...extra }; }
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.user = { id: 'owner-a', is_anonymous: false }; fixture.signals = []; fixture.rpc.mockReset(); fixture.rpc.mockResolvedValue({ data: witness(), error: null });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(vehicleId = 'vehicle-a', observationId = 'observation-a') {
  await act(async () => root.render(<MemoryRouter><HarnessObservationWitness vehicleId={vehicleId} observationId={observationId} /></MemoryRouter>));
}
it('renders exact owner-qualified testimony as text with an external reference, never an artifact image', async () => {
  await render();
  expect(fixture.rpc).toHaveBeenCalledWith('harness_evidence_witness', { p_vehicle_id: 'vehicle-a', p_observation_id: 'observation-a' });
  expect(host.textContent).toContain('Retained private wiring claim <script>not executable</script>');
  expect(host.textContent).toContain('Cited source excerpt'); expect(host.textContent).toContain('Cited page 4');
  expect(host.textContent).toContain('verification unassessed'); expect(host.textContent).toContain('needs bench');
  expect(host.textContent).not.toContain('UNPROJECTED ORDER'); expect(host.querySelector('script,img,iframe')).toBeNull();
  expect(host.querySelector('a')!.getAttribute('href')).toBe('https://example.com/maker.pdf');
  expect(host.querySelector('a')!.getAttribute('rel')).toBe('noopener noreferrer');
});
it.each([{ visibility: 'public' }, { vehicle_id: 'foreign-vehicle' }, { observation_id: 'foreign-observation' },
  { historical: undefined }, { evidence_edges: [] }, { kind: 'condition' }, { schema_version: 2 },
  { evidence_edges: [{ id: 'edge-a', observation_id: 'foreign-observation', row_kind: 'termination', row_id: 'end-a', relation: 'supports', target_revision: 'current_record' }] },
])('refuses an unqualified source projection: %j', async invalid => {
  fixture.rpc.mockResolvedValue({ data: witness(invalid), error: null }); await render();
  expect(host.textContent).toContain('not available for this account or record'); expect(host.textContent).not.toContain('Retained private wiring claim');
});
it('keeps historical observation and retained target qualifications separate', async () => {
  fixture.rpc.mockResolvedValue({ data: witness({ historical: true, superseded_by: 'successor-a',
    evidence_edges: [{ id: 'edge-a', observation_id: 'observation-a', row_kind: 'termination', row_id: 'end-a', field: null, relation: 'supports', target_revision: 'superseded' }] }), error: null });
  await render(); expect(host.textContent).toContain('Historical observation'); expect(host.textContent).toContain('retained target record');
  expect(host.textContent).toContain('does not establish support for the current design');
  expect(host.querySelector('a[href="/vehicle/vehicle-a/observation/successor-a"]')).not.toBeNull();
});
it.each([null, { id: 'anonymous-owner-id', is_anonymous: true }])('does not request owner prose for a public or anonymous session: %j', async user => {
  fixture.user = user; await render(); expect(fixture.rpc).not.toHaveBeenCalled(); expect(host.textContent).toContain('Sign in as the vehicle owner');
});
it('clears source text immediately on logout and ignores late previous-account completion', async () => {
  let finish: (value: unknown) => void = () => {};
  await render(); expect(host.textContent).toContain('Retained private wiring claim');
  fixture.user = { id: 'owner-b', is_anonymous: false }; fixture.rpc.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await render(); expect(host.textContent).not.toContain('Retained private wiring claim');
  fixture.user = null; await render(); expect(fixture.signals.at(-1)?.aborted).toBe(true);
  await act(async () => finish({ data: witness(), error: null }));
  expect(host.textContent).not.toContain('Retained private wiring claim'); expect(host.textContent).toContain('Sign in as the vehicle owner');
});
it('clears prior subject data and refuses a stale completion when the observation changes', async () => {
  let finish: (value: unknown) => void = () => {};
  fixture.rpc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await render();
  fixture.rpc.mockResolvedValue({ data: null, error: null }); await render('vehicle-a', 'observation-b');
  await act(async () => finish({ data: witness(), error: null }));
  expect(host.textContent).not.toContain('Retained private wiring claim'); expect(host.textContent).toContain('not available for this account or record');
});
it('keeps reader errors generic and allows a deliberate retry', async () => {
  fixture.rpc.mockResolvedValue({ data: null, error: { message: 'PRIVATE internal SQL' } }); await render();
  expect(host.textContent).toContain('could not be read'); expect(host.textContent).not.toContain('PRIVATE');
  fixture.rpc.mockResolvedValue({ data: witness(), error: null }); await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
  expect(host.textContent).toContain('Retained private wiring claim');
});
it.each(['javascript:alert(1)', 'http://example.com/a', 'https://user:secret@example.com/a'])('does not link an unsafe source reference: %s', source_url => {
  expect(readHarnessWitness(witness({ source_url }), 'vehicle-a', 'observation-a')!.source_url).toBeNull();
});
