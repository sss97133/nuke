// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { GarageVehicle } from '../../hooks/useVehiclesDashboard';

const invoke = vi.fn();
const rpc = vi.fn();
let consentRows: unknown[] = [];
vi.mock('../../lib/supabase', () => {
  const chain: any = {};
  for (const name of ['select', 'eq', 'is']) chain[name] = () => chain;
  chain.limit = () => Promise.resolve({ data: consentRows, error: null });
  return { supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) }, rpc: (...args: unknown[]) => rpc(...args), from: () => chain } };
});
vi.mock('../../services/globalUploadQueue', () => ({ uploadQueue: { addFiles: vi.fn() } }));
vi.mock('../PrefetchLink', () => ({ default: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a> }));

import { GarageCardMenu, GarageDisclaimBar, GarageSheetPanel, ProposalRow } from './GarageCardActions';

const vehicle = { id: '11111111-1111-4111-8111-111111111111', year: 1973, make: 'Fixture', model: 'Coupe', relationship_type: 'OWNER' } as GarageVehicle;
const proposal = { id: 'p-1', writer: 'record_vehicle_statement', summary: 'Keep your words in the log book as a fact: “rear axle is posi”', token: 'signed.token' };
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  invoke.mockReset(); rpc.mockReset(); consentRows = [];
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const button = (text: string) => [...host.querySelectorAll('button')].find(el => el.textContent === text);
const type = async (text: string) => act(async () => {
  const area = host.querySelector('textarea')!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, text);
  area.dispatchEvent(new Event('input', { bubbles: true }));
});
const enter = async () => act(async () => {
  host.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
});

it('a proposal row offers Confirm and Dismiss and hides once dismissed', async () => {
  const onConfirm = vi.fn(); const onDismiss = vi.fn();
  await act(async () => root.render(<ProposalRow proposal={proposal} state={{ status: 'open' }} onConfirm={onConfirm} onDismiss={onDismiss} />));
  expect(host.textContent).toContain('rear axle is posi');
  await act(async () => button('Confirm')!.click()); expect(onConfirm).toHaveBeenCalledOnce();
  await act(async () => button('Dismiss')!.click()); expect(onDismiss).toHaveBeenCalledOnce();
  await act(async () => root.render(<ProposalRow proposal={proposal} state={{ status: 'dismissed' }} onConfirm={onConfirm} onDismiss={onDismiss} />));
  expect(host.querySelector('.garage-agent-proposal')).toBeNull();
});

it('nothing is written on a turn; Confirm sends only the signed proposal back', async () => {
  invoke.mockResolvedValueOnce({ data: { reply: 'Noted.', proposals: [proposal], logged: false, wrote: [] }, error: null });
  await act(async () => root.render(<GarageSheetPanel sheet={{ kind: 'agent', vehicle }} onClose={vi.fn()} />));
  await type('rear axle is posi'); await enter();
  const [, turn] = invoke.mock.calls[0];
  expect(turn.body).toMatchObject({ vehicle_id: vehicle.id, message: 'rear axle is posi', allow_writes: true, propose: true });
  expect(turn.body.conversation_ref).toMatch(/^[0-9a-f-]{36}$/);
  expect(host.textContent).toContain('Noted.');
  expect(rpc).not.toHaveBeenCalledWith('record_vehicle_statement', expect.anything());

  invoke.mockResolvedValueOnce({ data: { confirmed: { id: 'p-1', writer: 'record_vehicle_statement', record_id: 'r', replay: false } }, error: null });
  await act(async () => button('Confirm')!.click());
  const [, confirm] = invoke.mock.calls[1];
  expect(confirm.body).toEqual({ vehicle_id: vehicle.id, confirm: 'signed.token', conversation_ref: turn.body.conversation_ref });
  expect(confirm.body.message).toBeUndefined();
  expect(host.textContent).toContain('Kept in the log book.');
  expect(button('Confirm')).toBeUndefined();
});

