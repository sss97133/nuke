// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({ process:vi.fn(), changed:null as null|(()=>void) }));
vi.mock('../../lib/supabase',()=>({supabase:{auth:{onAuthStateChange(cb:()=>void){fixture.changed=cb;return{data:{subscription:{unsubscribe(){}}}};}}}}));
vi.mock('../../services/financialEvidenceIntake',async importOriginal=>({...(await importOriginal<typeof import('../../services/financialEvidenceIntake')>()),processFinancialDocument:fixture.process}));
import FinancialDocumentIntake from './FinancialDocumentIntake';
let container:HTMLDivElement,root:Root;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;fixture.process.mockReset();fixture.process.mockResolvedValue({documentId:'doc',status:'needs_review',reused:false});container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
it('selecting files grants access but starts no processing until explicit submit',async()=>{
 const done=vi.fn();await act(async()=>root.render(<FinancialDocumentIntake onComplete={done}/>));
 const input=container.querySelector('input')!;Object.defineProperty(input,'files',{value:[new File(['x'],'document.jpg',{type:'image/jpeg'})]});
 await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));
 expect(fixture.process).not.toHaveBeenCalled();
 await act(async()=>container.querySelector('button')!.click());
 expect(fixture.process).toHaveBeenCalledOnce();expect(done).toHaveBeenCalledWith('doc');
 expect(container.textContent).toContain('reconciliation needs review');expect(container.textContent).not.toContain('Reconciliation complete');
});
it('account change clears selected files and private outcomes',async()=>{
 await act(async()=>root.render(<FinancialDocumentIntake onComplete={()=>{}}/>));
 const input=container.querySelector('input')!;Object.defineProperty(input,'files',{value:[new File(['x'],'private.jpg')]});
 await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));
 await act(async()=>fixture.changed?.());
 expect(container.querySelector('button')!.disabled).toBe(true);expect(fixture.process).not.toHaveBeenCalled();
});

// ── added for a row of the books: the same flow with a link target ────────────────────────────────────────────────────────────
const link = { year: '2024', local_id: 'L1', source_key: 'a'.repeat(64), decision_document_id: 'decision-doc', required_doc_kind: 'invoice_or_agreement' };
const choose = async (files: File[]) => { const input = container.querySelector('input[type="file"]')!; Object.defineProperty(input, 'files', { value: files, configurable: true }); await act(async () => input.dispatchEvent(new Event('change', { bubbles: true }))); };
const submitButton = () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Add to this row' || b.textContent === 'Adding…') as HTMLButtonElement;
const kindSelect = () => container.querySelector('select') as HTMLSelectElement;

it('with a link target it adds the chosen files as the paper for that row: the owner\'s words for the file travel with the row\'s target, one file at a time, and the plain flow sends no target', async () => {
  fixture.process.mockResolvedValue({ documentId: 'doc', status: 'blocked', reused: false, readback: {}, linked: { field_key: 'k', already: false } });
  const done = vi.fn();
  await act(async () => root.render(<FinancialDocumentIntake onComplete={done} link={link} kinds={['Invoice', 'Contract']} label="Add the paper for Painter Co"><p>This row needs an invoice.</p></FinancialDocumentIntake>));
  expect(container.querySelector('[role="group"]')!.getAttribute('aria-label')).toBe('Add the paper for Painter Co');
  expect(container.textContent).toContain('This row needs an invoice.');
  expect(Array.from(container.querySelectorAll('option')).map(o => o.textContent)).toEqual(['Invoice', 'Contract']);
  expect(submitButton().disabled).toBe(true);
  const first = new File(['x'], 'one.pdf', { type: 'application/pdf' }), second = new File(['y'], 'two.pdf', { type: 'application/pdf' });
  await choose([first, second]);
  expect(fixture.process).not.toHaveBeenCalled();
  await act(async () => { kindSelect().value = 'Contract'; kindSelect().dispatchEvent(new Event('change', { bubbles: true })); });
  await act(async () => submitButton().click());
  expect(fixture.process).toHaveBeenCalledTimes(2);
  expect(fixture.process.mock.calls.map(c => [c[0], c[2]])).toEqual([[first, { ...link, doc_kind: 'Contract' }], [second, { ...link, doc_kind: 'Contract' }]]);
  expect(done).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain('one.pdf: Added. The file is stored privately and pointed at this row.');
  expect(container.textContent).toContain('Document received, link pending');
  // a file that is added is done with: the chooser is empty and nothing can be added twice
  expect(submitButton().disabled).toBe(true);
  expect((container.querySelector('input[type="file"]') as HTMLInputElement).value).toBe('');
});

it('a file the row already has is said so, and a refusal is said in words and keeps the file for another try', async () => {
  fixture.process.mockResolvedValueOnce({ documentId: 'doc', status: 'blocked', reused: true, readback: {}, linked: { field_key: 'k', already: true } });
  await act(async () => root.render(<FinancialDocumentIntake onComplete={() => {}} link={link} kinds={['Invoice']} />));
  await choose([new File(['x'], 'one.pdf', { type: 'application/pdf' })]);
  await act(async () => submitButton().click());
  expect(container.querySelector('[role="status"]')!.textContent).toBe('This file was already added for this row.');
  fixture.process.mockRejectedValueOnce(new Error('The private upload failed. Retry this file to continue.'));
  await choose([new File(['x'], 'two.pdf', { type: 'application/pdf' })]);
  await act(async () => submitButton().click());
  expect(container.querySelector('[role="alert"]')!.textContent).toBe('The private upload failed. Retry this file to continue.');
  expect(submitButton().disabled).toBe(false); // the file stays for another try
});

it('the stage is said in plain words while a file is added, for a row or not', async () => {
  let release!: () => void;
  fixture.process.mockImplementation((_f: File, stage: (s: string) => void) => { stage('uploading'); return new Promise(resolve => { release = () => resolve({ documentId: 'doc', status: 'needs_review', reused: false, readback: {} }); }); });
  await act(async () => root.render(<FinancialDocumentIntake onComplete={() => {}} />));
  await choose([new File(['x'], 'plain.pdf', { type: 'application/pdf' })]);
  await act(async () => { container.querySelector('button')!.click(); });
  expect(container.textContent).toContain('plain.pdf: Uploading it privately…');
  expect(container.textContent).not.toContain('plain.pdf: uploading');
  await act(async () => release());
  await act(async () => root.render(<FinancialDocumentIntake onComplete={() => {}} link={link} kinds={['Invoice']} />));
  await choose([new File(['x'], 'row.pdf', { type: 'application/pdf' })]);
  await act(async () => submitButton().click());
  expect(container.querySelector('[role="status"]')!.textContent).toBe('row.pdf: Uploading it privately…');
  expect((container.querySelector('input[type="file"]') as HTMLInputElement).disabled).toBe(true);
  expect(kindSelect().disabled).toBe(true);
  await act(async () => release());
});
