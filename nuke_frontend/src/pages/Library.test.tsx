// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
vi.mock('../utils/cachedSession', () => ({ readCachedSession: () => null }));
vi.mock('../lib/supabase', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { user: { id:'fixture-user' } } } }) },
  from(table: string) {
    let fields = '', libraries: string[] = [];
    const docs = ['2026-03-01','2026-01-01'].map((uploaded_at,i) => ({ id:`doc${i}`, library_id:'library1', uploaded_by:'fixture-user', title:`Fixture book ${i}`, uploaded_at,
      download_count:1, document_type:'manual', reference_libraries:{year:1980,make:'Fixture'}, document_extractions:[] }));
    const q: any = {
      select(value: string) { fields=value; return q; }, eq() { return q; }, order() { return q; },
      in(field: string, values: string[]) { if (field === 'library_id') libraries=values; return q; },
      then(resolve: any) {
        const data = table === 'library_documents' ? fields.includes('reference_libraries') ? docs : docs.map(doc => Object.fromEntries(fields.split(',').map(key => [key.trim(),(doc as any)[key.trim()]])))
          : table === 'vehicle_library_links' ? libraries.includes('library1') ? [{vehicle_id:'vehicle1',library_id:'library1'}] : [] : [];
        return Promise.resolve({data,error:null}).then(resolve);
      },
    }; return q;
  },
} }));
import Library from './Library';
it('keeps books uploaded months apart separate and calculates library usage from projected ids', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'), root=createRoot(host);
  try {
    await act(async () => root.render(<MemoryRouter><Library /></MemoryRouter>));
    expect(host.textContent).toContain('Fixture book 0');
    expect(host.textContent).toContain('Fixture book 1');
    expect(host.textContent).not.toContain('2 Pages');
    const usage = Array.from(host.querySelectorAll('.card-body')).find(el => el.textContent?.includes('Vehicles Helped'));
    expect(usage?.textContent).toBe('1Vehicles Helped');
  } finally { await act(async () => root.unmount()); }
});
