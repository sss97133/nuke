// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ rpc:vi.fn(), user:{id:'viewer-a'} as {id:string}|null, loading:false }));
vi.mock('../../lib/supabase', () => ({supabase:{rpc:fixture.rpc}}));
vi.mock('../../hooks/useAuth', () => ({useAuth:()=>({user:fixture.user,loading:fixture.loading})}));
vi.mock('../../hooks/usePageTitle', () => ({usePageTitle:()=>{}}));
vi.mock('../../hooks/useIsMobile', () => ({useIsMobile:()=>false}));
import VehicleJobs from '../VehicleJobs';
import VehicleWorkCard from './VehicleWorkCard';
import WorkPlanPanel from './WorkPlanPanel';
import InspectionCallout from './InspectionCallout';

const vehicle='00000000-0000-4000-a000-000000000001';
const first='00000000-0000-4000-a000-000000000002';
const second='00000000-0000-4000-a000-000000000003';
const orders=(title='Example job', next:string|null=null, id=first)=>({data:{as_of:'2026-10-25T00:00:00Z',vehicle_id:vehicle,vehicle_label:{text:'Synthetic vehicle'},viewer:{vehicle_access:{can_post_work_request:false},actions:[]},rows:[{work_order_id:id,display_title:title,slots:[]}],next_after:next,coverage:{returned:1,total_for_vehicle:next?2:1}},error:null});
const publication={data:{rows:[]},error:null};
const plan=(text='Synthetic listing claim')=>({data:{as_of:'2026-10-25T00:00:00Z',vehicle_id:vehicle,vehicle_label:{text:'Synthetic vehicle'},identity:{fields:{},conflicts:[],unresolved_specificity:[]},claims:[{claim_id:'claim',kind:'condition',text}],candidate_operations:[],parts:[],ppi_checklist:[{item_id:'check',question:'Synthetic check'}],inspection_scope:{inspection_type:'pre_purchase',ppi_checklist:[]}},error:null});
let host:HTMLDivElement, root:Root;
const render=async(node:React.ReactNode)=>{await act(async()=>root.render(<MemoryRouter initialEntries={[`/vehicle/${vehicle}/work`]}>{node}</MemoryRouter>));await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});};
const click=async(text:string)=>{await act(async()=>Array.from(host.querySelectorAll('button')).find(button=>button.textContent===text)!.click());};
const card=()=> <VehicleWorkCard vehicleId={vehicle} vehicleTitle="Synthetic vehicle" signedIn={!!fixture.user}/>;
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);fixture.user={id:'viewer-a'};fixture.loading=false;fixture.rpc.mockReset().mockImplementation((name:string)=>Promise.resolve(name==='vehicle_work_orders_read'?orders():name==='listing_work_plan_read'?plan():publication));host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});

it('opens the existing route with canonical readers and preserves vehicle and mailbox links',async()=>{
 await render(<Routes><Route path="/vehicle/:vehicleId/work" element={<VehicleJobs/>}/></Routes>);
 expect(host.querySelector(`a[href="/vehicle/${vehicle}"]`)).not.toBeNull();expect(host.querySelector(`a[href="/vehicle/${vehicle}/mailbox"]`)).not.toBeNull();
 expect(host.querySelector(`a[href="/jobs/${first}"]`)).not.toBeNull();
 expect(fixture.rpc.mock.calls.map(([name])=>name).sort()).toEqual(['vehicle_work_orders_read','vehicle_work_publication_read']);
 expect(host.textContent).not.toContain('Create Draft Work Items');
});

it('shows pending and failed reads, then recovers without treating failure as zero jobs',async()=>{
 let finish!:(value:unknown)=>void;fixture.rpc.mockImplementation((name:string)=>name==='vehicle_work_orders_read'?new Promise(resolve=>{finish=resolve;}):Promise.resolve(publication));
 await render(card());expect(host.textContent).toContain('Reading the work orders');
 await act(async()=>finish({data:null,error:{message:'Work order read unavailable'}}));expect(host.textContent).toContain('Work order read unavailable');expect(host.textContent).not.toContain('No work orders');
 fixture.rpc.mockResolvedValue(orders());await click('Retry work orders');expect(host.textContent).toContain('Example job');
});

it('handles a thrown request and gives publication failure its own retry path',async()=>{
 fixture.rpc.mockImplementation((name:string)=>name==='vehicle_work_orders_read'?Promise.resolve(orders()):Promise.reject(new Error('offline')));
 await render(card());expect(host.textContent).toContain('Example job');expect(host.textContent).toContain('Publication status could not be loaded');
 fixture.rpc.mockResolvedValue(publication);await click('Retry publication status');expect(host.textContent).not.toContain('Publication status could not be loaded');
});

it('distinguishes an empty successful list and only offers posting with the reader action',async()=>{
 fixture.rpc.mockImplementation((name:string)=>Promise.resolve(name==='vehicle_work_orders_read'?{data:{...orders().data,rows:[],coverage:{returned:0,total_for_vehicle:0}},error:null}:publication));
 await render(card());expect(host.textContent).toContain('No work orders were returned');expect(host.textContent).not.toContain('Post a job');
});

