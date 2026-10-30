// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkContext } from './workEvidenceModel';
const fixture = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('./jobsReaders', async () => ({ ...(await vi.importActual('./jobsReaders')), JobReaders: { workContext: fixture.read } }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../components/PrefetchLink', () => ({ PrefetchLink: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));
import { RetainedWorkPlan } from './RetainedWorkPlan';
let host: HTMLDivElement, root: Root;
const reports = [{ binding_id: 'binding', provider_actor_id: 'actor', provider_label: 'Technician', client_label: 'Client', source_observation_id: 'basis', reported_at: '2026-07-01', payment_state: null, delivery_state: 'reported_owed' as const, assurance: 'report' }];
const context = (): WorkContext => ({ vehicleId: 'vehicle-a', proofs: [], errors: [], partial: false,
  decisions: [{ id: 'mount', subject: 'Where the controller mounts', status: 'open', work_status: 'open', source: 'A retained build note', chosen: null, decided_on: null, trust: null },
    { id: 'optional', subject: 'Optional remote start', status: 'candidate', work_status: 'needs_owner', source: null, chosen: null, decided_on: null, trust: null }],
  handoffs: [{ id: 'old', source_id: 'source', observed_at: '2026-07-01', ingested_at: '2026-07-02', gate: 'Wiring before delivery to Client', next_action: 'Buy wire', blocked_on: ['An earlier question'] }] });
beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.read.mockReset(); fixture.read.mockResolvedValue(context());
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('leads with actual open work, keeps historical handoff questions and optional scope closed, and makes its source reachable', async () => {
  await act(async () => root.render(<RetainedWorkPlan vehicleId="vehicle-a" reports={reports} />));
  expect(host.querySelector('[aria-label="Work to finish"]')?.textContent).toContain('Where the controller mounts');
  expect(host.querySelector('[aria-label="Work to finish"]')?.textContent).not.toContain('Optional remote start');
  for (const text of ['Earlier handoffs', 'Optional scope']) {
    const summary = [...host.querySelectorAll('summary')].find(s => s.textContent === text)!;
    expect(summary.parentElement?.hasAttribute('open')).toBe(false);
  }
  expect(host.textContent).toContain('Questions in that handoff');
  expect(host.querySelector('a')?.getAttribute('href')).toBe('/vehicle/vehicle-a/wiring');
  expect(host.textContent).not.toContain('Physical progress not established');
});

it('drops an in-flight private read when the subject changes', async () => {
  let resolve!: (value: WorkContext) => void;
  fixture.read.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await act(async () => root.render(<RetainedWorkPlan vehicleId="vehicle-a" reports={reports} />));
  fixture.read.mockResolvedValue({ ...context(), vehicleId: 'vehicle-b', decisions: [], handoffs: [] });
  await act(async () => root.render(<RetainedWorkPlan vehicleId="vehicle-b" reports={reports} />));
  await act(async () => resolve(context()));
  expect(host.textContent).not.toContain('Where the controller mounts');
  expect(host.textContent).not.toContain('delivery to Client');
});
