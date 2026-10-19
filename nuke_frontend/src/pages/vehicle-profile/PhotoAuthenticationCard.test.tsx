// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture=vi.hoisted(()=>({images:[{id:'image-1',source:'retained_listing'},{id:'image-2',source:'retained_listing'}],labels:[] as any[],failed:false}));
vi.mock('../../lib/supabase',()=>({supabase:{from:(table:string)=>({
  select(){return this;},eq(){return this;},
  limit:async()=>({data:fixture.images,error:fixture.failed?{message:'reader unavailable'}:null}),
  in:async()=>({data:table==='device_attributions'?fixture.labels:[],error:null}),
})}}));
import PhotoAuthenticationCard from './PhotoAuthenticationCard';
let root:Root,host:HTMLDivElement;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;fixture.labels=[];fixture.failed=false;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
async function mount(id='vehicle-a'){await act(async()=>root.render(<PhotoAuthenticationCard vehicleId={id}/>));}

it('does not grade imported images with absent camera labels as zero authentication',async()=>{
  await mount();expect(host.textContent).toBe('');
});
it('does not surface whitespace camera labels',async()=>{
  fixture.labels=[{image_id:'image-1',camera_make:' ',camera_model:'\t'}];
  await mount();expect(host.textContent).toBe('');
});
it('keeps actual camera metadata closed and separates labels from authenticity',async()=>{
  fixture.labels=[{image_id:'image-1',camera_make:'Canon',camera_model:'EOS'}];
  await mount();expect(host.textContent).toBe('Camera metadata');
  await act(async()=>host.querySelector<HTMLElement>('[role="button"]')!.click());
  expect(host.textContent).toContain('image authenticity is unverified');
  expect(host.textContent).toContain('Canon EOS');expect(host.textContent).toContain('1/2');
  expect(host.textContent).not.toMatch(/authenticated|authentication|%/i);
});
it('clears another vehicle’s labels on a failed read and recovers on the next vehicle',async()=>{
  fixture.labels=[{image_id:'image-1',camera_make:'Canon',camera_model:'EOS'}];
  await mount();expect(host.textContent).toBe('Camera metadata');
  fixture.failed=true;await mount('vehicle-b');expect(host.textContent).toBe('');
  fixture.failed=false;await mount('vehicle-c');expect(host.textContent).toBe('Camera metadata');
});
