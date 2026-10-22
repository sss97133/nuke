// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
const restore = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ listener: null as null | ((event: string, session: any) => void) }));
vi.mock('../../lib/supabase', () => ({ supabase: { auth: { getUser: async () => ({ data: { user: { id: 'owner', is_anonymous: false } }, error: null }), onAuthStateChange: (listener: any) => { auth.listener = listener; return { data: { subscription: { unsubscribe() {} } } }; } } } }));
vi.mock('../../services/financialEvidenceRestore', () => ({ restoreFinancialEvidence: restore }));
import FinancialEvidenceRestore from './FinancialEvidenceRestore';
it('requires explicit submit after file selection and reports restoration without tax completion', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  restore.mockResolvedValue({ documents: 1, revisions: 2, verified: 1, expense_posted: false, tax_ready: false });
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(<FinancialEvidenceRestore />));
    expect(restore).not.toHaveBeenCalled();
    const input = container.querySelector('input')!;
    Object.defineProperty(input, 'files', { value: [new File(['{}'], 'synthetic.json', { type: 'application/json' })] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(restore).not.toHaveBeenCalled();
    await act(async () => container.querySelector('button')!.click());
    expect(restore).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Verified 1 originals and 2 retained revisions');
    expect(container.textContent).toContain('Accounting and tax review remain open');
    await act(async () => auth.listener?.('SIGNED_IN', { user: { id: 'another-owner', is_anonymous: false } }));
    expect(container.textContent).not.toContain('Verified 1 originals');
    expect(container.querySelector('button')!.disabled).toBe(true);
    expect(input.value).toBe('');
  } finally { await act(async () => root.unmount()); container.remove(); }
});

const restored = { documents: 1, revisions: 2, verified: 1, expense_posted: false, tax_ready: false };
async function queueFixture() {
  restore.mockReset();
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  await act(async () => root.render(<FinancialEvidenceRestore />));
  const input = container.querySelector('input')!;
  const files = ['first.json', 'second.json', 'third.json'].map(name => new File(['{}'], name));
  Object.defineProperty(input, 'files', { value: files });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  return { container, close: async () => { await act(async () => root.unmount()); container.remove(); } };
}
it('runs bundles serially and resumes failure without replaying verified bundles', async () => {
  const f = await queueFixture(); let finish!: (value: typeof restored) => void;
  restore.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockRejectedValueOnce(new Error('Temporary failure')).mockResolvedValue(restored);
  try {
    expect(f.container.querySelector('input')!.multiple).toBe(true);
    expect(restore).not.toHaveBeenCalled();
    await act(async () => f.container.querySelector('button')!.click());
    expect(restore).toHaveBeenCalledTimes(1);
    expect(f.container.textContent).toContain('Current bundle: first.json');
    await act(async () => finish(restored));
    expect(restore).toHaveBeenCalledTimes(2);
    expect(f.container.textContent).toContain('1 of 3 bundles verified');
    expect(f.container.textContent).toContain('Next bundle: second.json');
    expect(f.container.textContent).toContain('Temporary failure');
    await act(async () => f.container.querySelector('button')!.click());
    expect(restore.mock.calls.map(call => call[0].name)).toEqual(['first.json', 'second.json', 'second.json', 'third.json']);
    expect(f.container.textContent).toContain('3 of 3 bundles verified');
    expect(f.container.textContent).toContain('Verified 3 originals and 6 retained revisions');
    expect(f.container.querySelector('button')!.disabled).toBe(true);
  } finally { await f.close(); }
});
it('stops without starting another bundle and retries the unacknowledged bundle', async () => {
  const f = await queueFixture(); let finish!: (value: typeof restored) => void;
  restore.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(restored);
  try {
    await act(async () => f.container.querySelector('button')!.click());
    await act(async () => f.container.querySelectorAll('button')[1].click());
    expect(restore.mock.calls[0][2].aborted).toBe(true);
    await act(async () => finish(restored));
    expect(restore).toHaveBeenCalledTimes(1);
    expect(f.container.textContent).toContain('0 of 3 bundles verified');
    await act(async () => f.container.querySelector('button')!.click());
    expect(restore.mock.calls.map(call => call[0].name)).toEqual(['first.json', 'first.json', 'second.json', 'third.json']);
  } finally { await f.close(); }
});
it('clears the queue and ignores late progress and success after an account switch', async () => {
  const f = await queueFixture(); let finish!: (value: typeof restored) => void;
  restore.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  try {
    await act(async () => f.container.querySelector('button')!.click());
    await act(async () => auth.listener?.('SIGNED_IN', { user: { id: 'different-owner', is_anonymous: false } }));
    await act(async () => { restore.mock.calls[0][1]({ stage: 'admitting', completed: 1, total: 2 }); finish(restored); });
    expect(restore).toHaveBeenCalledTimes(1);
    expect(f.container.textContent).not.toContain('first.json');
    expect(f.container.textContent).not.toContain('Verified 1 originals');
    expect(f.container.textContent).not.toContain('revisions acknowledged');
    expect(f.container.textContent).not.toContain('Recovery paused');
    expect(f.container.querySelector('button')!.disabled).toBe(true);
  } finally { await f.close(); }
});

it('reports same-account manual abort as paused and resumes without requesting sign-in', async () => {
  const f = await queueFixture();
  restore.mockImplementationOnce((_file, _progress, signal: AbortSignal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Sign in to the original account to resume.'))))).mockResolvedValue(restored);
  try {
    await act(async () => f.container.querySelector('button')!.click());
    await act(async () => f.container.querySelectorAll('button')[1].click());
    expect(f.container.textContent).toContain('Recovery paused. Resume the selected bundles to continue.');
    expect(f.container.textContent).not.toContain('Sign in to the original account');
    expect(f.container.querySelector('button')!.disabled).toBe(false);
    await act(async () => f.container.querySelector('button')!.click());
    expect(f.container.textContent).toContain('3 of 3 bundles verified');
    expect(f.container.textContent).not.toContain('Recovery paused');
  } finally { await f.close(); }
});
