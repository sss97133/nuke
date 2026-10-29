// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ advance: vi.fn(), stage: 'inspecting' }));
vi.mock('../hooks/usePageTitle', () => ({ usePageTitle: () => {} }));
vi.mock('../hooks/useAcquisitionPipeline', () => ({ useAcquisitionPipeline: () => ({
  entries: [{ id: 'synthetic-acquisition', year: 2004, make: 'Synthetic', model: 'Truck', stage: fixture.stage, priority: 'normal', market_proof_data: null, asking_price: null, comp_median: null, deal_score: null, estimated_profit: null, discovery_url: null, discovery_date: null, stage_updated_at: null, notes: null }],
  stats: null, loading: false, error: null, refresh: vi.fn(), advanceStage: fixture.advance,
}) }));
import AcquisitionPipeline from './AcquisitionPipeline';

let host: HTMLDivElement, root: Root;
const button = (label: string) => [...host.querySelectorAll('button')].find(element => element.textContent?.trim() === label)!;
const click = async (label: string) => { await act(async () => button(label).click()); };
const input = () => host.querySelector('input')!;
const fill = async (value: string) => { await act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
  input().dispatchEvent(new Event('input', { bubbles: true }));
}); };
const open = async () => {
  await act(async () => root.render(<AcquisitionPipeline />));
  await click('Active (1)');
  await act(async () => host.querySelector('tbody tr')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await click(fixture.stage === 'offer_made' ? 'Accept →' : 'Offer →');
};
beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.stage = 'inspecting'; fixture.advance.mockReset(); fixture.advance.mockResolvedValue({ success: true });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it.each([['inspecting', 'offer_amount', 'make_offer'], ['offer_made', 'purchase_price', 'accept_deal']])('preserves cents for %s only after explicit confirmation', async (stage, field, action) => {
  fixture.stage = stage; await open(); await fill('500.50');
  expect(fixture.advance).not.toHaveBeenCalled();
  expect(host.querySelector('label')?.htmlFor).toBe(input().id);
  await click('Confirm');
  expect(fixture.advance).toHaveBeenCalledExactlyOnceWith('synthetic-acquisition', action, { [field]: '500.50' });
  expect(host.querySelector('input')).toBeNull();
});

it.each(['-500', '-0.50', '0', '0.00', '', '1e3', 'NaN', 'Infinity', '1,250.00', '12usd', '9'.repeat(309)])('rejects malformed or nonpositive input without changing its meaning: %s', async value => {
  await open(); await fill(value); await click('Confirm');
  expect(fixture.advance).not.toHaveBeenCalled();
  expect(input().value).toBe(value);
  expect(input().getAttribute('aria-invalid')).toBe('true');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('greater than zero');
});

it.each([['.50', '0.50'], ['0.125000', '0.125000'], ['9007199254740993.125', '9007199254740993.125']])('preserves supported decimal text %s without binary rounding', async (value, expected) => {
  await open(); await fill(value); await click('Confirm');
  expect(fixture.advance).toHaveBeenCalledWith('synthetic-acquisition', 'make_offer', { offer_amount: expected });
});

it('cancels without sending an acquisition action', async () => {
  await open(); await fill('500.50'); await click('Cancel');
  expect(fixture.advance).not.toHaveBeenCalled();
  expect(host.querySelector('input')).toBeNull();
});

it('blocks duplicate confirmation and preserves the amount when the existing writer refuses', async () => {
  let reject!: (reason: Error) => void;
  fixture.advance.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  await open(); await fill('500.50');
  await act(async () => { const confirm = button('Confirm'); confirm.click(); confirm.click(); });
  expect(fixture.advance).toHaveBeenCalledTimes(1);
  expect(button('Saving…').disabled).toBe(true);
  expect(button('Cancel').disabled).toBe(true);
  await act(async () => input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(host.querySelector('input')).not.toBeNull();
  await act(async () => reject(new Error('Synthetic writer refusal')));
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Synthetic writer refusal');
  expect(input().value).toBe('500.50');
  expect(button('Confirm').disabled).toBe(false);
});
