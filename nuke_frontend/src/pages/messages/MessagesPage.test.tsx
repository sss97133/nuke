// @vitest-environment jsdom
// Every writer here is a mock: no test calls a production writer.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Signal = { kind: string; requestId: string | null };
const fixture = vi.hoisted(() => ({ readers: {} as Record<string, unknown>, rpc: vi.fn(), user: null as { id: string } | null,
  listeners: [] as { userId: string; listener: (s: Signal) => void }[] }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: fixture.user, session: null, loading: false }) }));
vi.mock('../../lib/contactLive', () => ({
  subscribeContactInbox: (userId: string, listener: (s: Signal) => void) => {
    const entry = { userId, listener };
    fixture.listeners.push(entry);
    return () => { fixture.listeners = fixture.listeners.filter(e => e !== entry); };
  },
}));
import MessagesPage, { ContactThreadPage } from './MessagesPage';

const inbox = {
  as_of: '2026-10-19T19:00:00Z', limits: { requests_per_day: 10, requests_sent_last_day: 9 },
  incoming: [{ request_id: 'r1', direction: 'incoming', status: 'pending', created_at: '2026-10-19T10:00:00Z', message: 'Can you weld my exhaust?',
    counterpart: { kind: 'user', handle: 'client1', name: 'Private Person', email: 'private@example.test', phone: '555-0100' },
    context: { kind: 'work_order', label: 'Synthetic exhaust job' }, thread: { messages: 0 }, actions: ['respond_contact_request'] }],
  outgoing: [{ request_id: 'r2', direction: 'outgoing', status: 'accepted', counterpart: { kind: 'user' }, context: { kind: 'profile' },
    thread: { messages: 2 }, actions: ['post_contact_message', 'withdraw_contact_request'] }],
};

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.readers = { my_contact_requests: inbox };
  fixture.user = null;
  fixture.listeners = [];
  fixture.rpc.mockReset();
  fixture.rpc.mockImplementation((name: string) => Promise.resolve({ data: fixture.readers[name] ?? { ok: true }, error: null }));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

async function render(path: string) {
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/messages" element={<MessagesPage />} />
    <Route path="/messages/:requestId" element={<ContactThreadPage />} />
  </Routes></MemoryRouter>));
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}
const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent === text) as HTMLButtonElement;

describe('MessagesPage', () => {
  it('lists requests by handle with the daily limit and never a contact field or private name', async () => {
    await render('/messages');
    const html = document.body.innerHTML;
    expect(host.textContent).toContain('From @client1');
    expect(host.textContent).toContain('To Unnamed party');
    expect(host.textContent).toContain('You can send 1 more request today.');
    expect(host.textContent).toContain('About: Synthetic exhaust job');
    for (const leak of ['private@example.test', '555-0100', 'Private Person']) expect(html).not.toContain(leak);
    expect(host.querySelector('a[href="/messages/r2"]')?.textContent).toBe('Open conversation (2)');
  });

  it('accepts only after confirm, with exactly the request id', async () => {
    await render('/messages');
    await act(async () => button('Accept').click());
    expect(fixture.rpc).not.toHaveBeenCalledWith('respond_contact_request', expect.anything());
    expect(document.body.textContent).toContain('Your email, phone or address: Nuke never shares them');
    await act(async () => button('Accept request').click());
    expect(fixture.rpc).toHaveBeenCalledWith('respond_contact_request', { p_id: 'r1', p_accept: true });
  });

  it('offers withdraw only where the server lists it', async () => {
    await render('/messages');
    expect([...document.querySelectorAll('button')].filter(b => b.textContent === 'Withdraw')).toHaveLength(1);
    await act(async () => button('Withdraw').click());
    await act(async () => button('Withdraw request').click());
    expect(fixture.rpc).toHaveBeenCalledWith('withdraw_contact_request', { p_id: 'r2' });
  });
});

describe('ContactThreadPage', () => {
  it('shows the conversation and posts a message when the server allows it', async () => {
    fixture.readers.contact_thread_read = { as_of: '2026-10-19T19:00:00Z', can_post: true,
      request: { request_id: 'r2', direction: 'outgoing', status: 'accepted', counterpart: { kind: 'user', handle: 'tech2' }, message: 'Hello' },
      messages: [{ message_id: 'm1', author: { kind: 'you' }, body: 'Are you free Friday?', created_at: '2026-10-19T11:00:00Z' }] };
    await render('/messages/r2');
    expect(host.querySelector('h1')?.textContent).toBe('Conversation with @tech2');
    expect(host.textContent).toContain('Are you free Friday?');
    const box = host.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, ' Yes ');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('Send').click());
    expect(fixture.rpc).toHaveBeenCalledWith('post_contact_message', { p_request_id: 'r2', p_body: 'Yes' });
  });

  it('says messages open after acceptance when the server does not allow posting', async () => {
    fixture.readers.contact_thread_read = { can_post: false, request: { status: 'pending', counterpart: { handle: 'tech2' } }, messages: [] };
    await render('/messages/r2');
    expect(host.querySelector('textarea')).toBeNull();
    expect(host.textContent).toContain('Messages open once the request is accepted.');
  });
});

