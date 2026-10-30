// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { WorkOrderRow } from './jobsReaders';
const fixture=vi.hoisted(()=>({rpc:vi.fn(),rows:[] as WorkOrderRow[],pageTwo:null as null|Promise<unknown>}));
vi.mock('../../lib/supabase',()=>({supabase:{rpc:fixture.rpc}}));
vi.mock('../../contexts/AuthContext',()=>({useAuthContext:()=>({session:{user:{id:'fixture-viewer'}}})}));
vi.mock('../../components/PrefetchLink',()=>({PrefetchLink:({to,children,...props}:{to:string;children:React.ReactNode})=><a href={to} {...props}>{children}</a>}));
import WorkPage from './WorkPage';
let host:HTMLDivElement,root:Root;
const job=(id:string,history=false):WorkOrderRow=>({work_order_id:id,vehicle_id:`vehicle-${id}`,title:`Job ${id}`,vehicle_label:{text:`Truck ${id}`},
  workload:{recorded_status:history?'completed':'in_progress',disposition:history?'history':'current',completed_at:history?'2026-04-01':null,
    updated_at:'2026-10-29',schedule:{start:null,end:null},client:`Client ${id}`,organization:{id:'shop',name:'Fixture Shop'},provider:{label:'Fixture Technician'},
    money:{visibility:'party',currency:'USD',estimate:1200,received:null},time:{estimated_hours:11.5,recorded_hours:3,remaining_hours:null,basis:'recorded job hours'},
    parts:{records:1,states:{quoted:1},basis:'recorded part states'},source:{table:'work_orders',record_id:id,as_of:'2026-10-29'}}});
const button=(text:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent===text)!;
const click=async(el:HTMLElement)=>{await act(async()=>el.click());};
async function render(){await act(async()=>root.render(<MemoryRouter><WorkPage/></MemoryRouter>));}
async function change(el:HTMLInputElement|HTMLSelectElement,value:string){await act(async()=>{
  const proto=el instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(el,value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement?'change':'input',{bubbles:true}));
});}
beforeEach(()=>{
  (globalThis as unknown as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
  fixture.rows=[job('old',true),job('build')];fixture.pageTwo=null;fixture.rpc.mockReset();
  fixture.rpc.mockImplementation((name:string,args:{p_after?:string})=>{
    if(name==='my_signature_queue')return Promise.resolve({data:{items:[],coverage:{total:0}},error:null});
    if(name==='vehicle_card_images')return Promise.resolve({data:[{vehicle_id:'vehicle-build',medium_url:'https://example.invalid/truck.jpg'}],error:null});
    if(args.p_after && fixture.pageTwo)return fixture.pageTwo;
    return Promise.resolve({data:{rows:fixture.rows,coverage:{total_for_viewer:fixture.rows.length+(fixture.pageTwo?1:0)},next_after:fixture.pageTwo?'page-2':null},error:null});
  });
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it('recognizes a job, separates estimate/pay/time/parts and sends completed work to history',async()=>{
  await render();
  expect(host.textContent).toContain('Truck build');expect(host.textContent).not.toContain('Truck old');
  expect(host.querySelector('img')?.getAttribute('src')).toBe('https://example.invalid/truck.jpg');
  expect(host.textContent).toContain('Client build');expect(host.textContent).toContain('Fixture Shop');expect(host.textContent).toContain('Fixture Technician');
  expect(host.textContent).toContain('$1,200');expect(host.textContent).toContain('11.5 h');expect(host.textContent).toContain('3 h');
  expect(host.textContent).toContain('quoted · availability unknown');expect(host.textContent).not.toContain('0 h');
  await click(button('History'));expect(host.textContent).toContain('Truck old');expect(host.textContent).not.toContain('Truck build');
  expect(host.textContent).toContain('Apr 1, 2026');
});
it('keeps a paid delivery job current and never converts its unknown received amount to zero',async()=>{
  const paid=job('paid');paid.workload!.recorded_status='paid';
  paid.retained_work={visibility:'included',responsibility_reports:[{binding_id:'source',provider_actor_id:'actor',provider_label:'Fixture Technician',
    client_label:'Fixture Client',source_observation_id:'report',reported_at:'2026-07-15',payment_state:'paid_in_full',delivery_state:'reported_owed',assurance:'owner_report'}]};
  fixture.rows=[paid];await render();
  expect(host.textContent).toContain('Truck paid');expect(host.textContent).toContain('Paid in full');expect(host.textContent).not.toContain('$0');
  expect(host.textContent).toContain('owes delivery');
});
it('waits for the full cohort and searches a job beyond the first page',async()=>{
  let finish!:(value:unknown)=>void;fixture.pageTwo=new Promise(resolve=>{finish=resolve;});
  await render();const search=host.querySelector<HTMLInputElement>('input[type="search"]')!;
  expect(search.disabled).toBe(true);
  await act(async()=>finish({data:{rows:[job('second-page')],coverage:{total_for_viewer:3},next_after:null},error:null}));
  expect(search.disabled).toBe(false);await change(search,'second-page');
  expect(host.textContent).toContain('Truck second-page');expect(host.textContent).not.toContain('Truck build');
  expect(host.textContent).toContain('1 shown');
});
it('filters by a client or shop and sorts by a supported time commitment',async()=>{
  const bigger=job('bigger');bigger.workload!.time.estimated_hours=80;fixture.rows=[job('build'),bigger];await render();
  await change(host.querySelectorAll('select')[1],'hours');
  expect(host.querySelector('.jb-work-list > li')?.textContent).toContain('Truck bigger');
  await change(host.querySelectorAll('select')[0],'Client build');
  expect(host.textContent).toContain('Truck build');expect(host.textContent).not.toContain('Truck bigger');
});
