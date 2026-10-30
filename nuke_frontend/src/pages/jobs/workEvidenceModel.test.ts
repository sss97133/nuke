import { expect, it } from 'vitest';
import { retainedWorkPlan, workExcerpt, type WorkContext, type WorkProof } from './workEvidenceModel';

const proof = (id: string, component: string, level: string, extra: Partial<WorkProof> = {}): WorkProof => ({
  id, component, level, vehicle_id: 'vehicle-a', kind: 'specification', source_id: 'source-a',
  is_superseded: false, observed_at: '2026-09-01', ingested_at: '2026-10-01', component_name: null,
  description: null, photo_url: null, photo_at: null, event_date: null, replaces: null, ...extra,
});
const context = (proofs: WorkProof[] = []): WorkContext => ({ vehicleId: 'vehicle-a', proofs, decisions: [], handoffs: [], errors: [], partial: false });

it('keeps a bought part with a later uninstalled report in remaining work, never in the buy list', () => {
  const plan = retainedWorkPlan(context([proof('purchase', 'Throttle body', 'bought'),
    proof('mount', 'Throttle body', 'not_installed'), proof('listing', 'Throttle body', 'lined_up')]));
  expect(plan.remaining.map(r => r.code)).toEqual(['Throttle body']);
  expect(plan.remaining[0].reports).toHaveLength(3);
  expect(plan.available).toEqual([]); expect(plan.options).toEqual([]);
});

it('keeps optional candidates out of promised scope and decided choices out of open work', () => {
  const input = context();
  input.decisions = [
    { id: 'mount', subject: 'Where the controller mounts', status: 'open', work_status: 'open', chosen: null, source: 'Owner handoff', decided_on: null, trust: 'owner' },
    { id: 'extra', subject: 'Optional extra lamp', status: 'candidate', work_status: 'needs_owner', chosen: null, source: null, decided_on: null, trust: null },
    { id: 'gauge', subject: 'Gauge feed', status: 'decided', work_status: 'decided', chosen: 'Direct sender', source: 'Receipt', decided_on: '2026-09-01', trust: 'T1' },
    { id: 'agent', subject: 'Controller split', status: 'decided', work_status: 'decided', chosen: 'Working split', source: 'Agent plan', decided_on: '2026-09-02', trust: 'T3' },
  ];
  const plan = retainedWorkPlan(input);
  expect(plan.open.map(d => d.id)).toEqual(['mount']);
  expect(plan.candidates.map(d => d.id)).toEqual(['extra']);
  expect(plan.choices.map(d => [d.id, d.authority])).toEqual([['gauge', 'owner_reported'], ['agent', 'agent_working']]);
});

it('withdraws exactly the rejected interpretation while preserving earlier purchase and presence testimony', () => {
  const plan = retainedWorkPlan(context([proof('purchase', 'Coils', 'bought'), proof('bench', 'Coils', 'on_hand'),
    proof('wrong', 'Coils', 'not_installed'), proof('correction', 'Coils', 'withdrawn', { replaces: 'wrong' })]));
  expect(plan.remaining).toHaveLength(0);
  expect(plan.available[0].reports.map(p => p.id)).not.toContain('wrong');
  expect(plan.available[0].reports.map(p => p.id)).toEqual(expect.arrayContaining(['purchase', 'bench', 'correction']));
});

it('retains unresolved disagreement, excludes withdrawn and other-vehicle sources, and never invents a task', () => {
  const plan = retainedWorkPlan(context([proof('yes', 'Pump', 'installed'), proof('no', 'Pump', 'not_installed'),
    proof('other', 'Other truck', 'not_installed', { vehicle_id: 'vehicle-b' }),
    proof('old', 'Old source', 'not_installed', { is_superseded: true })]));
  expect(plan.remaining).toHaveLength(1); expect(plan.remaining[0].disagreement).toBe(true);
  expect(plan.open).toEqual([]);
});

it('does not turn a vendor option, a mounted photo, or a purchase into completed work', () => {
  const plan = retainedWorkPlan(context([proof('option', 'Motor', 'lined_up'), proof('purchase', 'Controller', 'bought'), proof('mounted', 'Alternator', 'mounted')]));
  expect(plan.options.map(r => r.code)).toEqual(['Motor']);
  expect(plan.available.map(r => r.code)).toEqual(['Alternator', 'Controller']);
  expect(plan.remaining).toEqual([]);
});

it('minimizes embedded private values in source excerpts without changing the retained source', () => {
  expect(workExcerpt('Order a connector (~$480), contact fixture@example.invalid or +1 (202) 555-0199.'))
    .toBe('Order a connector (~[amount omitted]), contact [contact omitted] or [contact omitted].');
  expect(workExcerpt('Photo 2026-02-01; part 12699160; order 123456789012')).toBe('Photo 2026-02-01; part 12699160; order 123456789012');
});

it('does not derive remaining work from a truncated proof set that may omit a correction', () => {
  expect(retainedWorkPlan({ ...context([proof('old', 'Pump', 'not_installed')]), proofsComplete: false }).remaining).toEqual([]);
});

it('recovers an explicit wiring gap from a mounted-part report without guessing from a photo appearance', () => {
  const plan = retainedWorkPlan(context([proof('unwired', 'Alternator', 'mounted', { description: 'Mounted on the drive. Not wired.' }),
    proof('mounted', 'Other bracket', 'mounted', { description: 'Mounted on the truck.' })]));
  expect(plan.remaining.map(g => g.code)).toEqual(['Alternator']);
  expect(plan.remaining[0].wiringGap).toBe(true);
  expect(plan.available.map(g => g.code)).toEqual(['Other bracket']);
});