it('loads one bounded cursor page, suppresses duplicates, and retains rows when that page fails',async()=>{
 let finish!:(value:unknown)=>void;
 fixture.rpc.mockImplementation((name:string)=>Promise.resolve(name==='vehicle_work_orders_read'?orders('First job',second):publication));
 await render(card());fixture.rpc.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));await click('More jobs');await click('More jobs');
 expect(fixture.rpc.mock.calls.filter(([name,args])=>name==='vehicle_work_orders_read'&&args.p_after===second)).toHaveLength(1);
 await act(async()=>finish({data:null,error:{message:'Next page unavailable'}}));expect(host.textContent).toContain('First job');expect(host.textContent).toContain('Next page unavailable');
 fixture.rpc.mockResolvedValue(orders('Second job',null,second));await click('Retry work orders');
 expect(host.textContent).toContain('First job');expect(host.textContent).toContain('Second job');expect(host.textContent).not.toContain('More jobs');
 expect(fixture.rpc).toHaveBeenLastCalledWith('vehicle_work_orders_read',{p_vehicle_id:vehicle,p_after:second,p_limit:25});
});

it('discards late former-viewer jobs and publication actions while same-viewer renders keep state',async()=>{
 let finish!:(value:unknown)=>void;fixture.rpc.mockImplementation((name:string)=>name==='vehicle_work_orders_read'?new Promise(resolve=>{finish=resolve;}):Promise.resolve(publication));
 await render(card());fixture.user={id:'viewer-b'};fixture.rpc.mockImplementation((name:string)=>Promise.resolve(name==='vehicle_work_orders_read'?orders('B job'):publication));await render(card());
 await act(async()=>finish(orders('PRIVATE A JOB')));expect(host.textContent).toContain('B job');expect(host.textContent).not.toContain('PRIVATE A JOB');
 const calls=fixture.rpc.mock.calls.length;fixture.user={id:'viewer-b'};await render(card());expect(fixture.rpc).toHaveBeenCalledTimes(calls);
 fixture.loading=true;await render(card());expect(host.textContent).not.toContain('B job');
});

it('closes a former-viewer posting draft and excludes a late publication response',async()=>{
 let finish!:(value:unknown)=>void;
 const owned={...orders('PRIVATE A JOB').data,viewer:{vehicle_access:{can_post_work_request:true},actions:[{action:'post_work_request',rpc:'post_work_request',args:{p_vehicle_id:vehicle,p_visibility:'open'}}]}};
 fixture.rpc.mockImplementation((name:string)=>name==='vehicle_work_publication_read'?new Promise(resolve=>{finish=resolve;}):Promise.resolve({data:owned,error:null}));
 await render(card());await click('Post a job');await act(async()=>{await vi.dynamicImportSettled();});expect(document.querySelector('[role="dialog"]')).not.toBeNull();
 fixture.user={id:'viewer-b'};fixture.rpc.mockImplementation((name:string)=>Promise.resolve(name==='vehicle_work_orders_read'?orders('B JOB'):publication));await render(card());
 await act(async()=>finish({data:{rows:[{work_order_id:first,visibility:'open',viewer:{actions:[{action:'unpublish_work_order',rpc:'unpublish_work_order',args:{p_work_order_id:first}}]}}]},error:null}));
 expect(document.querySelector('[role="dialog"]')).toBeNull();expect(host.textContent).not.toContain('PRIVATE A JOB');expect(host.textContent).not.toContain('Unpublish');expect(host.textContent).toContain('B JOB');
 expect(fixture.rpc.mock.calls.every(([name])=>['vehicle_work_orders_read','vehicle_work_publication_read'].includes(name))).toBe(true);
});

it('drops a late private work plan after a viewer change',async()=>{
 let finish!:(value:unknown)=>void;fixture.rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 await render(<WorkPlanPanel vehicleId={vehicle} signedIn/>);fixture.user={id:'viewer-b'};fixture.rpc.mockResolvedValue(plan('B CLAIM'));await render(<WorkPlanPanel vehicleId={vehicle} signedIn/>);
 await act(async()=>finish(plan('PRIVATE LATE A CLAIM')));expect(host.textContent).toContain('B CLAIM');expect(host.textContent).not.toContain('PRIVATE LATE A CLAIM');
});

it.each(['panel','callout'] as const)('keeps a loaded %s on ordinary renders and reads fresh after the viewer changes',async(kind)=>{
 const component=()=>kind==='panel'?<WorkPlanPanel vehicleId={vehicle} signedIn={!!fixture.user}/>:<InspectionCallout vehicleId={vehicle} signedIn={!!fixture.user}/>;
 fixture.rpc.mockResolvedValue(plan('PRIVATE A CLAIM'));await render(component());if(kind==='callout')await click('See what an inspection checks');expect(host.textContent).toContain('PRIVATE A CLAIM');
 const calls=fixture.rpc.mock.calls.length;fixture.user={id:'viewer-a'};await render(component());expect(fixture.rpc).toHaveBeenCalledTimes(calls);
 fixture.user={id:'viewer-b'};fixture.rpc.mockResolvedValue(plan('B CLAIM'));await render(component());if(kind==='callout')await click('See what an inspection checks');expect(host.textContent).toContain('B CLAIM');expect(host.textContent).not.toContain('PRIVATE A CLAIM');
 expect(fixture.rpc).toHaveBeenCalledTimes(calls+1);
});

it('offers a work-plan retry after a failed reader rather than a claim that no plan exists',async()=>{
 fixture.rpc.mockRejectedValue(new Error('offline'));await render(<WorkPlanPanel vehicleId={vehicle} signedIn/>);
 expect(host.textContent).toContain('Work plan unavailable');fixture.rpc.mockResolvedValue(plan());await click('Retry work plan');expect(host.textContent).toContain('Synthetic listing claim');
});