describe('live updates', () => {
  const signal = async (s: Signal) => {
    await act(async () => { for (const e of fixture.listeners) e.listener(s); });
    await act(async () => { await new Promise(r => setTimeout(r, 300)); });
  };
  const announced = () => document.querySelector('[role="status"].jb-sr')?.textContent ?? '';
  const reads = (name: string) => fixture.rpc.mock.calls.filter(c => c[0] === name).length;
  const thread = (messages: object[], status = 'accepted') => ({ as_of: '2026-10-19T19:00:00Z', can_post: status === 'accepted',
    request: { request_id: 'r2', direction: 'outgoing', status, counterpart: { kind: 'user', handle: 'tech2' } }, messages });
  const mine = { message_id: 'm1', author: { kind: 'you' }, body: 'Are you free Friday?', created_at: '2026-10-19T11:00:00Z' };
  const theirs = { message_id: 'm2', author: { kind: 'user', handle: 'tech2' }, body: 'Friday works', created_at: '2026-10-19T11:05:00Z' };

  it('does not subscribe without a signed-in user', async () => {
    await render('/messages');
    expect(fixture.listeners).toHaveLength(0);
  });

  it('a thread refetches on a signal for it, shows the reply and announces it politely; other threads are ignored', async () => {
    fixture.user = { id: 'u-self' };
    fixture.readers.contact_thread_read = thread([mine]);
    await render('/messages/r2');
    expect(fixture.listeners.map(e => e.userId)).toEqual(['u-self']);
    expect(announced()).toBe('');
    await signal({ kind: 'message', requestId: 'r-other' });
    expect(reads('contact_thread_read')).toBe(1);
    fixture.readers.contact_thread_read = thread([mine, theirs]);
    await signal({ kind: 'message', requestId: 'r2' });
    expect(reads('contact_thread_read')).toBe(2);
    expect(host.textContent).toContain('Friday works');
    expect(announced()).toBe('New message from @tech2.');
    expect(document.querySelector('.jb-sr')?.getAttribute('role')).toBe('status');
  });

  it('a burst of signals becomes one refetch; resync after the tab returns refetches too', async () => {
    fixture.user = { id: 'u-self' };
    fixture.readers.contact_thread_read = thread([mine]);
    await render('/messages/r2');
    await act(async () => { for (const e of fixture.listeners) { e.listener({ kind: 'message', requestId: 'r2' }); e.listener({ kind: 'status', requestId: 'r2' }); } });
    await act(async () => { await new Promise(r => setTimeout(r, 300)); });
    expect(reads('contact_thread_read')).toBe(2);
    await signal({ kind: 'resync', requestId: null });
    expect(reads('contact_thread_read')).toBe(3);
    expect(announced()).toBe('');
  });

  it('/messages refetches on any signal and announces a new request without its text', async () => {
    fixture.user = { id: 'u-self' };
    await render('/messages');
    fixture.readers.my_contact_requests = { ...inbox, incoming: [{ request_id: 'r3', direction: 'incoming', status: 'pending', message: 'SECRET request text',
      counterpart: { kind: 'user', handle: 'buyer9' }, context: { kind: 'profile' }, thread: { messages: 0 }, actions: ['respond_contact_request'] }, ...inbox.incoming] };
    await signal({ kind: 'request', requestId: 'r3' });
    expect(host.textContent).toContain('From @buyer9');
    expect(announced()).toBe('New contact request from @buyer9.');
    expect(announced()).not.toContain('SECRET');
  });

  it('a failed live refresh keeps the last good read on screen', async () => {
    fixture.user = { id: 'u-self' };
    await render('/messages');
    fixture.rpc.mockImplementation(() => Promise.resolve({ data: null, error: { message: 'network down' } }));
    await signal({ kind: 'message', requestId: 'r2' });
    expect(host.textContent).toContain('From @client1');
  });

  it('unsubscribes when the page closes', async () => {
    fixture.user = { id: 'u-self' };
    await render('/messages');
    expect(fixture.listeners).toHaveLength(1);
    await act(async () => root.unmount());
    expect(fixture.listeners).toHaveLength(0);
    root = createRoot(host);
  });
});
