// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ rpc: vi.fn(), userId: 'viewer-a' as string | null }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ session: fixture.userId ? { user: { id: fixture.userId } } : null }) }));
vi.mock('../../hooks/usePageTitle', () => ({ usePageTitle: () => {} }));
vi.mock('../../components/PrefetchLink', () => ({ PrefetchLink: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));
vi.mock('./JobSheets', () => ({ OfferSheet: () => <div role="dialog">Offer draft</div>, ContactSheet: () => <div role="dialog">Contact draft</div> }));
vi.mock('./MatchList', () => ({ MatchList: () => null, PlanBList: ({ inviter }: { inviter: boolean }) => <span>{inviter ? 'Can invite supplier' : 'No supplier invitation'}</span> }));
import JobsBoard from './JobsBoard';

const board = (name: string, contact = true) => ({ viewer: {}, as_of: '2026-10-25T07:00:00Z', rows: [{ requirement_id: 'requirement', requirement_kind: 'skill', work_order_id: 'job', display_title: name, description: name, plan_b_suppliers: [{ organization: { organization_id: 'supplier' } }] }], next_after: null, coverage: { returned: 1, total_open: 1 }, contact: { available: contact } });
const offers = { work_order_id: 'job', viewer: { actions: [{ action: 'offer', rpc: 'offer_on_requirement', args: { p_requirement_id: 'requirement' } }] } };
const reply = (data: unknown) => ({ data, error: null });
let host: HTMLDivElement, root: Root;
const render = async () => { await act(async () => root.render(<JobsBoard />)); };
const button = (label: string) => [...host.querySelectorAll('button')].find(element => element.textContent === label)!;
beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.userId = 'viewer-a'; fixture.rpc.mockReset();
  fixture.rpc.mockImplementation(async (name: string) => {
    if (name === 'open_requirements_read') return reply(board(fixture.userId || 'Visitor', !!fixture.userId));
    if (name === 'work_order_offers_read') return reply(fixture.userId === 'viewer-a' ? offers : { viewer: { actions: [] } });
    if (name === 'my_work_orders') return reply({ rows: fixture.userId === 'viewer-a' ? [{ work_order_id: 'job', slots: ['customer'] }] : [] });
    throw new Error(`Unexpected writer ${name}`);
  });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it.each(['Make an offer', 'Contact via Nuke'])('closes %s drafts and clears all viewer capabilities when a different account signs in', async action => {
  await render(); expect(host.textContent).toContain('Can invite supplier');
  await act(async () => button(action).click()); expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  fixture.userId = 'viewer-b'; await render();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(host.textContent).toContain('viewer-b');
  expect(host.textContent).not.toContain('viewer-a');
  expect(button('Make an offer')).toBeUndefined();
  expect(host.textContent).not.toContain('Can invite supplier');
  expect(fixture.rpc.mock.calls.filter(([name]) => name === 'open_requirements_read')).toHaveLength(2);
  expect(fixture.rpc.mock.calls.filter(([name]) => name === 'my_work_orders')).toHaveLength(2);
});

it('removes offers, contacts, supplier invitations and drafts on sign-out', async () => {
  await render(); await act(async () => button('Make an offer').click());
  fixture.userId = null; await render();
  expect(host.textContent).toContain('Visitor');
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(button('Make an offer')).toBeUndefined(); expect(button('Contact via Nuke')).toBeUndefined();
  expect(host.textContent).not.toContain('Can invite supplier');
});

it('ignores an old primary read and does not launch its secondary reads after viewer replacement', async () => {
  let finish!: (data: unknown) => void;
  fixture.rpc.mockImplementationOnce(() => Promise.resolve(reply({ rows: [] })))
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render(); fixture.userId = 'viewer-b'; await render();
  const offerReads = fixture.rpc.mock.calls.filter(([name]) => name === 'work_order_offers_read').length;
  await act(async () => finish(reply(board('Old account result'))));
  expect(host.textContent).toContain('viewer-b');
  expect(host.textContent).not.toContain('Old account result');
  expect(fixture.rpc.mock.calls.filter(([name]) => name === 'work_order_offers_read')).toHaveLength(offerReads);
});

it('ignores old offer and inviter results that finish after viewer replacement', async () => {
  let finishOffer!: (data: unknown) => void, finishJobs!: (data: unknown) => void;
  fixture.rpc.mockImplementation((name: string) => {
    if (name === 'open_requirements_read') return Promise.resolve(reply(board(fixture.userId!)));
    if (fixture.userId === 'viewer-a' && name === 'my_work_orders') return new Promise(resolve => { finishJobs = resolve; });
    if (fixture.userId === 'viewer-a' && name === 'work_order_offers_read') return new Promise(resolve => { finishOffer = resolve; });
    return Promise.resolve(reply(name === 'my_work_orders' ? { rows: [] } : { viewer: { actions: [] } }));
  });
  await render(); fixture.userId = 'viewer-b'; await render();
  await act(async () => { finishOffer(reply(offers)); finishJobs(reply({ rows: [{ work_order_id: 'job', slots: ['customer'] }] })); });
  expect(button('Make an offer')).toBeUndefined();
  expect(host.textContent).not.toContain('Can invite supplier');
  expect(host.textContent).toContain('viewer-b');
});