it('a refused confirm keeps the row open with the reason', async () => {
  invoke.mockResolvedValueOnce({ data: { reply: 'Noted.', proposals: [proposal] }, error: null });
  await act(async () => root.render(<GarageSheetPanel sheet={{ kind: 'agent', vehicle }} onClose={vi.fn()} />));
  await type('rear axle is posi'); await enter();
  invoke.mockResolvedValueOnce({ data: null, error: { message: 'x', context: { json: async () => ({ error: 'The car’s record does not name you as its owner, so this was not kept as an owner’s word.' }) } } });
  await act(async () => button('Confirm')!.click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('does not name you as its owner');
  expect(button('Confirm')).toBeDefined();
});

it('keeping sessions is off by default and turns on only by the switch', async () => {
  rpc.mockResolvedValueOnce({ data: { vehicle_id: vehicle.id, keep: true }, error: null });
  await act(async () => root.render(<GarageSheetPanel sheet={{ kind: 'agent', vehicle }} onClose={vi.fn()} />));
  const toggle = host.querySelector('[role="switch"]')!;
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  expect(rpc).not.toHaveBeenCalled();
  await act(async () => (toggle as HTMLButtonElement).click());
  expect(rpc).toHaveBeenCalledWith('set_vehicle_agent_log_consent', { p_vehicle_id: vehicle.id, p_keep: true });
  expect(toggle.getAttribute('aria-checked')).toBe('true');
});

it('the log book lists the account’s own kept sessions beside its notes', async () => {
  rpc.mockImplementation(async (name: string) => name === 'vehicle_statements'
    ? { data: { statements: [] }, error: null }
    : { data: { keep: true, sessions: [{ conversation_ref: 'c-1', started_at: '2026-11-20T10:00:00Z', turns: [{ role: 'user', words: 'is it posi?', at: '' }, { role: 'assistant', words: 'The photos show a 12-bolt.', at: '' }] }] }, error: null });
  await act(async () => root.render(<GarageSheetPanel sheet={{ kind: 'log', vehicle }} onClose={vi.fn()} />));
  const list = host.querySelector('[aria-label="Your agent sessions"]');
  expect(list?.textContent).toContain('You: is it posi?');
  expect(list?.textContent).toContain('Agent: The photos show a 12-bolt.');
});

const viewer = '22222222-2222-4222-8222-222222222222';
const tie = { table: 'vehicle_contributors', row_id: 'c-1', kind: 'contributor:photographer' };
const perm = { table: 'vehicle_user_permissions', row_id: 'p-1', kind: 'permission:contributor' };

it('the card menu offers Not my vehicle and hands the car to the confirm step', async () => {
  const onDisclaim = vi.fn(); const onClose = vi.fn();
  await act(async () => root.render(<GarageCardMenu vehicle={vehicle} x={10} y={10} onClose={onClose} onSheet={vi.fn()} onMerge={vi.fn()} onDisclaim={onDisclaim} />));
  await act(async () => button('Not my vehicle…')!.click());
  expect(onDisclaim).toHaveBeenCalledWith(vehicle); expect(onClose).toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});

it('opening the step only previews (dry run); confirm ends the ties, the card leaves, Undo restores the run', async () => {
  rpc.mockResolvedValueOnce({ data: { status: 'dry_run', would_end: [tie, perm], left: [], blocked_by: [], still_in_garage_by: [] }, error: null });
  const onRemoved = vi.fn(); const onRestored = vi.fn();
  await act(async () => root.render(<GarageDisclaimBar vehicle={vehicle} viewerId={viewer} onCancel={vi.fn()} onRemoved={onRemoved} onRestored={onRestored} />));
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc.mock.calls[0]).toEqual(['disclaim_vehicle_tie', expect.objectContaining({ p_vehicle_id: vehicle.id, p_actor: viewer, p_dry_run: true })]);
  expect(host.textContent).toContain('a contributor credit an automatic job wrote; a permission no one granted');
  expect(host.textContent).toContain('you can restore the ties afterwards');
  expect(onRemoved).not.toHaveBeenCalled();

  rpc.mockResolvedValueOnce({ data: { status: 'disclaimed', run_id: 'run-1', ended: [tie, perm], left: [], still_in_garage_by: [] }, error: null });
  await act(async () => button('Not my vehicle')!.click());
  expect(rpc.mock.calls[1][1]).not.toHaveProperty('p_dry_run');
  expect(rpc.mock.calls[1][1]).not.toHaveProperty('p_force_reason');
  expect(onRemoved).toHaveBeenCalledWith(vehicle.id);
  expect(host.textContent).toContain('is out of your garage');

  rpc.mockResolvedValueOnce({ data: { restored: [{}, {}], not_restored: [] }, error: null });
  await act(async () => button('Undo')!.click());
  expect(rpc.mock.calls[2]).toEqual(['restore_vehicle_tie', { p_journal_id: null, p_run_id: 'run-1', p_actor: viewer }]);
  expect(onRestored).toHaveBeenCalledWith(vehicle.id);
});

it('first-hand evidence is named and removal needs the person to say why', async () => {
  rpc.mockResolvedValueOnce({ data: { status: 'dry_run', would_end: [tie], left: [], blocked_by: [{ kind: 'own_photos', count: 12 }, { kind: 'work_order' }], still_in_garage_by: [] }, error: null });
  await act(async () => root.render(<GarageDisclaimBar vehicle={vehicle} viewerId={viewer} onCancel={vi.fn()} onRemoved={vi.fn()} onRestored={vi.fn()} />));
  expect(host.textContent).toContain('12 of your own photos; a work order in your name');
  expect(button('Remove anyway')!.disabled).toBe(true);
  await type('sold it in 2019');
  rpc.mockResolvedValueOnce({ data: { status: 'disclaimed', run_id: 'run-2', ended: [tie], left: [], still_in_garage_by: [] }, error: null });
  await act(async () => button('Remove anyway')!.click());
  expect(rpc.mock.calls[1][1]).toMatchObject({ p_force_reason: 'sold it in 2019' });
});

it('when nothing an import made ties the car, there is nothing to confirm', async () => {
  rpc.mockResolvedValueOnce({ data: { status: 'dry_run', would_end: [], left: [{ table: 'vehicle_contributors', kind: 'contributor:mechanic' }], blocked_by: [], still_in_garage_by: [] }, error: null });
  await act(async () => root.render(<GarageDisclaimBar vehicle={vehicle} viewerId={viewer} onCancel={vi.fn()} onRemoved={vi.fn()} onRestored={vi.fn()} />));
  expect(host.textContent).toContain('Nothing an import made ties');
  expect(host.textContent).toContain('contributor as mechanic');
  expect(button('Not my vehicle')).toBeUndefined();
  expect(button('Cancel')).toBeDefined();
});
