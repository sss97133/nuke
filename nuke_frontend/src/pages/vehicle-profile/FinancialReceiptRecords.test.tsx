// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ from: vi.fn(), eq: vi.fn(), sign: vi.fn(), privatePath: vi.fn(), rpc: vi.fn(), user: null as { id: string } | null, loading: false }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/synthetic-pdf-worker.mjs' }));
vi.mock('../../lib/supabase', () => ({ supabase: { from: fixture.from, rpc: (...args: unknown[]) => { const result = fixture.rpc(...args); return Object.assign(result, { abortSignal: () => result }); } } }));
vi.mock('../../lib/privateStorage', () => ({ signPrivateStorageUrl: fixture.sign, privateStoragePath: fixture.privatePath }));
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: fixture.user, loading: fixture.loading }) }));
import { ReceiptRecords } from './FinancialReceiptRecords';
import { parseVehicleReceiptRecord } from './hooks/useBuildLedger';

let host: HTMLDivElement, root: Root, client: QueryClient;
const wrapper = (child: React.ReactNode) => <QueryClientProvider client={client}>{child}</QueryClientProvider>;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  fixture.user = null; fixture.loading = false; fixture.rpc.mockReset().mockResolvedValue({ data: { documents: [], tied: false }, error: null });
  fixture.eq.mockReset(); fixture.sign.mockReset().mockImplementation(url => Promise.resolve(url)); fixture.privatePath.mockReset().mockReturnValue(null);
  fixture.from.mockReset().mockImplementation(() => {
    const query = { select: () => query, eq: fixture.eq.mockImplementation(() => query),
      maybeSingle: () => Promise.resolve({ data: { file_url: 'https://example.test/receipt.png' }, error: null }) };
    return query;
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['synthetic'], { type: 'image/png' }) })));
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:receipt'); static revokeObjectURL = vi.fn(); });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.unstubAllGlobals(); });
const render = async () => act(async () => {
  const read = { rows: [parseVehicleReceiptRecord({ id: 'receipt-a', vendor_name: 'Synthetic part', total: 15, currency: 'USD', source_document_table: 'vehicle_documents', source_document_id: 'source-a' })],
    isLoading: false, isError: false, total: 1, hasNextPage: false } as any;
  root.render(wrapper(<ReceiptRecords vehicleId="vehicle-a" read={read} />));
});
// The original preview is a lazy module (pdfjs behind it); three ticks were enough on a warm worker and not on a cold
// one (main, 2026-11-05 18:08Z: "expected undefined to be 'blob:receipt'"). Wait until the click's effect is visible,
// bounded, instead of a fixed number of ticks.
const click = async (label: string, until: () => boolean = () => true) => {
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === label)!.click());
  for (let i = 0; i < 200 && !(i >= 3 && until()); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
};

it('binds the original to the same vehicle and source and returns to the selected receipt in place', async () => {
  await render(); await click('Read original source', () => !!host.querySelector('img') || host.textContent!.includes('unavailable'));
  expect(fixture.from).toHaveBeenCalledWith('vehicle_documents');
  expect(fixture.eq.mock.calls).toEqual([['id', 'source-a'], ['vehicle_id', 'vehicle-a']]);
  expect(host.querySelector('img')?.src).toBe('blob:receipt');
  expect(host.querySelector('a[target]')).toBeNull();
  await click('Close original', () => !host.querySelector('img'));
  expect(host.textContent).toContain('Synthetic part');
  expect(host.textContent).toContain('$15.00');
  expect(document.activeElement?.textContent).toBe('Read original source');
});

it('does not fetch a private object when signing fails', async () => {
  fixture.privatePath.mockReturnValue({ bucket: 'private', path: 'receipt.png' });
  await render(); await click('Read original source', () => host.textContent!.includes('Source unavailable'));
  expect(fetch).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Source unavailable or not visible');
  expect(host.querySelector('img')).toBeNull();
});

it('names who may see a masked amount instead of calling it unrecorded', async () => {
  const masked = parseVehicleReceiptRecord({ id: 'receipt-b', vendor_name: 'Atomic Motors', total: null, total_amount: null, amounts_visible: false,
    receipt_date: '2025-01-13', source_document_table: 'vehicle_documents', source_document_id: 'source-b' });
  const unrecorded = parseVehicleReceiptRecord({ id: 'receipt-c', vendor_name: 'Classic Industries', total: null, total_amount: null, amounts_visible: true,
    source_document_table: 'vehicle_documents', source_document_id: 'source-c' });
  expect(masked.amountsHidden).toBe(true);
  expect(unrecorded.amountsHidden).toBe(false);
  expect(parseVehicleReceiptRecord({ id: 'receipt-d', total: 5 }).amountsHidden).toBe(false);
  await act(async () => {
    const read = { rows: [masked, unrecorded], isLoading: false, isError: false, total: 2, hasNextPage: false } as any;
    root.render(wrapper(<ReceiptRecords vehicleId="vehicle-a" read={read} />));
  });
  const summaries = [...host.querySelectorAll('.vp-receipt-total')].map(s => s.textContent);
  expect(summaries[0]).toContain("Visible to owner & contributors");
  expect(summaries[0]).not.toContain('Amount not recorded');
  expect(summaries[1]).toContain('Amount not recorded');
  expect(host.textContent).not.toContain('payment confirmed');
});


