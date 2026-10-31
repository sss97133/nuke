// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ user: { id: 'fixture-user' } as { id: string } | null, invoke: vi.fn() }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: fixture.user, loading: false }) }));
vi.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke: fixture.invoke } } }));
import VehicleSourceProfile from './VehicleSourceProfile';
const url='https://exclusivecarregistry.com/details/pagani/zonda/123';
const address=(source=url)=>'/vehicle/source?source_url='+encodeURIComponent(source);
const profile={ kind:'source_vehicle', source_url:url,label:'Pagani Zonda F',image_url:'https://exclusivecarregistry.com/images/cars/123.jpg',image_observation_id:'fixture-observation',image_relationship:'source_current',history:{complete:true},claims:[{
  observation_id:'fixture-observation',source_url:'https://exclusivecarregistry.com/collection/fixture',captured_at:'2026-02-16T03:00:00Z',
  label:'Pagani Zonda F',relationship:'source_current',collection_label:'Fixture collection',collection_profile_path:address('https://exclusivecarregistry.com/collection/fixture'),
}]};
let root:Root,host:HTMLDivElement,navigate:ReturnType<typeof useNavigate>;
function Page(){navigate=useNavigate();return <VehicleSourceProfile/>;}
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;fixture.user={id:'fixture-user'};fixture.invoke.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
async function mount(){await act(async()=>{root.render(<MemoryRouter initialEntries={[address()]}><Page/></MemoryRouter>);});}
it('opens an attributed source profile and a collection drill without implying ownership or manufacturing identity',async()=>{
  fixture.invoke.mockResolvedValue({data:{data:profile},error:null});await mount();
  expect(host.querySelector('h1')?.textContent).toBe('Pagani Zonda F');
  expect(host.textContent).toContain('Physical vehicle identity and ownership are unverified by this source.');
  expect(host.textContent).toContain('Listed under Current');
  expect(host.querySelector('time')?.dateTime).toBe('2026-02-16T03:00:00Z');
  expect([...host.querySelectorAll('a')].find(a=>a.textContent==='Fixture collection')?.getAttribute('href')).toBe(profile.claims[0].collection_profile_path);
  expect(fixture.invoke.mock.calls[0][0]).toBe('api-v1-vehicles?source_url='+encodeURIComponent(url));
  expect(fixture.invoke.mock.calls[0][1].method).toBe('GET');
  const capture=[...host.querySelectorAll('a')].find(a=>a.textContent==='Capture evidence');
  expect(host.querySelector(capture!.getAttribute('href')!)).not.toBeNull();
});
it('preserves the selected URL through sign-in and makes no unauthenticated source read',async()=>{
  fixture.user=null;await mount();expect(fixture.invoke).not.toHaveBeenCalled();
  const link=[...host.querySelectorAll('a')].find(a=>a.textContent==='Sign in');
  expect(link?.getAttribute('href')).toBe('/login?returnUrl='+encodeURIComponent(address()));
});
it('never displays another source response or a late prior subject, and retains a retry for failed reads',async()=>{
  let late:(value:unknown)=>void=()=>{};
  fixture.invoke.mockImplementationOnce(()=>new Promise(resolve=>{late=resolve;}));await mount();
  const other=url.replace('/123','/456');fixture.invoke.mockResolvedValue({data:{data:profile},error:null});
  await act(async()=>navigate(address(other)));
  await act(async()=>late({data:{data:profile},error:null}));
  expect(host.querySelector('h1')).toBeNull();expect(host.textContent).toContain('response could not be verified');
  expect(host.querySelector('button')?.textContent).toBe('Retry');
});
