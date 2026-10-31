// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/synthetic-pdf-worker.mjs' }));
vi.mock('../../services/accountingCloseout', async importOriginal => ({ ...await importOriginal<typeof import('../../services/accountingCloseout')>(), fetchAccountingOriginal: fixture.fetch }));
import SharedAccountingOriginal, { OriginalDocumentPreview } from './SharedAccountingOriginal';

let host: HTMLDivElement, root: Root;
const blob = new Blob(['synthetic image'], { type: 'image/png' });
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:synthetic-original');
    static revokeObjectURL = vi.fn();
  });
  fixture.fetch.mockReset().mockResolvedValue({ blob, filename: 'receipt.png' });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = async (ownerId = 'owner-a', documentId = 'doc-a') => act(async () => {
  root.render(<SharedAccountingOriginal ownerId={ownerId} documentId={documentId} />);
});
const click = async (text: string) => act(async () => {
  [...host.querySelectorAll('button')].find(button => button.textContent === text)!.click();
});

it('reads an original in place, preserves the record and returns focus without opening or downloading', async () => {
  await render(); await click('Read private original');
  expect(fixture.fetch).toHaveBeenCalledWith('owner-a', 'doc-a');
  expect(host.querySelector('img')?.src).toBe('blob:synthetic-original');
  expect(host.querySelector('a[target]')).toBeNull();
  expect(host.querySelector('a[download]')?.textContent).toBe('Download original');
  await click('Close original');
  expect(host.querySelector('img')).toBeNull();
  expect(document.activeElement?.textContent).toBe('Read private original');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-original');
});

it('drops private bytes and ignores an in-flight old source when the subject changes', async () => {
  await render(); await click('Read private original');
  await render('owner-b');
  expect(host.querySelector('img')).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalled();
  let resolve!: (value: unknown) => void;
  fixture.fetch.mockReturnValue(new Promise(done => { resolve = done; }));
  await click('Read private original');
  await render('owner-c');
  await act(async () => resolve({ blob, filename: 'old-private.png' }));
  expect(host.textContent).not.toContain('old-private');
  expect(host.querySelector('img')).toBeNull();
});

it('retains access denial without displaying private errors or a stale original', async () => {
  fixture.fetch.mockRejectedValue(new Error('synthetic private server detail'));
  await render(); await click('Read private original');
  expect(host.textContent).toContain('Original unavailable or access revoked');
  expect(host.textContent).not.toContain('synthetic private');
  expect(host.querySelector('img')).toBeNull();
});

it('never executes an HTML original inside the profile', async () => {
  await act(async () => root.render(<OriginalDocumentPreview blob={new Blob(['<script>bad()</script>'], { type: 'text/html' })} filename="source.html" onClose={() => {}} />));
  expect(host.textContent).toContain('does not support an inline preview');
  expect(host.querySelector('iframe, object, script')).toBeNull();
});

it('shows bank CSV source text inline and escapes markup within its cells', async () => {
  const source = '<script>bad()</script>,12.50\nSynthetic vendor,40.00';
  const csv = Object.assign(new Blob([source], { type: 'text/csv' }), { text: () => Promise.resolve(source) });
  fixture.fetch.mockResolvedValue({ blob: csv, filename: 'statement.csv' });
  await render(); await click('Read private original');
  expect(host.querySelector('pre')?.textContent).toBe(source);
  expect(host.querySelector('iframe, object, script, a[target]')).toBeNull();
  expect(host.textContent).not.toContain('does not support an inline preview');
});
