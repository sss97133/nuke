// @vitest-environment jsdom
// Every writer here is a mock: no test calls a production writer.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ readers: {} as Record<string, unknown>, rpc: vi.fn() }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
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
