// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('../../lib/supabase',()=>({supabase:{rpc:fixture.rpc}}));
import AccountingAccess from './AccountingAccess';
let container:HTMLDivElement, root:Root;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;fixture.rpc.mockReset();container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
async function enter(value:string){const input=container.querySelector('input')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});}
it('requires reviewing the existing identity before binding a grant to its UUID',async()=>{
 fixture.rpc.mockResolvedValueOnce({data:{id:'member-id',username:'reviewer',email:'r•••@•••',full_name:'Reviewer'},error:null}).mockResolvedValueOnce({data:{},error:null});
 const changed=vi.fn();await act(async()=>root.render(<AccountingAccess actorId="owner" grants={[]} onChanged={changed}/>));
 await enter('reviewer');expect(fixture.rpc).not.toHaveBeenCalled();
 await act(async()=>Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='Find account')!.click());
 expect(container.textContent).toContain('r•••@•••');expect(fixture.rpc).toHaveBeenCalledTimes(1);
 await act(async()=>Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='Grant this account access')!.click());
 expect(fixture.rpc).toHaveBeenLastCalledWith('set_accounting_access',{p_member_id:'member-id',p_access:'review'});expect(changed).toHaveBeenCalledTimes(1);
});
it('failed lookup releases controls and account change suppresses an in-flight private result',async()=>{
 fixture.rpc.mockRejectedValueOnce(new Error('offline'));
 await act(async()=>root.render(<AccountingAccess actorId="owner" grants={[]} onChanged={()=>{}}/>));await enter('reviewer');
 await act(async()=>Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='Find account')!.click());expect(container.textContent).toContain('No unique confirmed account');expect(container.querySelector('button')?.disabled).toBe(false);
 let resolve:any;fixture.rpc.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 await act(async()=>Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='Find account')!.click());
 await act(async()=>root.render(<AccountingAccess actorId="different-owner" grants={[]} onChanged={()=>{}}/>));
 await act(async()=>resolve({data:{id:'member-id',email:'private@example.invalid'},error:null}));
 expect(container.textContent).not.toContain('private@example.invalid');expect(container.querySelector('input')?.value).toBe('');
});
