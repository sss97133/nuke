// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({ rpc: vi.fn(), rows: [] as unknown[], calls: [] as string[] }));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (name: string, args?: unknown) => { fx.calls.push(name); return fx.rpc(name, args); },
    from: () => { const q: Record<string, unknown> = {}; for (const k of ['select', 'eq', 'order']) q[k] = () => q; q.limit = async () => ({ data: fx.rows, error: null }); return q; },
  },
}));
import { activityFrom, internalHref } from './activity';
import ActivityIndicator, { REFRESH_MS } from './ActivityIndicator';
import ActivityLauncher from './ActivityLauncher';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const UID = '00000000-0000-4000-b000-00000000c001';
const WO = '11111111-1111-4111-8111-111111111111';
const NOW = Date.parse('2026-10-20T00:00:00Z');

const queue = { items: [
  { kind: 'quote_to_accept', ref_id: 'q1', work_order_id: WO, display_title: 'Exhaust job', sign: { binds: ['x'] } },
  { kind: 'facility_reservation_to_confirm', ref_id: 'r1', work_order_id: null, display_title: null, vehicle_label: { text: '1983 GMC K2500' } },
  { kind: 'work_session', ref_id: 's1' }, { kind: 'work_session', ref_id: 's2' },
  { kind: 'contact_request', ref_id: 'c1' },
], coverage: { total: 5 } };
const contacts = {
  incoming: [
    { request_id: 'c1', status: 'pending', counterpart: { kind: 'user', handle: 'e2etech' }, context: { label: 'Exhaust job' }, message: 'private words', thread: { messages: 0 } },
    { request_id: 'c2', status: 'accepted', counterpart: { kind: 'user', label: 'unnamed party' }, context: { label: 'Brakes' }, thread: { messages: 3, last_message_at: '2026-10-19T12:00:00Z' } },
  ],
  outgoing: [{ request_id: 'c3', status: 'accepted', counterpart: { kind: 'organization', name: 'E2E Garage' }, context: {}, thread: { messages: 1, last_message_at: '2026-09-01T00:00:00Z' } }],
};
const notes = [{ id: 'n1', title: 'Offer accepted', message: 'Your offer was accepted', action_url: 'https://nuke.ag/jobs/' + WO }, { id: 'n2', title: 'System', message: null, action_url: 'https://evil.example/x' }];

describe('activity words', () => {
  it('counts Signs (not work days or contact rows), pending contact requests and unread notifications, with plain titles and links', () => {
    const a = activityFrom(queue, contacts, 4, notes, NOW);
    expect(a).toMatchObject({ signs: 2, contacts: 1, notifications: 4, count: 7 });
    expect(a.items.map(i => [i.title, i.detail, i.href])).toEqual([
      ['Quote to accept', 'Exhaust job', `/jobs/${WO}`],
      ['Shop booking to confirm', '1983 GMC K2500', '/work'],
      ['Contact request from @e2etech', 'Exhaust job', '/messages/c1'],
      ['Conversation with someone on Nuke', 'Brakes', '/messages/c2'],
      ['Offer accepted', 'Your offer was accepted', `/jobs/${WO}`],
      ['System', null, null],
    ]);
    expect(JSON.stringify(a)).not.toContain('private words');
  });

  it('links only paths and nuke.ag URLs', () => {
    expect(internalHref('/work')).toBe('/work');
    expect(internalHref('//evil.example')).toBeNull();
    expect(internalHref('https://www.nuke.ag/messages/c1?x=1')).toBe('/messages/c1?x=1');
    expect(internalHref('https://evil.example/jobs')).toBeNull();
  });
});

let root: Root | null = null;
let host: HTMLDivElement;
async function render(node: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<MemoryRouter>{node}</MemoryRouter>); });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}
beforeEach(() => {
  fx.calls = []; fx.rows = notes;
  fx.rpc.mockReset();
  fx.rpc.mockImplementation(async (name: string) => ({
    data: name === 'my_signature_queue' ? queue : name === 'my_contact_requests' ? contacts : name === 'get_unread_notification_count' ? 2 : { ok: true }, error: null }));
});
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ''; vi.useRealTimers(); });

describe('ActivityIndicator', () => {
  it('shows the count and opens a panel of top items; Escape closes and returns focus', async () => {
    await render(<ActivityIndicator userId={UID} />);
    const button = host.querySelector('button')!;
    expect(button.textContent).toBe('Activity 5 items waiting');
    expect(host.querySelector('.activity-count')?.textContent).toBe('5');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    await act(async () => { button.click(); });
    const panel = host.querySelector('[role="region"]')!;
    expect(button.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.textContent).toContain('Waiting for your signature');
    expect(panel.textContent).toContain('Contact request from @e2etech');
    expect(panel.querySelector(`a[href="/jobs/${WO}"]`)).not.toBeNull();
    expect(panel.querySelector('a[href="/messages/c1"]')).not.toBeNull();
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(host.querySelector('[role="region"]')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('marks a notification read when opened, and opens the inbox for one it cannot link', async () => {
    const openInbox = vi.fn();
    await render(<ActivityIndicator userId={UID} onOpenNotifications={openInbox} />);
    await act(async () => { host.querySelector('button')!.click(); });
    const system = Array.from(host.querySelectorAll('button.activity-item')).find(b => b.textContent?.startsWith('System'))!;
    await act(async () => { (system as HTMLButtonElement).click(); });
    expect(fx.rpc).toHaveBeenCalledWith('mark_notification_read', { p_user_id: UID, p_notification_id: 'n2' });
    expect(openInbox).toHaveBeenCalled();
  });

  it('re-reads on window focus and on a slow interval only while the tab is visible', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await render(<ActivityIndicator userId={UID} />);
    const reads = () => fx.calls.filter(c => c === 'my_signature_queue').length;
    expect(reads()).toBe(1);
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(reads()).toBe(2);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await act(async () => { vi.advanceTimersByTime(REFRESH_MS); });
    expect(reads()).toBe(2);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => { vi.advanceTimersByTime(REFRESH_MS); });
    expect(reads()).toBe(3);
  });
});

describe('ActivityLauncher', () => {
  it('renders nothing and reads nothing for a visitor', async () => {
    await render(<ActivityLauncher userId={undefined} />);
    await act(async () => { await new Promise(r => setTimeout(r, 1700)); });
    expect(host.innerHTML).toBe('');
    expect(fx.calls).toEqual([]);
  });

  it('mounts the indicator only after the page has loaded and paused', async () => {
    Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
    await render(<ActivityLauncher userId={UID} />);
    expect(fx.calls).toEqual([]);
    await act(async () => { await new Promise(r => setTimeout(r, 1600)); });
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    expect(host.querySelector('button')?.textContent).toBe('Activity 5 items waiting');
  });
});
