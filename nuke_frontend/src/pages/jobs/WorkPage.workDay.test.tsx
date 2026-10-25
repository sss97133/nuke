// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ rpc: vi.fn(), writer: vi.fn(), items: [] as unknown[], viewerId: 'viewer-a' as string | null }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ session: fixture.viewerId ? { user: { id: fixture.viewerId } } : null }) }));
vi.mock('../../components/PrefetchLink', () => ({ PrefetchLink: ({ to, children, ...props }: { to: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={to} {...props}>{children}</a> }));
import WorkPage from './WorkPage';

const ID = '11111111-1111-4111-8111-111111111111';
const dayItem = () => ({
  kind: 'work_session', ref_id: ID, work_order_id: null,
  vehicle: { vehicle_id: '22222222-2222-4222-8222-222222222222' }, vehicle_label: { text: 'Synthetic truck' },
  clock: { session_date: '2026-10-10' }, summary: { capture_span_minutes: 75, evidence_counts: { session_images: 12 } },
  sign: { rpc: 'confirm_work_session', args_hint: { p_session_id: ID, p_confirm: true }, binds: ['self-confirmation of a photo-derived work day'], does_not_bind: ['counterparty acceptance', 'labor value', 'payment'] },
});
let host: HTMLDivElement, root: Root;
const button = (text: string) => [...host.querySelectorAll('button')].find(el => el.textContent === text)!;
const click = async (element: HTMLElement) => { await act(async () => element.click()); };
async function render() { await act(async () => root.render(<MemoryRouter><WorkPage /></MemoryRouter>)); }
beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.viewerId = 'viewer-a'; fixture.items = [dayItem()]; fixture.rpc.mockReset(); fixture.writer.mockReset();
  fixture.writer.mockResolvedValue({ data: { ok: true, confirmed: true, session_id: ID }, error: null });
  fixture.rpc.mockImplementation((name: string, args: unknown) => {
    if (name === 'confirm_work_session') return fixture.writer(args);
    return Promise.resolve({ data: name === 'my_signature_queue'
      ? { as_of: '2026-10-25T07:00:00Z', items: fixture.items, coverage: { returned: fixture.items.length, total: fixture.items.length } }
      : { rows: [], coverage: { total_for_viewer: 0 }, next_after: null }, error: null });
  });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('opens a review with day, vehicle and qualified photo evidence; cancel does not sign', async () => {
  await render(); expect(fixture.writer).not.toHaveBeenCalled();
  await click(button('Review work day'));
  const dialog = host.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain('Oct 10, 2026');
  expect(dialog.textContent).toContain('12 session photos');
  expect(dialog.textContent).toContain('not measured labor time');
  const vehicleLink = dialog.querySelector('a');
  expect(vehicleLink?.getAttribute('href')).toBe('/vehicle/22222222-2222-4222-8222-222222222222');
  expect(vehicleLink?.getAttribute('target')).toBe('_blank');
  expect(vehicleLink?.getAttribute('rel')).toBe('noopener noreferrer');
  expect(vehicleLink?.textContent).toContain('(new tab)');
  expect(dialog.textContent).toContain('counterparty acceptance');
  expect(dialog.querySelector('a')?.getAttribute('href')).toBe('/vehicle/22222222-2222-4222-8222-222222222222');
  expect(fixture.writer).not.toHaveBeenCalled();
  await click(button('Cancel')); expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(fixture.writer).not.toHaveBeenCalled();
});

it('signs exactly the reviewed day, waits for its confirmed response and refreshes the queue on Done', async () => {
  await render(); await click(button('Review work day'));
  await click(button('Confirm this work day'));
  expect(fixture.writer).toHaveBeenCalledOnce();
  expect(fixture.writer).toHaveBeenCalledWith({ p_session_id: ID, p_confirm: true });
  expect(host.querySelector('[role="dialog"] [role="status"]')?.textContent).toContain('Work day confirmed by you');
  fixture.items = [];
  await click(button('Done'));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(host.textContent).toContain('Nothing is waiting for your signature');
});

it('never treats a JSON refusal or mismatched confirmation as a successful signature', async () => {
  fixture.writer.mockResolvedValueOnce({ data: { ok: false, error: 'not_authorized' }, error: null })
    .mockResolvedValueOnce({ data: { ok: true, confirmed: true, session_id: 'other' }, error: null });
  await render(); await click(button('Review work day')); await click(button('Confirm this work day'));
  expect(host.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain('Only the account');
  expect(button('Done')).toBeUndefined();
  await click(button('Confirm this work day'));
  expect(host.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain('did not return a confirmation');
  expect(button('Done')).toBeUndefined();
});

it('disables unsupported or changed queue actions instead of fabricating writer arguments', async () => {
  fixture.items = [{ ...dayItem(), sign: { ...dayItem().sign, args_hint: { p_session_id: 'other', p_confirm: true } } }];
  await render(); expect(button('Review work day').disabled).toBe(true);
  expect(host.textContent).toContain('Refresh the page');
  expect(fixture.writer).not.toHaveBeenCalled();
});

it('prevents duplicate submission and recovers from a rejected transport promise', async () => {
  let reject!: (error: Error) => void;
  fixture.writer.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  await render(); await click(button('Review work day'));
  await act(async () => { const confirm = button('Confirm this work day'); confirm.click(); confirm.click(); });
  expect(fixture.writer).toHaveBeenCalledOnce(); expect(button('Sending…').disabled).toBe(true);
  expect(button('Cancel').disabled).toBe(true);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => reject(new Error('Connection lost')));
  expect(button('Confirm this work day').disabled).toBe(false);
  expect(host.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain('Connection lost');
  expect(button('Done')).toBeUndefined();
});

it('removes the prior viewer queue and open confirmation draft when accounts change', async () => {
  await render(); await click(button('Review work day'));
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  fixture.viewerId = 'viewer-b'; fixture.items = [];
  await render();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(host.textContent).not.toContain('Synthetic truck');
  expect(host.textContent).toContain('Nothing is waiting for your signature');
  expect(fixture.writer).not.toHaveBeenCalled();
  expect(fixture.rpc.mock.calls.filter(([name]) => name === 'my_signature_queue')).toHaveLength(2);
});

it('ignores late private queue and job responses from a previous viewer', async () => {
  let finishQueue!: (value: unknown) => void, finishJobs!: (value: unknown) => void;
  fixture.rpc.mockImplementation((name: string) => {
    if (fixture.viewerId === 'viewer-a') return new Promise(resolve => {
      if (name === 'my_signature_queue') finishQueue = resolve; else finishJobs = resolve;
    });
    return Promise.resolve({ error: null, data: name === 'my_signature_queue'
      ? { items: [], coverage: { returned: 0, total: 0 } }
      : { rows: [{ work_order_id: 'viewer-b-job', display_title: 'Viewer B job', slots: [], stage_states: {} }], coverage: { total_for_viewer: 1 }, next_after: null } });
  });
  await render();
  fixture.viewerId = 'viewer-b'; await render();
  expect(host.textContent).toContain('Viewer B job');
  await act(async () => {
    finishQueue({ error: null, data: { items: [dayItem()], coverage: { returned: 1, total: 1 } } });
    finishJobs({ error: null, data: { rows: [{ work_order_id: 'viewer-a-job', display_title: 'Private A job', slots: [], stage_states: {} }], coverage: { total_for_viewer: 1 }, next_after: null } });
  });
  expect(host.textContent).not.toContain('Synthetic truck');
  expect(host.textContent).not.toContain('Private A job');
  expect(host.textContent).toContain('Viewer B job');
  expect(button('Review work day')).toBeUndefined();
});

it('does not replay a submitted confirmation or show its late success to the next account', async () => {
  let finish!: (value: unknown) => void;
  const submittedBy: Array<string | null> = [];
  fixture.writer.mockImplementationOnce(() => {
    submittedBy.push(fixture.viewerId);
    return new Promise(resolve => { finish = resolve; });
  });
  await render(); await click(button('Review work day')); await click(button('Confirm this work day'));
  fixture.viewerId = 'viewer-b'; fixture.items = []; await render();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => finish({ data: { ok: true, confirmed: true, session_id: ID }, error: null }));
  expect(submittedBy).toEqual(['viewer-a']);
  expect(fixture.writer).toHaveBeenCalledOnce();
  expect(host.textContent).not.toContain('Work day confirmed by you');
  expect(host.textContent).toContain('Nothing is waiting for your signature');
});

it('clears viewer-owned state on sign-out and makes no anonymous private read', async () => {
  await render(); await click(button('Review work day'));
  const calls = fixture.rpc.mock.calls.length;
  fixture.viewerId = null; await render();
  expect(host.textContent).toBe('');
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(fixture.rpc).toHaveBeenCalledTimes(calls);
  expect(fixture.writer).not.toHaveBeenCalled();
});
