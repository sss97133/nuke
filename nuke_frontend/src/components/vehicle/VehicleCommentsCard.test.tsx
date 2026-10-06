// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ query: {} as any, lookups: new Map<string, Promise<any>>(), calls: [] as any[], refetch: vi.fn(), navigate: vi.fn() }));
vi.mock('react-router-dom',()=>({ useNavigate:()=>fixture.navigate }));
vi.mock('../../hooks/useVehicleCommentsUnified',()=>({useVehicleCommentsUnified:()=>({...fixture.query,refetch:fixture.refetch})}));
vi.mock('./VehicleMemePanel',()=>({default:()=>null}));
vi.mock('../common/AsciiAvatar',()=>({FallbackAvatar:()=>null}));
vi.mock('../../lib/supabase',()=>({supabase:{
 from:(table:string)=>{let key='',fallback='';const request:any={table,filters:{}};fixture.calls.push(request);const q:any={select:()=>q,eq:(field:string,value:string)=>{request.filters[field]=value;return q;},in:(field:string,values:string[])=>{request.field=field;request.values=values;fallback=values[0];key=field==='id'?`${table}:id:${values[0]}`:`${request.filters.platform}:${values[0]}`;return q;},then:(fn:any,reject:any)=>(fixture.lookups.get(key)??fixture.lookups.get(fallback)??Promise.resolve({data:[],error:null})).then(fn,reject)};return q;},
 channel:()=>{const q:any={on:()=>q,subscribe:()=>q};return q;},removeChannel:vi.fn(),
}}));
import { VehicleCommentsCard } from './VehicleCommentsCard';
let root:Root, node:HTMLDivElement;
const row=(vehicle:string,text:string,handle?:string)=>({comment_id:`${vehicle}-comment`,vehicle_id:vehicle,source_category:'auction',platform:'bat',author_username:handle,comment_text:text,observed_at:'2026-10-05T12:00:00Z'});
const deferred=()=>{let resolve!:(v:any)=>void,reject!:(e:any)=>void;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function render(vehicle='A',props:Partial<React.ComponentProps<typeof VehicleCommentsCard>>={}){await act(async()=>{root.render(<VehicleCommentsCard vehicleId={vehicle} session={null} collapsed={false} {...props}/>);});}
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;fixture.query={};fixture.lookups.clear();fixture.calls.length=0;fixture.refetch.mockClear();fixture.navigate.mockClear();node=document.createElement('div');document.body.append(node);root=createRoot(node);});
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

it('hides only a successfully read empty public section when requested',async()=>{
 fixture.query={data:[]};await render('A',{hideWhenEmpty:true});expect(node.textContent).toBe('');
 fixture.query={data:[row('A','readable testimony')]};await render('A',{hideWhenEmpty:true});expect(node.textContent).toContain('readable testimony');
 fixture.query={data:[],isError:true};await render('A',{hideWhenEmpty:true});expect(node.textContent).toContain('absence has not been established');expect(node.querySelector('button')?.textContent).toBe('Retry comments');
});
it('shows the next subject loading state after an empty public section',async()=>{
 fixture.query={data:[]};await render('A',{hideWhenEmpty:true});expect(node.textContent).toBe('');
 fixture.query={isLoading:true};await render('B',{hideWhenEmpty:true});expect(node.textContent).toContain('Loading comments');expect(node.textContent).toContain('(—)');
});
it('keeps the signed-in composer available on an empty section',async()=>{
 fixture.query={data:[]};await render('A',{hideWhenEmpty:true,session:{user:{id:'offline-user'}}});expect(node.querySelector('textarea')).not.toBeNull();expect(node.textContent).toContain('(0)');
});

