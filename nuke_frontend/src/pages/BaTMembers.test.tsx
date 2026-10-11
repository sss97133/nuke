// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({identities:[] as any[],profiles:[] as any[],parentError:false,profileError:false,parentWait:null as Promise<any>|null,calls:[] as any[]}));
vi.mock('../lib/supabase',()=>({supabase:{from:(table:string)=>{
  const call={table,filters:[] as any[],range:[] as number[],limit:0};state.calls.push(call);
  return {select(){return this;},in(key:string,value:any){call.filters.push([key,value]);return this;},
    ilike(key:string,value:string){call.filters.push([key,value]);return this;},order(){return this;},
    range(start:number,end:number){call.range=[start,end];return state.parentWait??Promise.resolve({data:state.identities.slice(start,end+1),error:state.parentError?{message:'unavailable'}:null});},
    limit(n:number){call.limit=n;return Promise.resolve({data:state.profiles,error:state.profileError?{message:'unavailable'}:null});}};
}}}));
vi.mock('../components/PrefetchLink',()=>({PrefetchLink:({to,children,...props}:any)=><a href={to} {...props}>{children}</a>}));
import BaTMembers from './BaTMembers';
let root:Root,host:HTMLDivElement;
const identity=(id='member-a',handle='seller')=>({id,handle,display_name:null,profile_url:null,claimed_by_user_id:null,first_seen_at:'2026-01-01T00:00:00Z',last_seen_at:'2026-10-01T00:00:00Z',created_at:'2026-01-01T00:00:00Z'});
beforeEach(()=>{vi.useFakeTimers();(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;state.identities=[identity()];state.profiles=[{external_identity_id:'member-a',username:'seller',total_comments:0,total_bids:0,total_wins:0,record_method:null,eligible_closed:null}];state.calls=[];state.parentError=false;state.profileError=false;state.parentWait=null;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();});
async function tick(){await act(async()=>{await vi.advanceTimersByTimeAsync(250);});}
async function mount(){await act(async()=>root.render(<BaTMembers/>));await tick();}
async function change(select:string,value:string){await act(async()=>{const el=host.querySelector<HTMLSelectElement>(select)!;el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));});}

it('uses one bounded parent and one keyed fold read, preserving zero activity and withholding legacy awards',async()=>{
  await mount();expect(state.calls.map(c=>c.table)).toEqual(['external_identities','bat_user_profiles']);
  expect(state.calls[0].range).toEqual([0,50]);expect(state.calls[1].limit).toBe(51);
  expect(state.calls[1].filters).toContainEqual(['external_identity_id',['member-a']]);
  const link=host.querySelector('a')!;expect(link.textContent).toContain('0 posts');expect(link.textContent).toContain('0 bids');
  expect(link.textContent).not.toContain('awards');expect(link.textContent).toContain('Legacy · activity clock unknown');
  expect(link.getAttribute('href')).toBe('/profile/external/member-a');
});
it('admits published buyer awards only with a replayed eligible denominator',async()=>{
  state.profiles[0].record_method='published_buyer_v1';state.profiles[0].eligible_closed='4';state.profiles[0].total_wins=2;
  await mount();expect(host.querySelector('a')!.textContent).toContain('2 awards');
});
it('does not borrow a handle-mismatched or ambiguous keyed profile',async()=>{
  state.profiles[0].username='another';await mount();expect(host.querySelector('a')!.textContent).toContain('Activity unmeasured');
});
it('withholds activity when more than one profile claims the same identity',async()=>{
  state.profiles.push({...state.profiles[0],total_comments:100});await mount();
  expect(host.querySelector('a')!.textContent).toContain('Activity unmeasured');
});
it('preserves usable identities when the activity reader fails',async()=>{
  state.profileError=true;await mount();expect(host.textContent).toContain('Activity could not be read');
  expect(host.querySelector('a')!.textContent).toContain('Activity unmeasured');expect(host.querySelector('a')!.textContent).not.toContain('0 posts');
});
it('reads both Cars & Bids spellings without borrowing BaT activity',async()=>{
  await mount();await change('[aria-label="Member platform"]','cars_and_bids');await tick();
  expect(state.calls.map(c=>c.table)).toEqual(['external_identities','bat_user_profiles','external_identities']);
  expect(state.calls[2].filters).toContainEqual(['platform',['cars_and_bids','carsandbids']]);
  expect(host.querySelector('a')!.textContent).toContain('Activity unmeasured');
});
it('sorts only this page without additional reads and pages through a sentinel',async()=>{
  state.identities=Array.from({length:60},(_,i)=>identity(`member-${i}`,`handle-${i}`));state.profiles=[];
  await mount();expect(host.querySelectorAll('a')).toHaveLength(50);
  await change('[aria-label="Sort this directory page"]','recent');expect(state.calls).toHaveLength(2);
  await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Next')!.click());await tick();
  expect(state.calls[2].range).toEqual([50,100]);expect(host.querySelectorAll('a')).toHaveLength(10);
});
it('shows a parent failure instead of a false empty directory and retries explicitly',async()=>{
  state.parentError=true;await mount();expect(host.querySelector('[role="alert"]')!.textContent).toContain('Directory unavailable');
  expect(host.textContent).not.toContain('No captured identities');state.parentError=false;
  await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Retry')!.click());await tick();
  expect(host.querySelector('a')).not.toBeNull();
});
it('ignores an older platform response after a newer read has settled',async()=>{
  let resolveOld!:(value:any)=>void;state.parentWait=new Promise(resolve=>{resolveOld=resolve;});
  await act(async()=>root.render(<BaTMembers/>));await tick();state.parentWait=null;state.identities=[identity('new','new-handle')];
  await change('[aria-label="Member platform"]','cars_and_bids');await tick();
  await act(async()=>resolveOld({data:[identity('old','old-handle')],error:null}));
  expect(host.querySelector('a')!.textContent).toContain('new-handle');expect(host.textContent).not.toContain('old-handle');
});
