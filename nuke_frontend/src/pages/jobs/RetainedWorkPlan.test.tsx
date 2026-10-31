// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkContext } from './workEvidenceModel';
const fixture = vi.hoisted(() => ({ read: vi.fn(), receipts: vi.fn(), viewerId: 'viewer-a' as string | null }));
vi.mock('./jobsReaders', async () => ({ ...(await vi.importActual('./jobsReaders')), JobReaders: { workContext: fixture.read, vehicleReceiptLines: fixture.receipts } }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../contexts/AuthContext',()=>({useAuthContext:()=>({session:fixture.viewerId ? {user:{id:fixture.viewerId}} : null})}));
vi.mock('../../components/PrefetchLink', () => ({ PrefetchLink: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));
import { RetainedWorkPlan } from './RetainedWorkPlan';
let host: HTMLDivElement, root: Root;
const reports = [{ binding_id: 'binding', provider_actor_id: 'actor', provider_label: 'Technician', client_label: 'Client', source_observation_id: 'basis', reported_at: '2026-07-01', payment_state: null, delivery_state: 'reported_owed' as const, assurance: 'report' }];
const context = (): WorkContext => ({ vehicleId: 'vehicle-a', proofs: [], errors: [], partial: false,
  decisions: [{ id: 'mount', subject: 'Where the controller mounts', status: 'open', work_status: 'open', source: 'A retained build note', chosen: null, decided_on: null, trust: null },
    { id: 'optional', subject: 'Optional remote start', status: 'candidate', work_status: 'needs_owner', source: null, chosen: null, decided_on: null, trust: null },
    { id: 'agent', subject: 'Controller split', status: 'decided', work_status: 'decided', source: 'Agent plan', chosen: 'Working split', decided_on: null, trust: 'T3' }],
  handoffs: [{ id: 'old', source_id: 'source', observed_at: '2026-07-01', ingested_at: '2026-07-02', gate: 'Wiring before delivery to Client', next_action: 'Buy wire', blocked_on: ['An earlier question'] }] });
beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.read.mockReset(); fixture.read.mockResolvedValue(context());
  fixture.viewerId='viewer-a';fixture.receipts.mockReset();fixture.receipts.mockResolvedValue({data:{rows:[],next_after:null},refusal:null});
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('leads with actual open work, keeps historical handoff questions and optional scope closed, and makes its source reachable', async () => {
  await act(async () => root.render(<RetainedWorkPlan vehicleId="vehicle-a" reports={reports} />));
  expect(host.querySelector('[aria-label="Work to finish"]')?.textContent).toContain('Where the controller mounts');
  expect(host.querySelector('[aria-label="Work to finish"]')?.textContent).not.toContain('Optional remote start');
  for (const text of ['Earlier handoffs', 'Optional scope', 'Recorded choices']) {
    const summary = [...host.querySelectorAll('summary')].find(s => s.textContent === text)!;
    expect(summary.parentElement?.hasAttribute('open')).toBe(false);
  }
  expect(host.textContent).toContain('Questions in that handoff');
  expect(host.textContent).toContain('Agent working choice');
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

const line=(id:string,description:string)=>({id,receipt_id:'receipt-'+id,line_number:1,description,part_number:'PN-'+id,quantity:2,category:'electrical',
  receipt:{id:'receipt-'+id,vehicle_id:'vehicle-a',scope_type:'vehicle',scope_id:'vehicle-a',vendor_name:'Fixture supplier',receipt_date:'2024-01-15',transaction_date:null,purchase_date:null,
    file_url:'https://example.invalid/source.pdf',is_active:true,is_superseded:false,duplicate_of:null}});
it('makes parsed receipt lines reachable without turning them into on-hand parts or completed work',async()=>{
  fixture.receipts.mockResolvedValue({data:{rows:[line('part','Fixture connector')],next_after:null},refusal:null});
  await act(async()=>root.render(<RetainedWorkPlan vehicleId="vehicle-a" reports={reports}/>));
  const area=[...host.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent==='Receipt records')!;
  expect(area.hasAttribute('open')).toBe(false);expect(area.textContent).toContain('Fixture connector');expect(area.textContent).toContain('Qty 2');
  expect(area.querySelector('a')?.href).toBe('https://example.invalid/source.pdf');
  expect(area.textContent).toContain('does not establish present stock');
  expect(host.querySelector('[aria-label="Work to finish"]')?.textContent).not.toContain('Fixture connector');
});
it('reads all receipt pages before enabling source search, including the later-page part',async()=>{
  let finish!:(value:unknown)=>void;
  fixture.receipts.mockResolvedValueOnce({data:{rows:[line('first','First part')],next_after:'page-2'},refusal:null})
    .mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  await act(async()=>root.render(<RetainedWorkPlan vehicleId="vehicle-a" reports={reports}/>));
  const search=host.querySelector<HTMLInputElement>('input[type="search"]')!;expect(search.disabled).toBe(true);
  await act(async()=>finish({data:{rows:[line('later','Later-page part')],next_after:null},refusal:null}));
  expect(search.disabled).toBe(false);
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(search,'Later-page');search.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(host.textContent).toContain('Later-page part');expect(host.textContent).not.toContain('First part');expect(host.textContent).toContain('1 of 1 matching');
});
it('drops private receipt results when the signed-in account changes',async()=>{
  let finish!:(value:unknown)=>void;
  fixture.receipts.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  await act(async()=>root.render(<RetainedWorkPlan vehicleId="vehicle-a" reports={reports}/>));
  fixture.viewerId='viewer-b';
  await act(async()=>root.render(<RetainedWorkPlan vehicleId="vehicle-a" reports={reports}/>));
  await act(async()=>finish({data:{rows:[line('private','Private first account part')],next_after:null},refusal:null}));
  expect(host.textContent).not.toContain('Private first account part');
});