const dated = (extra = {}) => parseVehicleReceiptRecord({ id: 'receipt-a', vendor_name: 'Synthetic machine shop', total: 125, currency: 'USD', receipt_date: '2025-04-02', source_document_table: 'vehicle_documents', source_document_id: 'source-a', ...extra });
const renderRows = async (rows: ReturnType<typeof dated>[], error = false) => {
  await act(async () => root.render(wrapper(<ReceiptRecords vehicleId="vehicle-a" read={{ rows, isLoading: false, isError: error, total: rows.length, hasNextPage: false } as any} />)));
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
};
const line = { line_number: 1, description: 'Machine existing block', quantity: 1, amount: 100, line_date: '2025-03-20', hours: 2, performer: 'Shop', part_number: null };
const page = (lines = [line]) => ({ receipt_id: 'receipt-a', document_number: 'A-100', document_type: 'invoice', subtotal: 100, tax: 25, shipping: null, discount: null, lines });

it('shows the exact receipt work date and quantity zero without turning nearby photos into installation proof', async () => {
  fixture.rpc.mockResolvedValue({ data: { tied: false, documents: [{ ...page([{ ...line, description: 'Rear foam — backordered, shipped 0', quantity: 0 }]),
    install: { status: 'photographed', photo_day: '2025-04-03' } }, { ...page(), receipt_id: 'other-receipt', document_number: 'WRONG' }] }, error: null });
  await renderRows([dated({ total: null, amounts_visible: false })]);
  await click('Read lines', () => host.textContent!.includes('A-100'));
  expect(fixture.rpc).toHaveBeenCalledWith('get_vehicle_day_documents', { p_vehicle_id: 'vehicle-a', p_date: '2025-04-02' });
  expect(host.textContent).toContain('Mar 20, 2025 · Work recorded');
  expect(host.textContent).toContain('backordered, shipped 0');
  expect(host.querySelectorAll('tbody td')[1].textContent).toBe('0');
  expect(host.textContent).not.toContain('WRONG');
  expect(host.textContent).not.toContain('Apr 3');
  expect(host.textContent).not.toContain('$100');
});

it('withholds a previous viewer’s line amounts immediately during an auth transition and on failed refresh', async () => {
  fixture.user = { id: 'owner-a' };
  fixture.rpc.mockResolvedValue({ data: { tied: true, documents: [page()] }, error: null });
  await renderRows([dated()]); await click('Read lines', () => host.textContent!.includes('A-100'));
  expect(host.textContent).toContain('$100.00');
  fixture.loading = true; await renderRows([dated()]);
  expect(host.textContent).not.toContain('$100'); expect(host.textContent).not.toContain('$125');
  fixture.loading = false; fixture.user = null; await renderRows([dated({ amounts_visible: false, total: null })]);
  expect(host.textContent).not.toContain('$100');
  await renderRows([dated()], true); expect(host.querySelector('article')).toBeNull();
});

it('removes a receipt whose current day reader no longer returns it, without showing a different receipt’s lines', async () => {
  fixture.rpc.mockResolvedValue({ data: { tied: false, documents: [{ ...page(), receipt_id: 'other' }] }, error: null });
  await renderRows([dated()]); await click('Read lines', () => !host.querySelector('article'));
  expect(host.querySelector('article')).toBeNull(); expect(host.textContent).not.toContain('Machine existing block');
});


it('resets the selected supplier and browse scope when the vehicle or viewer changes', async () => {
  await renderRows([dated({ vendor_name: 'Supplier A' }), dated({ id: 'receipt-b', vendor_name: 'Supplier B' })]);
  const select = host.querySelector('select')!;
  await act(async () => { select.value = 'Supplier A'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(host.querySelectorAll('article')).toHaveLength(1);
  const otherRows = [dated({ vendor_name: 'Supplier C' }), dated({ id: 'receipt-d', vendor_name: 'Supplier D' })];
  await act(async () => root.render(wrapper(<ReceiptRecords vehicleId="vehicle-b" read={{ rows: otherRows, isLoading: false, isError: false, total: 2, hasNextPage: false } as any} />)));
  expect(host.querySelector('select')?.value).toBe('');
  expect(host.querySelectorAll('article')).toHaveLength(2);
  const changedSelect = host.querySelector('select')!;
  await act(async () => { changedSelect.value = 'Supplier C'; changedSelect.dispatchEvent(new Event('change', { bubbles: true })); });
  fixture.user = { id: 'another-viewer' };
  await act(async () => root.render(wrapper(<ReceiptRecords vehicleId="vehicle-b" read={{ rows: otherRows, isLoading: false, isError: false, total: 2, hasNextPage: false } as any} />)));
  expect(host.querySelector('select')?.value).toBe('');
  expect(host.querySelectorAll('article')).toHaveLength(2);
});


it('clears a supplier that disappears after a current-source refresh', async () => {
  const a = dated({ vendor_name: 'Supplier A' }), b = dated({ id: 'receipt-b', vendor_name: 'Supplier B' });
  await renderRows([a, b]);
  const select = host.querySelector('select')!;
  await act(async () => { select.value = 'Supplier A'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(host.querySelectorAll('article')).toHaveLength(1);
  await renderRows([b]);
  expect(host.querySelector('article')?.textContent).toContain('Supplier B');
});

it('bounds a stalled receipt read and exposes Retry', async () => {
  await renderRows([dated()]);
  fixture.rpc.mockImplementation(() => new Promise(() => {}));
  vi.useFakeTimers();
  try {
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Read lines')!.click());
    await act(async () => vi.advanceTimersByTimeAsync(20001));
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(host.textContent).toContain('Line items could not load.');
    expect([...host.querySelectorAll('button')].some(button => button.textContent === 'Retry')).toBe(true);
  } finally { vi.useRealTimers(); }
});