const native='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const identity=(id:string,platform='bat',claimed_by_user_id:string|null=null)=>({id,platform,handle:'shared-handle',claimed_by_user_id});
const author=()=>[...node.querySelectorAll('button')].find(b=>b.textContent==='shared-handle')!;
it('keeps the native author key when its handle changed and another account uses the recorded handle',async()=>{
 fixture.lookups.set(`external_identities:id:${native}`,Promise.resolve({data:[{...identity(native),handle:'renamed-handle'}]}));
 fixture.lookups.set('bat:shared-handle',Promise.resolve({data:[identity(other,'bat','another-person')]}));
 fixture.query={data:[{...row('A','native testimony','shared-handle'),external_identity_id:native}]};await render();
 expect(fixture.calls.filter(c=>c.table==='external_identities').map(c=>c.field)).toEqual(['id']);
 await act(async()=>author().click());expect(fixture.navigate).toHaveBeenCalledWith(`/profile/external/${native}`);
 expect(node.querySelector('[data-author-attribution]')).toBeNull();
});
it.each(['absent','wrong-platform'])('does not replace an %s native identity with a handle match',async state=>{
 fixture.lookups.set(`external_identities:id:${native}`,Promise.resolve({data:state==='absent'?[]:[identity(native,'facebook')]}));
 fixture.lookups.set('bat:shared-handle',Promise.resolve({data:[identity(other,'bat','another-person')]}));
 fixture.query={data:[{...row('A','retained testimony','shared-handle'),external_identity_id:native}]};await render();
 expect(node.textContent).toContain('retained testimony');expect(author().disabled).toBe(true);
 expect(node.querySelector('summary')?.textContent).toBe(state==='absent'?'Author profile unavailable':'Author attribution conflict');
 expect(author().getAttribute('aria-describedby')).toBe(node.querySelector('summary')?.id);
 await act(async()=>author().click());expect(fixture.navigate).not.toHaveBeenCalled();
 expect(fixture.calls.filter(c=>c.table==='external_identities').every(c=>c.field==='id')).toBe(true);
});
it('resolves a claimed profile only through its qualified native author',async()=>{
 fixture.lookups.set(`external_identities:id:${native}`,Promise.resolve({data:[identity(native,'bat','native-claim')]}));
 fixture.query={data:[{...row('A','native testimony','shared-handle'),external_identity_id:native}]};await render();
 await act(async()=>author().click());expect(fixture.navigate).toHaveBeenCalledWith('/profile/native-claim');
});
it('keeps equal NULL-key handles on different known platforms separate',async()=>{
 fixture.lookups.set('bat:shared-handle',Promise.resolve({data:[identity(native)]}));
 fixture.lookups.set('cars_and_bids:shared-handle',Promise.resolve({data:[identity(other,'cars_and_bids')]}));
 fixture.query={data:[row('A','BaT testimony','shared-handle'),{...row('A','C&B testimony','shared-handle'),comment_id:'B-comment',platform:'carsandbids'}]};await render();
 const authors=[...node.querySelectorAll('button')].filter(b=>b.textContent==='shared-handle');
 await act(async()=>{authors[0].click();authors[1].click();});
 expect(fixture.navigate.mock.calls.map(c=>c[0])).toEqual([`/profile/external/${native}`,`/profile/external/${other}`]);
});
it('does not borrow a BaT identity or badge from a view fallback on an unknown platform',async()=>{
 fixture.lookups.set('bat:shared-handle',Promise.resolve({data:[identity(native)]}));
 fixture.query={data:[{...row('A','unqualified testimony','shared-handle'),platform:null,source_slug:'bat'}]};await render();
 expect(author().disabled).toBe(true);expect(node.textContent).not.toContain('BaT');expect(fixture.calls.some(c=>c.table==='external_identities')).toBe(false);
 expect(node.querySelector('summary')?.textContent).toBe('Author source unconfirmed');
 expect(node.textContent).toContain('A matching username alone does not identify the author');
});
it('leaves ambiguous legacy handles unlinked and retains the original source',async()=>{
 fixture.lookups.set('bat:shared-handle',Promise.resolve({data:[identity(native),identity(other)]}));
 fixture.query={data:[{...row('A','legacy testimony','shared-handle'),comment_url:'https://example.com/source-comment'}]};await render();
 expect(author().disabled).toBe(true);expect(node.querySelector('a')?.href).toBe('https://example.com/source-comment');
 expect(node.querySelector('summary')?.textContent).toBe('Author profile ambiguous');
});
it('withholds attribution when comment and native event platforms disagree',async()=>{
 fixture.lookups.set('auction_events:id:event',Promise.resolve({data:[{id:'event',source:'cars_and_bids'}]}));
 fixture.lookups.set(`external_identities:id:${native}`,Promise.resolve({data:[identity(native)]}));
 fixture.query={data:[{...row('A','conflicting testimony','shared-handle'),external_identity_id:native,auction_event_id:'event'}]};await render();
 expect(author().disabled).toBe(true);expect(node.textContent).toContain('conflicting testimony');
 expect(node.querySelector('[data-author-attribution="source_conflict"]')).not.toBeNull();
 expect(node.textContent).toContain('comment and its auction disagree');
});
it.each([null,undefined])('does not treat missing identity platform metadata as a demonstrated conflict (%s)',async platform=>{
 fixture.lookups.set(`external_identities:id:${native}`,Promise.resolve({data:[{...identity(native),platform}]}));
 fixture.query={data:[{...row('A','retained source testimony','shared-handle'),external_identity_id:native}]};await render();
 expect(author().disabled).toBe(true);expect(node.querySelector('summary')?.textContent).toBe('Author profile unavailable');
 expect(node.textContent).not.toContain('attribution conflict');
});
it('distinguishes an unavailable identity read from an attribution conflict and retains the original comment',async()=>{
 fixture.lookups.set(`external_identities:id:${native}`,Promise.resolve({data:null,error:{message:'PRIVATE DETAIL'}}));
 fixture.query={data:[{...row('A','retained source testimony','shared-handle'),external_identity_id:native,comment_url:'https://example.com/source-comment'}]};await render();
 expect(author().disabled).toBe(true);expect(node.querySelector('summary')?.textContent).toBe('Author profile unavailable');
 expect(node.textContent).toContain('This does not establish that the author has no profile');
 expect(node.textContent).not.toContain('PRIVATE DETAIL');expect(node.querySelector('a')?.href).toBe('https://example.com/source-comment');
});
it('does not call an absent username an ambiguous profile match',async()=>{
 fixture.query={data:[row('A','retained anonymous source testimony')]};await render();
 expect(node.querySelector('summary')?.textContent).toBe('Author profile unavailable');
});
it('adds no external attribution state to a first-party comment',async()=>{
 fixture.query={data:[{...row('A','first-party testimony'),source_category:'user'}]};await render();
 expect(node.textContent).toContain('first-party testimony');expect(node.querySelector('[data-author-attribution]')).toBeNull();
});
it('keeps rows with the same UUID from distinct source collections',async()=>{
 const warn=vi.spyOn(console,'error').mockImplementation(()=>{});
 fixture.query={data:[row('A','auction testimony'),{...row('A','user testimony'),source_category:'user'}]};await render();
 expect(node.textContent).toContain('auction testimony');expect(node.textContent).toContain('user testimony');
 expect(warn.mock.calls.some(c=>String(c[0]).includes('same key'))).toBe(false);warn.mockRestore();
});
it('bounds native metadata requests without converting remaining keys into handle lookups',async()=>{
 const ids=Array.from({length:101},(_,i)=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`);
 const data=ids.map(id=>identity(id));
 fixture.lookups.set(`external_identities:id:${ids[0]}`,Promise.resolve({data}));
 fixture.lookups.set(`external_identities:id:${ids[100]}`,Promise.resolve({data}));
 fixture.query={data:ids.map((id,i)=>({...row('A','native testimony','shared-handle'),comment_id:`native-${i}`,external_identity_id:id}))};await render();
 const calls=fixture.calls.filter(c=>c.table==='external_identities');expect(calls.map(c=>c.values.length)).toEqual([100,1]);
 expect(calls.every(c=>c.field==='id')).toBe(true);expect(calls.flatMap(c=>c.values)).toEqual(ids);
 expect([...node.querySelectorAll('button')].filter(b=>b.textContent==='shared-handle').every(b=>!b.disabled)).toBe(true);
});
