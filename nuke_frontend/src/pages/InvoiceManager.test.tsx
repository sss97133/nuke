// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], error: null as null | Error, update: vi.fn(), target: vi.fn() }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'synthetic-owner' } }) }));
vi.mock('../lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    const q: Record<string, unknown> = {};
    let updating = false;
    for (const method of ['select', 'eq', 'in', 'or', 'order', 'limit']) q[method] = () => q;
    q.update = (values: unknown) => { updating = true; fixture.update(values); return q; };
    q.eq = (key: string, value: string) => { if (updating) fixture.target(key, value); return q; };
    q.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: table === 'generated_invoices' ? fixture.rows : [], error: table === 'generated_invoices' ? fixture.error : null }));
    return q;
  },
} }));
import InvoiceManager from './InvoiceManager';

let root: Root, host: HTMLDivElement;
const invoice = (id: string, status = 'draft', payment_status = 'unpaid') => ({ id, invoice_number: id, status, payment_status, amount_paid: 0, amount_due: 100, total_amount: 100, invoice_date: '2026-01-01', due_date: '2026-02-01' });
const buttons = () => [...host.querySelectorAll('button')];
const button = (label: string) => buttons().find(el => el.textContent?.trim() === label)!;
async function render() { await act(async () => root.render(<MemoryRouter><InvoiceManager /></MemoryRouter>)); }
async function click(el: HTMLElement) { await act(async () => el.click()); }
beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.rows = []; fixture.error = null; fixture.update.mockClear(); fixture.target.mockClear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

it('keeps cancelled, void and paid invoices viewable without payment actions', async () => {
  fixture.rows = [invoice('cancel-status', 'cancelled'), invoice('cancel-payment', 'draft', 'cancelled'), invoice('void', 'void'), invoice('paid', 'sent', 'paid'), invoice('open')];
  await render();
  const rows = [...host.querySelectorAll('.invoice-row')];
  expect(rows).toHaveLength(5);
  for (const row of rows.slice(0, 4)) expect(row.textContent).not.toContain('RECORD PAYMENT');
  expect(rows[0].textContent).toContain('PREVIEW');
  expect(rows[1].textContent).not.toContain('Mark as sent');
  expect(rows[4].textContent).toContain('RECORD PAYMENT');
  expect(rows[4].textContent).toContain('Mark as sent');
  expect(rows[4].textContent).toContain(`Invoice: ${new Date(2026, 0, 1).toLocaleDateString()}`);
  expect(rows[4].textContent).toContain(`Due: ${new Date(2026, 1, 1).toLocaleDateString()}`);
});

it('rejects invalid payment input without issuing an update', async () => {
  fixture.rows = [invoice('open')]; await render();
  const prompt = vi.spyOn(window, 'prompt');
  for (const input of ['-10', 'NaN', 'Infinity', '12garbage', '0']) {
    prompt.mockReturnValue(input); await click(button('RECORD PAYMENT'));
  }
  expect(fixture.update).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('positive payment amount');
});

it('makes unsupported delivery and export actions explicit in preview', async () => {
  fixture.rows = [invoice('open')]; await render(); await click(button('PREVIEW'));
  for (const label of ['Email to client', 'Download PDF', 'Export to QuickBooks']) expect(button(label).disabled).toBe(true);
  expect(host.textContent).toContain('not available from this page yet');
  expect(fixture.update).not.toHaveBeenCalled();
});

it('does not confuse a failed read with an empty invoice list', async () => {
  fixture.error = new Error('synthetic read refusal'); vi.spyOn(console, 'error').mockImplementation(() => {});
  await render(); expect(host.querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');
  expect(host.textContent).not.toContain('No invoices found');
});

it('marks only the chosen open draft as sent after explicit confirmation of its meaning', async () => {
  fixture.rows = [invoice('cancelled', 'cancelled'), invoice('already-sent', 'sent'), invoice('open')];
  await render();
  expect(buttons().filter(el => el.textContent?.trim() === 'Mark as sent')).toHaveLength(1);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  await click(button('Mark as sent'));
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('does not send an email'));
  expect(fixture.update).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  await click(button('Mark as sent'));
  expect(fixture.update).toHaveBeenCalledOnce();
  expect(fixture.update).toHaveBeenCalledWith({ status: 'sent', sent_at: expect.any(String) });
  expect(fixture.target).toHaveBeenCalledWith('id', 'open');
});

it('surfaces a failed mark-as-sent update', async () => {
  fixture.rows = [invoice('open')]; await render();
  fixture.error = new Error('synthetic write refusal');
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await click(button('Mark as sent'));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('sent status could not be saved');
});
