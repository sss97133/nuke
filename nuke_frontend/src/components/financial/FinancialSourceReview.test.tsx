// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), encode: vi.fn() }));
vi.mock('../../services/financialSourceReview', () => ({ loadPrivateSource: mock.load, saveReviewedSource: mock.save, sourceRasterPng: mock.encode }));
import FinancialSourceReview from './FinancialSourceReview';
let div: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mock.load.mockReset(); mock.save.mockReset(); mock.encode.mockReset();
  div = document.createElement('div'); document.body.append(div); root = createRoot(div);
});
afterEach(async () => { await act(async () => root.unmount()); div.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('does not read private originals until explicitly opened and reports actionable failure', async () => {
  mock.load.mockRejectedValue(new Error('Sign in to review your source'));
  await act(async () => root.render(<FinancialSourceReview documentId="doc" onComplete={() => {}} />));
  expect(mock.load).not.toHaveBeenCalled();
  await act(async () => div.querySelector('button')!.click());
  expect(div.textContent).toContain('Sign in to review your source');
  expect(mock.save).not.toHaveBeenCalled();
});
it('requires inspection of the exact preview before the explicit save', async () => {
  const pixels = new Uint8ClampedArray([0, 0, 0, 255]);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect() {}, drawImage() {}, getImageData: () => ({ data: pixels }) } as any);
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close() {} })));
  URL.createObjectURL = vi.fn(() => 'blob:private-preview'); URL.revokeObjectURL = vi.fn();
  mock.load.mockResolvedValue({ blob: new Blob(), userId: 'owner', document: { content_sha256: 'hash' } });
  mock.encode.mockResolvedValue(new Blob()); mock.save.mockResolvedValue({ document_id: 'doc' });
  const complete = vi.fn();
  await act(async () => root.render(<FinancialSourceReview documentId="doc" onComplete={complete} />));
  await act(async () => div.querySelector('button')!.click());
  await act(async () => Array.from(div.querySelectorAll('button')).find(b => b.textContent === 'Preview redacted copy')!.click());
  const save = Array.from(div.querySelectorAll('button')).find(b => b.textContent === 'Save reviewed private copy')!;
  expect(save.disabled).toBe(true); expect(mock.save).not.toHaveBeenCalled();
  await act(async () => (div.querySelectorAll('input[type="checkbox"]')[1] as HTMLInputElement).click());
  expect(save.disabled).toBe(false);
  await act(async () => save.click());
  expect(mock.save).toHaveBeenCalledTimes(1); expect(complete).toHaveBeenCalledTimes(1);
  expect(div.textContent).toContain('Reviewed private copy saved');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-preview');
});
