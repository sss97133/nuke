// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  reads: [] as Array<{ table: string; columns: string }>,
  updates: [] as Array<{ table: string; payload: Record<string, unknown> }>,
  rpc: { data: null as any, error: null as any },
}));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => {
        db.reads.push({ table, columns });
        return { eq: () => ({ single: async () => ({ data: { business_name: 'Synthetic Shop', metadata: {} }, error: null }) }) };
      },
      update: (payload: Record<string, unknown>) => {
        db.updates.push({ table, payload });
        return { eq: async () => ({ error: null }) };
      },
    }),
    rpc: async () => db.rpc,
  },
}));
import MarketplaceComplianceForm from './MarketplaceComplianceForm';

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  db.reads = []; db.updates = []; db.rpc = { data: null, error: null };
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

const taxInput = () => {
  const label = Array.from(container.querySelectorAll('label')).find((l) => l.textContent === 'Tax ID / EIN')!;
  return label.nextElementSibling as HTMLInputElement;
};
const submit = async () => {
  await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
};

describe('private compliance fields', () => {
  it('reads tax_id only through the editor reader and saves through organizations', async () => {
    db.rpc = { data: { tax_id: 'synthetic-tax-id', business_license: null }, error: null };
    await act(async () => root.render(<MarketplaceComplianceForm organizationId="org-1" canEdit />));
    expect(db.reads.every((r) => !r.columns.includes('tax_id'))).toBe(true);
    expect(taxInput().value).toBe('synthetic-tax-id');
    expect(taxInput().disabled).toBe(false);
    await submit();
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].table).toBe('organizations');
    expect(db.updates[0].payload.tax_id).toBe('synthetic-tax-id');
  });

  it('never saves tax_id when the private read was refused', async () => {
    db.rpc = { data: null, error: { code: '42501', message: 'refused' } };
    await act(async () => root.render(<MarketplaceComplianceForm organizationId="org-1" canEdit />));
    expect(taxInput().value).toBe('');
    expect(taxInput().disabled).toBe(true);
    await submit();
    expect(db.updates).toHaveLength(1);
    expect('tax_id' in db.updates[0].payload).toBe(false);
  });
});
