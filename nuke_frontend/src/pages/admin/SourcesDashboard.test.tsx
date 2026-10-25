// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SourcesDashboard from './SourcesDashboard';

const { select, rpc, getSession, invoke } = vi.hoisted(() => ({ select: vi.fn(), rpc: vi.fn(), getSession: vi.fn(), invoke: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: {
  from: () => ({ select }), rpc, auth: { getSession }, functions: { invoke },
} }));

const source = { slug: 'example', display_name: 'Example auctions', category: 'auction', status: 'active',
  total_extracted: 12, universe_total: 24, last_successful_at: null, base_url: 'https://example.com' };
const queue = { pending: 2, processing: 1, complete: 4, failed: 0 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  select.mockReset().mockResolvedValue({ data: [source], error: null });
  rpc.mockReset().mockResolvedValue({ data: queue, error: null });
  getSession.mockReset().mockResolvedValue({ data: { session: { access_token: 'test-token' } }, error: null });
  invoke.mockReset().mockResolvedValue({ data: { success: true }, error: null });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(<SourcesDashboard />)); }
async function enterUrl(url = 'https://example.com/listings') {
  const input = host.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, url);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function submit() { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }
async function refresh() { await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Refresh')!.click()); }

describe('Sources dashboard reader states', () => {
  it('does not show invented zero counts while readers are pending', async () => {
    const pending = deferred<unknown>(); select.mockReturnValue(pending.promise); rpc.mockReturnValue(pending.promise);
    await render();
    expect(host.textContent).toContain('Loading source registry');
    expect(host.textContent).toContain('Loading queue summary');
    expect(host.textContent).not.toContain('0 registered');
    expect(host.querySelector('dl')).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
  it('shows returned and thrown reader failures without claiming an empty registry or queue', async () => {
    select.mockResolvedValue({ data: null, error: { message: 'Source read denied' } });
    rpc.mockRejectedValue(new Error('Queue connection failed'));
    await render();
    expect(host.textContent).toContain('Source registry unavailable: Source read denied');
    expect(host.textContent).toContain('Queue summary unavailable: Queue connection failed');
    expect(host.textContent).not.toContain('No registered sources');
    expect(host.querySelector('dl')).toBeNull();
    expect([...host.querySelectorAll('button')].find(button => button.textContent === 'Refresh')?.disabled).toBe(false);
  });
  it('distinguishes known registry emptiness from a queue with no visible rows', async () => {
    select.mockResolvedValue({ data: [], error: null });
    rpc.mockResolvedValue({ data: { pending: 0, processing: 0, complete: 0, failed: 0 }, error: null });
    await render();
    expect(host.textContent).toContain('0 registered');
    expect(host.textContent).toContain('No registered sources were returned');
    expect(host.textContent).toContain('This does not establish that the queue is empty');
    expect(host.querySelector('dl')).toBeNull();
  });
  it('does not call unmatched extraction and census counters complete', async () => {
    select.mockResolvedValue({ data: [{ ...source, total_extracted: 120, universe_total: 24 }], error: null });
    await render();
    expect(host.textContent).toContain('Not comparable');
    expect(host.textContent).not.toContain('100%');
  });
  it('retains a labelled last successful registry read when refresh fails', async () => {
    await render();
    expect(host.textContent).toContain('Current status of rows added in the last 24 hours');
    expect(host.textContent).toContain('Complete now');
    expect(host.querySelector('.sources-dashboard__queue-grid')?.textContent).toContain('4');
    select.mockResolvedValue({ data: null, error: { message: 'Temporary outage' } });
    rpc.mockResolvedValue({ data: null, error: null });
    await refresh();
    expect(host.textContent).toContain('Example auctions');
    expect(host.textContent).toContain('Showing the last successful read');
    expect(host.textContent).toContain('Queue summary unavailable');
    expect(host.querySelector('dl')).toBeNull();
  });
});

describe('explicit source onboarding', () => {
  it('coalesces rapid form submissions and uses the existing authenticated client contract', async () => {
    const pending = deferred<unknown>(); getSession.mockReturnValue(pending.promise);
    await render(); await enterUrl();
    expect(invoke).not.toHaveBeenCalled();
    await act(async () => { submit(); submit(); });
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(host.querySelector('input')?.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    await act(async () => pending.resolve({ data: { session: { access_token: 'test-token' } }, error: null }));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('onboard-source', {
      headers: { Authorization: 'Bearer test-token' }, body: { url: 'https://example.com/listings', phase: 'all' },
    });
    expect(host.textContent).toContain('Source onboarded');
    expect(host.querySelector('input')?.value).toBe('');
  });
  it('does not invoke onboarding without a session and preserves the entered URL', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    await render(); await enterUrl(); await act(async () => submit());
    expect(invoke).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Sign in again');
    expect(host.querySelector('input')?.value).toBe('https://example.com/listings');
  });
  it('rejects a non-http URL before any authenticated request', async () => {
    await render(); await enterUrl('file:///tmp/source'); await act(async () => submit());
    expect(getSession).not.toHaveBeenCalled(); expect(invoke).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Enter an http or https source URL');
  });
  it('reports function failures and permits an explicit retry', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { message: 'Source request rejected' } });
    await render(); await enterUrl(); await act(async () => submit());
    expect(host.textContent).toContain('Source request rejected');
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
    await act(async () => submit());
    expect(invoke).toHaveBeenCalledTimes(2); expect(host.textContent).toContain('Source onboarded');
  });
});
