// @vitest-environment jsdom
import React,{act}from'react';
import{createRoot,type Root}from'react-dom/client';
import{afterEach,beforeEach,expect,it,vi}from'vitest';
const f=vi.hoisted(()=>({response:null as any,change:null as null|((event?:string)=>void)}));
vi.mock('../../lib/supabase',()=>({supabase:{auth:{onAuthStateChange(cb:(event?:string)=>void){f.change=cb;return{data:{subscription:{unsubscribe(){}}}};}},functions:{invoke:async()=>({data:f.response,error:null})}}}));
import FinancialDocumentLines from'./FinancialDocumentLines';
let root:Root,container:HTMLDivElement;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;container=document.createElement('div');document.body.append(container);root=createRoot(container);f.response={data:{lines:[{id:'line',line_number:1,description:'Synthetic filter',quantity:null,attributes:{staging:{amount:'12.34',currency:null,unit_price:null,source_row:2},recognition_status:'not_assessed'}}]}};});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
it('shows observed items with unknowns and no fabricated totals',async()=>{await act(async()=>root.render(<FinancialDocumentLines documentId="doc"/>));expect(container.textContent).toContain('Synthetic filter');expect(container.textContent).toContain('12.34');expect(container.textContent).toContain('currency unresolved');expect(container.textContent).toContain('Not extracted');expect(container.textContent).toContain('Image region not retained');expect(container.textContent).not.toContain('deductible');});
it('clears private lines on account changes',async()=>{await act(async()=>root.render(<FinancialDocumentLines documentId="doc"/>));await act(async()=>f.change?.());expect(container.textContent).not.toContain('Synthetic filter');});
it('distinguishes unavailable reader from empty item population',async()=>{f.response={data:{fields:[]}};await act(async()=>root.render(<FinancialDocumentLines documentId="doc"/>));expect(container.textContent).toContain('not available yet');});

it('initial session event does not cancel item loading',async()=>{await act(async()=>root.render(<FinancialDocumentLines documentId="doc"/>));await act(async()=>f.change?.('INITIAL_SESSION'));expect(container.textContent).toContain('Synthetic filter');});

it('explains bank suggestions without claiming an existing booking',async()=>{
 f.response.data.context={status:'unique_candidate',bank_candidates:[{source_key:'synthetic-bank',days_difference:2,witnesses:['same_merchant_literal']}],already_booked:[],ledger_candidates:[{source_key:'synthetic-entry',section:'Expense',basis:'amount_currency_date_candidate_only'}],missing:[],population:{loaded_rows:4,expected_rows:4,complete:true}};
 await act(async()=>root.render(<FinancialDocumentLines documentId="doc"/>));
 expect(container.textContent).toContain('1 possible bank transaction');expect(container.textContent).toContain('2 days after');expect(container.textContent).toContain('No explicit link');expect(container.textContent).toContain('do not prove the purchase was already recorded');
});
it('shows only direct source proof as already recorded and explains partial coverage',async()=>{
 f.response.data.context={status:'missing',bank_candidates:[],already_booked:[{source_key:'entry',section:'Expense',basis:'explicit_document_source_link'},{source_key:'suggestion',section:'Expense',basis:'amount_match'}],missing:['supported_currency','accounting_reader_failed'],population:{loaded_rows:3,expected_rows:8,complete:false}};
 await act(async()=>root.render(<FinancialDocumentLines documentId="doc"/>));
 expect(container.textContent).toContain('1 existing accounting entry is explicitly linked');expect(container.textContent).toContain('search is partial');expect(container.textContent).toContain('currency supported by the source');expect(container.textContent).not.toContain('supported_currency');expect(container.textContent).not.toContain('accounting_reader_failed');
 await act(async()=>f.change?.());expect(container.textContent).not.toContain('explicitly linked');
});
