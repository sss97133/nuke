// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ rpc:vi.fn(), from:vi.fn(), getUser:vi.fn(), user:{id:'viewer-a'} as {id:string}|null, loading:false }));
vi.mock('../../../lib/supabase', () => ({supabase:{rpc:fixture.rpc,from:fixture.from,auth:{getUser:fixture.getUser}}}));
vi.mock('../../../hooks/useAuth', () => ({useAuth:()=>({user:fixture.user,loading:fixture.loading})}));
import { useWorkOrderStatement } from './useWorkOrderStatement';
const query = 'wo:00000000-0000-4000-a000-000000000001';
let controls: ReturnType<typeof useWorkOrderStatement>;
function Harness() { controls = useWorkOrderStatement(query); return <output>{JSON.stringify(controls.data)}</output>; }
let host: HTMLDivElement, root: Root, client: QueryClient;
const render = async () => {
  await act(async () => root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
};
const response = (memo = 'Original payment') => ({ data:{vehicle:{id:'v'},work_orders:[{id:'wo',money_visible:true,parts:[{id:'part',part_name:'Part',total_price:20,is_comped:false}],labor:[],payments:[{id:'payment',amount:10,memo,status:'completed'}]}]},error:null });
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); fixture.user={id:'viewer-a'}; fixture.loading=false;
  fixture.rpc.mockReset().mockResolvedValue(response()); fixture.from.mockReset(); fixture.getUser.mockReset().mockResolvedValue({data:{user:fixture.user},error:null});
  client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}}); host=document.createElement('div'); document.body.append(host); root=createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.unstubAllGlobals(); });

it.each(['field', 'delete', 'comp'] as const)('keeps the last read values while %s is pending or refused', async kind => {
  let finish!: (value: {error: {message:string} | null}) => void;
  const result = new Promise(resolve => { finish=resolve; });
  fixture.from.mockReturnValue({update:()=>({eq:()=>result}),delete:()=>({eq:()=>result})});
  await render(); const before=host.textContent; let failure:unknown; let pending!:Promise<unknown>;
  await act(async () => {
    pending = (kind==='field' ? controls.updateField('work_order_payments','payment','amount',99) : kind==='delete' ? controls.deleteRow('work_order_payments','payment') : controls.toggleComp('work_order_parts','part')).catch(error => {failure=error;});
  });
  expect(host.textContent).toBe(before);
  await act(async () => { finish({error:{message:'Writer refused'}}); await pending; });
  expect(failure).toEqual({message:'Writer refused'}); expect(host.textContent).toBe(before);
  expect(fixture.rpc).toHaveBeenCalledTimes(1);
});

it('updates the original cache after success and preserves the audit writer', async () => {
  let finish!: (value: {error:null,count:1}) => void; const write=new Promise(resolve=>{finish=resolve;});
  const audit=vi.fn().mockResolvedValue({error:null,count:1});
  fixture.from.mockImplementation(table => table==='work_order_edit_log' ? {insert:audit} : {update:()=>({eq:()=>write})});
  await render(); let pending!:Promise<unknown>;
  await act(async () => { pending=controls.updateField('work_order_payments','payment','amount',99); });
  expect(controls.data?.payments.wo[0].amount).toBe(10);
  await act(async () => { finish({error:null,count:1}); await pending; });
  await render(); expect(controls.data?.payments.wo[0].amount).toBe(99);
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({row_id:'payment',old_value:'10',new_value:'99',edited_by:'viewer-a'}));
});

it('does not dispatch a save after the viewer changes during the existing user lookup', async () => {
  let finish!: (value:unknown) => void; fixture.getUser.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  await render(); let pending!:Promise<unknown>; let failure:unknown;
  await act(async () => { pending=controls.updateField('work_order_payments','payment','amount',99).catch(error=>{failure=error;}); });
  fixture.user={id:'viewer-b'}; fixture.rpc.mockResolvedValue(response('B payment')); await render();
  await act(async () => { finish({data:{user:{id:'viewer-b'}},error:null}); await pending; });
  expect(fixture.from).not.toHaveBeenCalled(); expect((failure as Error).message).toContain('viewer changed'); expect(host.textContent).toContain('B payment');
});

it('never applies a former-viewer save result to the new viewer cache', async () => {
  let finish!: (value:{error:null,count:1})=>void; const write=new Promise(resolve=>{finish=resolve;});
  fixture.from.mockReturnValue({delete:()=>({eq:()=>write})});
  await render(); let pending!:Promise<unknown>;
  await act(async () => { pending=controls.deleteRow('work_order_payments','payment'); });
  fixture.user={id:'viewer-b'}; fixture.rpc.mockResolvedValue(response('B payment')); await render();
  await act(async () => { finish({error:null,count:1}); await pending; });
  expect(host.textContent).toContain('B payment'); expect(controls.data?.payments.wo).toHaveLength(1);
});


it.each(['field', 'delete', 'comp'] as const)('requires one affected row for %s even without a transport error', async kind => {
  const update=vi.fn(()=>({eq:async()=>({error:null,count:0})}));
  const remove=vi.fn(()=>({eq:async()=>({error:null,count:0})}));
  fixture.from.mockReturnValue({update,delete:remove}); await render(); const before=host.textContent;
  const action=()=>kind==='field' ? controls.updateField('work_order_payments','payment','amount',99) : kind==='delete' ? controls.deleteRow('work_order_payments','payment') : controls.toggleComp('work_order_parts','part');
  await act(async()=>{await expect(action()).rejects.toThrow('No record was changed');});
  expect(host.textContent).toBe(before);
  if(kind==='delete')expect(remove).toHaveBeenCalledWith({count:'exact'});
  else expect(update).toHaveBeenCalledWith(expect.any(Object),{count:'exact'});
});

it('treats missing affected-row evidence as unconfirmed rather than success', async () => {
  fixture.from.mockReturnValue({update:()=>({eq:async()=>({error:null,count:null})})}); await render();
  await act(async()=>{await expect(controls.updateField('work_order_payments','payment','amount',99)).rejects.toThrow('could not be confirmed');});
  expect(controls.data?.payments.wo[0].amount).toBe(10);
});
