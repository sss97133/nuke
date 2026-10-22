// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({ process:vi.fn(), changed:null as null|(()=>void) }));
vi.mock('../../lib/supabase',()=>({supabase:{auth:{onAuthStateChange(cb:()=>void){fixture.changed=cb;return{data:{subscription:{unsubscribe(){}}}};}}}}));
vi.mock('../../services/financialEvidenceIntake',()=>({processFinancialDocument:fixture.process}));
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
