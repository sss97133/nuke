// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ from: vi.fn(), eq: vi.fn(), sign: vi.fn(), privatePath: vi.fn() }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/synthetic-pdf-worker.mjs' }));
vi.mock('../../lib/supabase', () => ({ supabase: { from: fixture.from } }));
vi.mock('../../lib/privateStorage', () => ({ signPrivateStorageUrl: fixture.sign, privateStoragePath: fixture.privatePath }));
import { ReceiptRecords } from './FinancialReceiptRecords';
import { parseVehicleReceiptRecord } from './hooks/useBuildLedger';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
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
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = async () => act(async () => {
  const read = { rows: [parseVehicleReceiptRecord({ id: 'receipt-a', vendor_name: 'Synthetic part', total: 15, currency: 'USD', source_document_table: 'vehicle_documents', source_document_id: 'source-a' })],
    isLoading: false, isError: false, total: 1, hasNextPage: false } as any;
  root.render(<ReceiptRecords vehicleId="vehicle-a" read={read} />);
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
    root.render(<ReceiptRecords vehicleId="vehicle-a" read={read} />);
  });
  const summaries = [...host.querySelectorAll('summary')].map(s => s.textContent);
  expect(summaries[0]).toContain("Amount visible to the vehicle's people");
  expect(summaries[0]).not.toContain('Amount not recorded');
  expect(summaries[1]).toContain('Amount not recorded');
  expect(host.textContent).toContain('shown to the vehicle\'s owner and contributors');
});
