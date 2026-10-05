// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ query: {} as any, lookups: new Map<string, Promise<any>>(), refetch: vi.fn() }));
vi.mock('react-router-dom',()=>({ useNavigate:()=>vi.fn() }));
vi.mock('../../hooks/useVehicleCommentsUnified',()=>({useVehicleCommentsUnified:()=>({...fixture.query,refetch:fixture.refetch})}));
vi.mock('./VehicleMemePanel',()=>({default:()=>null}));
vi.mock('../common/AsciiAvatar',()=>({FallbackAvatar:()=>null}));
vi.mock('../../lib/supabase',()=>({supabase:{
 from:()=>{let handle='';const q:any={select:()=>q,eq:()=>q,in:(_:string,values:string[])=>{handle=values[0];return q;},then:(fn:any,reject:any)=>(fixture.lookups.get(handle)??Promise.resolve({data:[],error:null})).then(fn,reject)};return q;},
 channel:()=>{const q:any={on:()=>q,subscribe:()=>q};return q;},removeChannel:vi.fn(),
}}));
import { VehicleCommentsCard } from './VehicleCommentsCard';
let root:Root, node:HTMLDivElement;
const row=(vehicle:string,text:string,handle?:string)=>({comment_id:`${vehicle}-comment`,vehicle_id:vehicle,source_category:'auction',platform:'bat',author_username:handle,comment_text:text,observed_at:'2026-10-05T12:00:00Z'});
const deferred=()=>{let resolve!:(v:any)=>void,reject!:(e:any)=>void;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function render(vehicle='A'){await act(async()=>{root.render(<VehicleCommentsCard vehicleId={vehicle} session={null} collapsed={false}/>);});}
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;fixture.query={};fixture.lookups.clear();fixture.refetch.mockClear();node=document.createElement('div');document.body.append(node);root=createRoot(node);});
afterEach(async()=>{await act(async()=>root.unmount());node.remove();});

it('distinguishes unavailable from an empty collection and exposes keyboard retry',async()=>{
 fixture.query={isError:true};await render();expect(node.textContent).toContain('absence has not been established');expect(node.textContent).not.toContain('Be the first');expect(node.textContent).toContain('(—)');
 const retry=node.querySelector('button')!;expect(retry.textContent).toBe('Retry comments');await act(async()=>retry.click());expect(fixture.refetch).toHaveBeenCalledOnce();
 fixture.query={data:[],isLoading:false};await render();expect(node.textContent).toContain('No comments yet');expect(node.textContent).toContain('(0)');
});
it('hides a previous vehicle immediately while the next vehicle loads',async()=>{
 fixture.query={data:[row('A','A testimony')]};await render();expect(node.textContent).toContain('A testimony');
 fixture.query={isLoading:true};await render('B');expect(node.textContent).not.toContain('A testimony');expect(node.textContent).toContain('Loading comments');expect(node.textContent).toContain('(—)');
});
it('ignores late enrichment from a previous vehicle after the new comments resolve',async()=>{
 const old=deferred();fixture.lookups.set('old-author',old.promise);fixture.query={data:[row('A','A late testimony','old-author')]};await render();
 fixture.query={data:[row('B','B testimony')]};await render('B');expect(node.textContent).toContain('B testimony');
 await act(async()=>old.resolve({data:[],error:null}));expect(node.textContent).toContain('B testimony');expect(node.textContent).not.toContain('A late testimony');
});
it('ignores late enrichment errors and binds current processing failure to its vehicle',async()=>{
 const old=deferred();fixture.lookups.set('old-author',old.promise);fixture.query={data:[row('A','A late testimony','old-author')]};await render();
 fixture.query={data:[row('B','B testimony')]};await render('B');await act(async()=>old.reject(new Error('PRIVATE FAILURE')));expect(node.textContent).toContain('B testimony');expect(node.textContent).not.toContain('could not be loaded');
 const current=deferred();fixture.lookups.set('current-author',current.promise);fixture.query={data:[row('B','B failed testimony','current-author')]};await render('B');
 await act(async()=>current.reject(new Error('PRIVATE FAILURE')));expect(node.textContent).toContain('could not be loaded');expect(node.textContent).not.toContain('PRIVATE FAILURE');
 fixture.query={isLoading:true};await render('C');expect(node.textContent).toContain('Loading comments');expect(node.textContent).not.toContain('could not be loaded');
});
it('withholds cached testimony after a failed refresh',async()=>{
 const rows=[row('A','cached testimony')];fixture.query={data:rows};await render();expect(node.textContent).toContain('cached testimony');
 fixture.query={data:rows,isError:true};await render();expect(node.textContent).not.toContain('cached testimony');expect(node.textContent).toContain('absence has not been established');
});
