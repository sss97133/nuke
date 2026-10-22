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
