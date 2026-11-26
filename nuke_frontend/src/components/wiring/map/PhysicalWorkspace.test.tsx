// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ rpc: vi.fn(), session: null as { user: { id: string } } | null }));
vi.mock('../../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ session: fixture.session }) }));
vi.mock('../../../hooks/useVehiclePermissions', () => ({ useVehiclePermissions: () => ({ isOwner: false }) }));
import { PhysicalWorkspace } from './PhysicalWorkspace';
import { physicalWorkspaceFixture } from './physicalWorkspace.fixture';
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.session = null; fixture.rpc.mockReset(); fixture.rpc.mockResolvedValue({ data: physicalWorkspaceFixture(), error: null });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
function NavigationProbe() { const location = useLocation(); return <output data-testid="location">{location.pathname}</output>; }
async function render(id = 'vehicle-a', query = '') {
  await act(async () => { root.render(<MemoryRouter initialEntries={[`/${query}`]}><PhysicalWorkspace vehicleId={id} /><NavigationProbe /></MemoryRouter>); });
}
const click = async (selector: string) => act(async () => host.querySelector<HTMLButtonElement>(selector)!.click());
it('reads once through the physical RPC and opens actual piece/end/mate records', async () => {
  await render();
  expect(fixture.rpc).toHaveBeenCalledWith('harness_schematic_model', { p_vehicle_id: 'vehicle-a' });
  expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
  await click('tbody tr button');
  const detail = host.querySelector('.hw-inspector')!;
  expect(detail.textContent).toContain('Declared connector mate: CABIN ↔ ENGINE');
  expect(detail.querySelectorAll('.hw-related-list button')).toHaveLength(2);
  expect(detail.textContent).toContain('unbound');
  expect(detail.textContent).not.toContain('PRIVATE');
  await click('.hw-end-pair button');
  expect(host.querySelector('.hw-inspector')!.textContent).toContain('Specified parts and tool');
});
it('keeps legacy circuit links inspectable without claiming PASS is current', async () => {
  await render('vehicle-a', '?sel=w%3A110');
  const detail = host.querySelector('.hw-inspector')!;
  expect(detail.textContent).toContain('Circuit source');
  expect(detail.textContent).toContain('unbound');
  expect(detail.textContent).not.toContain('RIGHT');
  expect(detail.textContent).toContain('not bound to a complete current electrical validation');
});
it('sorts numeric planned lengths without collapsing pieces', async () => {
  await render();
  const button = [...host.querySelectorAll<HTMLButtonElement>('th button')].find(b => b.textContent === 'Planned length (ft)')!;
  await act(async () => { button.click(); });
  await act(async () => { button.click(); });
  expect(host.querySelector('tbody tr')!.textContent).toContain('3.54');
  expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
});
it('clears previous data if the vehicle changes to an unavailable read', async () => {
  await render(); expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
  fixture.rpc.mockResolvedValue({ data: null, error: null });
  await render('vehicle-b');
  expect(host.querySelector('table')).toBeNull();
  expect(host.textContent).toContain('Harness unavailable');
});
it('refetches and clears the signed-in read after logout', async () => {
  fixture.session = { user: { id: 'owner-user' } };
  await render(); expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
  fixture.session = null;
  fixture.rpc.mockImplementation(() => new Promise(() => {}));
  await render();
  expect(fixture.rpc).toHaveBeenCalledTimes(2);
  expect(host.querySelector('table')).toBeNull();
  expect(host.textContent).toContain('Reading the physical harness');
});
it('draws only two physical pieces plus the declared mate from the same read', async () => {
  await render();
  const diagram = [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Diagram')!;
  await act(async () => diagram.click());
  expect(host.querySelectorAll('[data-segment-id]')).toHaveLength(2);
  expect(host.querySelectorAll('[data-mating="connector"]')).toHaveLength(1);
  const cavityLines = [...host.querySelectorAll('[data-termination-id="end-3"] tspan')].map(n => n.textContent).join(' ');
  expect(cavityLines).toBe('signal (pin letter unknown until drawing is read)');
  const selected = host.querySelector<SVGGElement>('[data-segment-id="piece-1-unique"]')!;
  await act(async () => selected.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(host.querySelector('.hw-inspector')!.textContent).toContain('piece-1-');
  expect(host.querySelector('.hw-inspector')!.textContent).toContain('signal (pin letter unknown until drawing is read)');
  expect(fixture.rpc).toHaveBeenCalledTimes(1);
});
function mixedPlanFixture() {
  const data = physicalWorkspaceFixture();
  data.segments.push(
    { ...data.segments[0], id: 'candidate-piece', design_status: 'candidate', in_current_plan: false },
    { ...data.segments[0], id: 'contradicted-piece', design_status: 'contradicted', in_current_plan: false },
    { ...data.segments[0], id: 'retained-built-piece', design_status: 'decided', in_current_plan: false,
      build_state: 'cut', physical_progress: true, blockers: ['physical_revision_hold'] },
  );
  data.counts.physical_segments = 5;
  data.counts.segments_with_material_blockers = 1;
  return data;
}
async function selectScope(value: string) {
  await act(async () => { const select = host.querySelector<HTMLSelectElement>('[aria-label="Record filter"]')!;
    select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
}
it('defaults to database current-plan membership and exposes alternative design states explicitly', async () => {
  fixture.rpc.mockResolvedValue({ data: mixedPlanFixture(), error: null });
  await render();
  expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
  expect(host.querySelector('tbody')!.textContent).not.toMatch(/candidate|contradicted|retained-/);
  expect(host.querySelectorAll('th')[1].textContent).toBe('Design state');
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Record filter"]')!.value).toBe('current_plan');
  await selectScope('alternatives');
  expect(host.querySelectorAll('tbody tr')).toHaveLength(3);
  expect(host.querySelector('tbody')!.textContent).toContain('candidate');
  expect(host.querySelector('tbody')!.textContent).toContain('contradicted');
  await selectScope('all');
  expect(host.querySelectorAll('tbody tr')).toHaveLength(5);
});
it('opens retained built holds from the issue summary despite the current-plan default', async () => {
  fixture.rpc.mockResolvedValue({ data: mixedPlanFixture(), error: null });
  await render();
  const summary = [...host.querySelectorAll<HTMLButtonElement>('.hw-summary button')].find(b => b.textContent?.includes('material / revision issues'))!;
  await act(async () => summary.click());
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Record filter"]')!.value).toBe('blocked');
  expect(host.querySelectorAll('tbody tr')).toHaveLength(1);
  expect(host.querySelector('tbody')!.textContent).toContain('cut');
  await click('tbody tr button');
  expect(host.querySelector('.hw-inspector')!.textContent).toContain('physical revision hold');
  expect(host.querySelector('.hw-inspector')!.textContent).toContain('Outside current plan');
});
it('keeps a linked alternative inspectable while the table defaults to the current plan', async () => {
  fixture.rpc.mockResolvedValue({ data: mixedPlanFixture(), error: null });
  await render('vehicle-a', '?records=segments&record=contradicted-piece');
  expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
  expect(host.querySelector('.hw-inspector')!.textContent).toContain('contradicted');
  expect(host.querySelector('.hw-inspector')!.textContent).toContain('Outside current plan');
  expect(host.querySelector('.hw-filter-note')!.textContent).toContain('outside these filters');
  await click('.hw-filter-note button');
  expect(host.querySelectorAll('tbody tr')).toHaveLength(5);
  expect(host.querySelector('.hw-selected-row')!.textContent).toContain('contradicted');
});
async function search(value: string) {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>('[aria-label="Search harness records"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it('prioritizes exact circuit codes and avoids hidden ID/source substrings', async () => {
  const data = physicalWorkspaceFixture();
  data.circuits.push({ ...data.circuits[0], id: 'circuit-110g', circuit_code: '110g', circuit_name: 'Ground return' },
    { ...data.circuits[0], id: 'circuit-3', circuit_code: '3', circuit_name: 'Auxiliary power' });
  data.segments.push({ ...data.segments[0], id: 'cafebabe-0110-4000-8000-111111111111', circuit_id: 'circuit-3', current_circuit_id: 'circuit-3' },
    { ...data.segments[0], id: 'return-piece', circuit_id: 'circuit-110g', current_circuit_id: 'circuit-110g' });
  data.counts.physical_segments = 4; data.counts.current_plan_segments = 4;
  fixture.rpc.mockResolvedValue({ data, error: null });
  await render();
  expect(host.querySelectorAll('th')[2].textContent).toBe('Material / revision');
  await search('110');
  expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
  expect(host.querySelector('tbody')!.textContent).not.toContain('Ground return');
  expect(host.querySelector('tbody')!.textContent).not.toContain('Auxiliary power');
  await search('110G');
  expect(host.querySelectorAll('tbody tr')).toHaveLength(1);
  expect(host.querySelector('tbody')!.textContent).toContain('Ground return');
  await search('PRIVATE'); expect(host.querySelectorAll('tbody tr')).toHaveLength(0);
  await search('cafebabe');
  expect(host.querySelectorAll('tbody tr')).toHaveLength(1);
  expect(host.querySelector('tbody')!.textContent).toContain('Auxiliary power');
  await search('M22759/16-22-42'); expect(host.querySelectorAll('tbody tr')).toHaveLength(4);
});
it('shows expected material reference and wire type while the catalog key is missing', async () => {
  const data = physicalWorkspaceFixture();
  data.segments[0] = { ...data.segments[0], wire_part_id: null, part_number: null, blockers: ['catalog_part_missing'] };
  fixture.rpc.mockResolvedValue({ data, error: null });
  await render(); await click('tbody tr button');
  const detail = host.querySelector('.hw-inspector')!;
  const field = (name: string) => [...detail.querySelectorAll('.hw-field')].find(f => f.querySelector('dt')?.textContent === name)!.querySelector('dd')!.textContent;
  expect(field('Catalog wire part')).toBe('Not recorded');
  expect(field('Expected material reference')).toBe('M22759/16-22-42');
  expect(field('Source wire specification')).toBe('M22759/16');
  expect(detail.textContent).toContain('catalog part missing');
});
it.each([
  ['segments', 'piece-0-unique', 'segment'], ['ends', 'end-0', 'termination'],
  ['endpoints', 'endpoint-0', 'endpoint'],
] as const)('links only the exact %s record evidence to the existing access-checked observation viewer', async (table, id, kind) => {
  const data = physicalWorkspaceFixture();
  data.evidence_edges = [
    { id: 'edge-match', observation_id: 'observation-witness', row_kind: kind, row_id: id, field: 'cavity', relation: 'needs_bench' },
    { id: 'edge-other-row', observation_id: 'unrelated-witness', row_kind: kind, row_id: 'other-row', field: null, relation: 'supports' },
    { id: 'edge-other-kind', observation_id: 'different-kind-witness', row_kind: 'net', row_id: id, field: null, relation: 'supports' },
  ];
  fixture.rpc.mockResolvedValue({ data, error: null });
  await render('vehicle-a', `?records=${table}&record=${id}`);
  const detail = host.querySelector('.hw-inspector')!;
  const links = detail.querySelectorAll<HTMLAnchorElement>('.hw-evidence-list a');
  expect(links).toHaveLength(1);
  expect(links[0].getAttribute('href')).toBe('/vehicle/vehicle-a/observation/observation-witness');
  expect(detail.textContent).toContain('needs bench · cavity');
  expect(detail.textContent).toContain('checks access to each observation');
  expect(detail.textContent).toContain('source text and artifacts may be withheld there');
  expect(fixture.rpc).toHaveBeenCalledTimes(1);
  await act(async () => links[0].click());
  expect(host.querySelector('[data-testid="location"]')!.textContent).toBe('/vehicle/vehicle-a/observation/observation-witness');
});
it('follows actual circuit pieces to distinct net and signal IDs without treating a circuit as a signal', async () => {
  const data = physicalWorkspaceFixture(), circuit = data.circuits[0], signal = data.signals[0], net = data.nets[0];
  expect(circuit.id).not.toBe(signal.id);
  data.signals.push({ ...signal, id: 'unrelated-signal-same-name' });
  data.evidence_edges = [
    { id: 'net-edge', observation_id: 'net-witness', row_kind: 'net', row_id: net.id, field: null, relation: 'supports' },
    { id: 'signal-edge', observation_id: 'signal-witness', row_kind: 'signal', row_id: signal.id, field: null, relation: 'open' },
    { id: 'false-circuit-edge', observation_id: 'false-circuit-witness', row_kind: 'signal', row_id: circuit.id, field: null, relation: 'supports' },
    { id: 'false-kind-edge', observation_id: 'false-kind-witness', row_kind: 'segment', row_id: signal.id, field: null, relation: 'supports' },
    { id: 'unrelated-signal-edge', observation_id: 'unrelated-witness', row_kind: 'signal', row_id: 'unrelated-signal-same-name', field: null, relation: 'supports' },
  ];
  fixture.rpc.mockResolvedValue({ data, error: null });
  await render('vehicle-a', `?records=circuits&record=${circuit.id}`);
  const detail = host.querySelector('.hw-inspector')!;
  expect([...detail.querySelectorAll<HTMLAnchorElement>('.hw-evidence-list a')].map(a => a.getAttribute('href'))).toEqual([
    '/vehicle/vehicle-a/observation/net-witness', '/vehicle/vehicle-a/observation/signal-witness',
  ]);
  expect(detail.textContent).toContain('Related net 110');
  expect(detail.textContent).toContain('Related signal Coolant temperature');
  await act(async () => detail.querySelectorAll<HTMLAnchorElement>('.hw-evidence-list a')[1].click());
  expect(host.querySelector('[data-testid="location"]')!.textContent).toBe('/vehicle/vehicle-a/observation/signal-witness');
});
it('does not credit a retained old piece or its evidence to a successor circuit', async () => {
  const data = physicalWorkspaceFixture(), successor = { ...data.circuits[0], id: 'successor-circuit' };
  data.circuits[0].is_superseded = true; data.circuits[0].superseded_by = successor.id;
  data.circuits.push(successor);
  data.segments.forEach(s => { s.current_circuit_id = successor.id; s.in_current_plan = false; });
  data.evidence_edges = [{ id: 'retained-edge', observation_id: 'retained-witness', row_kind: 'signal', row_id: data.signals[0].id, field: null, relation: 'supports' }];
  fixture.rpc.mockResolvedValue({ data, error: null });
  await render('vehicle-a', `?records=circuits&record=${successor.id}`);
  const detail = host.querySelector('.hw-inspector')!;
  expect(detail.textContent).toContain('No physical piece is linked to this circuit.');
  expect(detail.querySelectorAll('.hw-evidence-list a')).toHaveLength(0);
});
it('distinguishes withheld route/source prose from missing data while retaining provenance clocks', async () => {
  const data = physicalWorkspaceFixture();
  data.routings = [{ id: 'route-0', segment_id: data.segments[0].id, landmark_id: 'branch-0', seq: 1, source: null, observed_at: null, trust: null, branch_current: true }];
  data.branches = [{ id: 'branch-0', landmark_code: 'HARNESS_PATH', description: null, distance_in: 13.08, method: null, from_node_id: null, to_node_id: null, polyline_m: null, source_file: null, derived_on: null, is_superseded: false, superseded_by: null }];
  fixture.session = { user: { id: 'owner-user' } };
  fixture.rpc.mockResolvedValue({ data, error: null });
  await render('vehicle-a', '?records=segments&record=piece-0-unique');
  const detail = host.querySelector('.hw-inspector')!;
  const labels = [...detail.querySelectorAll('dt')].map(node => node.textContent);
  expect(labels).toContain('Observed');
  expect(labels).toContain('Source trust');
  expect(labels).not.toContain('Source');
  expect(labels).not.toContain('Method');
  expect(detail.textContent).toContain('Basis not included in this read');
  expect(detail.textContent).not.toContain('Basis not recorded');
  expect(detail.textContent).toContain('No evidence links for this record were included in this read.');
});
it.each(['?records=segments&record=00000000-0000-4000-8000-000000000099',
  '?record=00000000-0000-4000-8000-000000000099', '?sel=s%3A00000000-0000-4000-8000-000000000099'])('retains an unavailable selection without hiding current records: %s', async query => {
  await render('vehicle-a', query);
  expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
  expect(host.querySelector('.hw-inspector')!.textContent).toContain('This record is not part of the current database read.');
  expect(host.querySelector('.hw-inspector')!.textContent).not.toContain('superseded');
  expect(host.querySelector('.hw-footer')!.textContent).toContain('Excel includes all four record tables, including alternatives.');
});
