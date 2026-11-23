// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ invoke: vi.fn(), getUser: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke: fixture.invoke }, auth: { getUser: fixture.getUser } } }));
import { SourceRefreshControl } from './SourcesBoard';
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  history.replaceState(null, '', '/');
  fixture.invoke.mockReset(); fixture.getUser.mockReset();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); history.replaceState(null, '', '/'); });
const click = async (text: string) => {
  const button = [...host.querySelectorAll('button')].find(b => b.textContent?.includes(text));
  expect(button).toBeTruthy(); await act(async () => button!.click());
};
const mount = async () => { await act(async () => root.render(<SourceRefreshControl source="fixture" />)); };

it('hides the refresh control when no verified source policy exists', async () => {
  fixture.invoke.mockResolvedValue({ data: { available: false, reason: 'Provider funding is not connected.' } });
  await mount();
  expect(host.querySelector('button')).toBeNull();
  expect(host.textContent).not.toContain('Fund refresh ·');
  expect(fixture.invoke).toHaveBeenCalledWith('create-api-access-checkout', {
    body: { action: 'source_refresh_status', source: 'fixture', request_id: null },
  });
});
it('requires sign-in, without creating a payment, for an anonymous contributor', async () => {
  fixture.invoke.mockResolvedValue({ data: { available: true, amount_cents: 300, max_ingests: 2 } });
  fixture.getUser.mockResolvedValue({ data: { user: null } });
  await mount(); await click('Refresh source'); await click('Fund refresh');
  expect(host.textContent).toContain('Sign in to request this refresh.');
  expect(fixture.invoke).toHaveBeenCalledTimes(1);
});
it('uses existing capacity without opening a payment or claiming money was received', async () => {
  fixture.invoke.mockResolvedValueOnce({ data: { available: true, requires_payment: false, amount_cents: 0, max_ingests: 2 } })
    .mockResolvedValueOnce({ data: { payment_required: false, request_id: 'free-fixture' } })
    .mockResolvedValue({ data: { receipt: { status: 'funded', payment_required: false } } });
  fixture.getUser.mockResolvedValue({ data: { user: { id: 'fixture-user' } } });
  await mount(); await click('Refresh source'); await click('Refresh now');
  expect(fixture.invoke.mock.calls[1][1].body.action).toBe('source_refresh_request');
  expect(host.textContent).toContain('Refresh queued using existing capacity.');
  expect(host.textContent).not.toContain('Payment confirmed.');
  expect(host.querySelector('a')).toBeNull();
});
it('shows the stored quote and binds checkout to the source without sending a client price', async () => {
  fixture.invoke.mockResolvedValueOnce({ data: { available: true, amount_cents: 300, max_ingests: 2 } })
    .mockResolvedValueOnce({ data: { checkout_url: 'https://checkout.stripe.com/c/pay/fixture' } });
  fixture.getUser.mockResolvedValue({ data: { user: { id: 'fixture-user' } } });
  await mount(); await click('Refresh source');
  expect(host.textContent).toContain('$3.00'); await click('Fund refresh');
  expect(fixture.invoke.mock.calls[1][1].body).toEqual({ action: 'source_refresh_checkout', source: 'fixture', request_id: expect.any(String) });
  expect(host.querySelector('a')?.href).toBe('https://checkout.stripe.com/c/pay/fixture');
});
it('does not treat a checkout return as confirmed payment or start another checkout', async () => {
  history.replaceState(null, '', '/?refresh_source=fixture&refresh=fixture-id');
  fixture.invoke.mockResolvedValue({ data: { available: true, amount_cents: 300,
    receipt: { status: 'awaiting_payment' } } });
  await mount();
  expect(host.textContent).toContain('Waiting for payment confirmation.');
  expect(host.textContent).not.toContain('Payment confirmed.');
  expect(host.textContent).not.toContain('Fund refresh ·');
});
it('shows a refunded source payment without offering another checkout on the same receipt', async () => {
  history.replaceState(null, '', '/?refresh_source=fixture&refresh=fixture-id');
  fixture.invoke.mockResolvedValue({ data: { receipt: { status: 'refunded', payment_required: true } } });
  await mount();
  expect(host.textContent).toContain('The payment was refunded.');
  expect(host.textContent).not.toContain('Fund refresh ·');
});
