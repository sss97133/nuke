// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import GarageTab from './GarageTab';
import type { VehiclesDashboardState, GarageVehicle } from '../../hooks/useVehiclesDashboard';
vi.mock('../PrefetchLink', () => ({ default: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a> }));
vi.mock('../vehicles/GarageVehicleCard', () => ({ garageAxis: () => undefined, GarageVehicleCard: ({vehicle}: any) => <a href={`/vehicle/${vehicle.id}`}>{vehicle.id}</a> }));
const vehicle = {id:'synthetic-car',relationship_type:'OWNER'} as GarageVehicle;
let root: Root, host: HTMLDivElement, state: VehiclesDashboardState;
beforeEach(() => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  state = {viewerId:'viewer-a', signedIn:true, sections:[{relationship_type:'OWNER',vehicles:[vehicle]}],vehicles:[vehicle],totalEstimatedValue:0,isLoading:false,error:null,viewMode:'GRID',sortMode:'RECENT',filterMode:'ALL',setViewMode:vi.fn(),setSortMode:vi.fn(),setFilterMode:vi.fn(),refresh:vi.fn(),data:null,loading:false};
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
const mount=async()=>act(async()=>root.render(<GarageTab dashboard={state}/>));
const button=(text:string)=>[...host.querySelectorAll('button')].find(el=>el.textContent===text)!;
const search=async(text:string)=>act(async()=>{
  const input=host.querySelector('input[type="search"]')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,text);
  input.dispatchEvent(new Event('input',{bubbles:true}));
});
it('exposes existing add, view, sort and relationship controls for a populated garage', async()=>{
  await mount(); expect(host.querySelector('a[href="/vehicle/add"]')?.textContent).toBe('Add vehicle');
  expect(button('Grid').getAttribute('aria-pressed')).toBe('true');
  await act(async()=>button('List').click()); expect(state.setViewMode).toHaveBeenCalledWith('LIST');
  const selects=host.querySelectorAll('select');
  await act(async()=>{selects[0].value='NAME';selects[0].dispatchEvent(new Event('change',{bubbles:true}));}); expect(state.setSortMode).toHaveBeenCalledWith('NAME');
  await act(async()=>{selects[1].value='OWNED';selects[1].dispatchEvent(new Event('change',{bubbles:true}));}); expect(state.setFilterMode).toHaveBeenCalledWith('OWNED');
  expect(host.querySelector('option[value="HEALTH"]')).toBeNull();
  expect(host.textContent).not.toContain('EST. VALUE');
});
it('keeps primary read failure distinct from an empty garage and exposes retry',async()=>{
  state={...state,error:'Garage relationships unavailable.',vehicles:[],sections:[]};await mount();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Garage unavailable');
  expect(host.textContent).not.toContain('No vehicles yet');
  await act(async()=>button('Retry garage').click());expect(state.refresh).toHaveBeenCalledOnce();
});
it('retains records beside an optional-detail failure and retries the existing reader',async()=>{
  state={...state,warnings:['Recorded estimates are unavailable.']};await mount();
  expect(host.textContent).toContain('synthetic-car');expect(host.textContent).toContain('Recorded estimates are unavailable.');
  await act(async()=>button('Retry details').click());expect(state.refresh).toHaveBeenCalledOnce();
});
it('explains the relationship editing boundary beside recorded vehicle links',async()=>{
  await mount();
  expect(host.textContent).toContain('Relationship changes are not available from this page.');
  expect(host.querySelector('a[href="/vehicle/synthetic-car"]')).not.toBeNull();
  expect(host.querySelector('[draggable="true"]')).toBeNull();
});
it('offers sign-in without garage actions for a visitor',async()=>{
  state={...state,viewerId:null,signedIn:false,vehicles:[],sections:[]};await mount();
  expect(host.querySelector('a[href="/login"]')?.textContent).toBe('Sign in');expect(host.querySelector('a[href="/vehicle/add"]')).toBeNull();
});
it('groups current inventory together independently of title and retains past business roles',async()=>{
  const rows = [
    {id:'titled',relationship_type:'VERIFIED OWNER'},
    {id:'owner',relationship_type:'OWNER'},
    {id:'disputed',relationship_type:'CLAIMED INTEREST',inventory_status:'current'},
    {id:'pending',relationship_type:'TRANSFER PENDING',inventory_status:'current'},
    {id:'sold',relationship_type:'PREVIOUSLY OWNED'},
    {id:'business',relationship_type:'BUSINESS HANDLING',inventory_status:'previous'},
    {id:'represented',relationship_type:'SALES REPRESENTATIVE',inventory_status:'previous'},
    {id:'unresolved-role',relationship_type:'CONSIGNED'},
  ] as GarageVehicle[];
  state={...state,vehicles:rows};await mount();
  // One list in the reader's order: relationship is a card label, never a section.
  expect([...host.querySelectorAll('.garage-sections section')].map(el=>el.getAttribute('aria-label'))).toEqual(['No dated activity']);
  expect([...host.querySelectorAll('.garage-sections a')].map(a=>a.textContent)).toEqual(rows.map(row=>row.id));
  expect(rows[2].relationship_type).toBe('CLAIMED INTEREST');
  expect(rows[5].relationship_type).toBe('BUSINESS HANDLING');
});
it('lists cars under the year of their newest dated activity, undated cars last',async()=>{
  const timeline=(first_day:string,last_day:string)=>({first_day,last_day,active_days:1,photos:1,work_days:0,events:0,documents:0,weeks:[[last_day,1,0,0,0]]});
  state={...state,vehicles:[
    {...vehicle,id:'this-year',timeline:timeline('2021-03-04','2026-11-02')},
    {...vehicle,id:'also-this-year',timeline:timeline('2026-01-01','2026-02-01'),inventory_status:'previous'},
    {...vehicle,id:'older',timeline:timeline('2019-05-01','2024-06-01')},
    {...vehicle,id:'undated'},
  ] as GarageVehicle[]};
  await mount();
  expect([...host.querySelectorAll('.garage-section-heading')].map(h=>h.textContent)).toEqual(['2026 2','2024 1','No dated activity 1']);
  expect([...host.querySelectorAll('.garage-sections a')].map(a=>a.textContent)).toEqual(['this-year','also-this-year','older','undated']);
  state={...state,sortMode:'FIRST'};await mount();
  expect([...host.querySelectorAll('.garage-section-heading')].map(h=>h.textContent)[0]).toBe('2021 1');
  state={...state,sortMode:'NAME'};await mount();
  expect(host.querySelectorAll('.garage-section-heading')).toHaveLength(0);
  expect(host.querySelectorAll('.garage-sections a')).toHaveLength(4);
});
it('finds a zero-photo profile by vehicle and VIN while retaining the loaded-record denominator',async()=>{
  state={...state,loadedVehicleCount:2,vehicles:[
    {...vehicle,id:'created-coupe',year:1973,make:'Fixture',model:'Coupe',vin:'TEST1234567',image_count:0,relationship_type:'PROFILE RECORD'},
    {...vehicle,id:'other-truck',year:1978,make:'Fixture',model:'Truck',vin:'TEST7654321'},
  ]};
  await mount(); await search('1973 coupe');
  expect(host.querySelector('a[href="/vehicle/created-coupe"]')).not.toBeNull();
  expect(host.querySelector('a[href="/vehicle/other-truck"]')).toBeNull();
  expect(host.querySelector('.garage-toolbar-heading')?.textContent).toContain('1 of 2 loaded vehicle records shown');
  await search('1234567');
  expect(host.querySelector('a[href="/vehicle/created-coupe"]')).not.toBeNull();
  await search('missing'); expect(host.textContent).toContain('No matching vehicle records');
  await act(async()=>button('Clear search').click());
  expect(host.querySelector('a[href="/vehicle/other-truck"]')).not.toBeNull();
});
it('preserves search within a viewer and resets it when the account changes',async()=>{
  state={...state,vehicles:[{...vehicle,model:'Coupe'}]};
  await mount(); await search('coupe');
  state={...state,viewMode:'LIST'};await mount();
  expect((host.querySelector('input[type="search"]') as HTMLInputElement).value).toBe('coupe');
  state={...state,viewerId:'viewer-b',vehicles:[]};await mount();
  expect((host.querySelector('input[type="search"]') as HTMLInputElement).value).toBe('');
  expect(host.querySelector('a[href="/vehicle/synthetic-car"]')).toBeNull();
});

it('keeps org-held and recently worked cars in the one list instead of pulling them into groups', async()=>{
  const ernie={id:'ernie',name:"Ernie's Upholstery",relationship_type:'work_location'};
  const recent=new Date(Date.now()-24*60*60*1000).toISOString();
  const rows=[
    {id:'own',relationship_type:'OWNER'},
    {id:'blue',relationship_type:'CONTRIBUTOR',custody_org:ernie},
    {id:'ghia',relationship_type:'CONTRIBUTOR',custody_org:ernie,recent_work_at:recent},
  ] as GarageVehicle[];
  state={...state,vehicles:rows};await mount();
  expect(host.querySelectorAll('.garage-sections section')).toHaveLength(1);
  expect([...host.querySelectorAll('.garage-sections a')].map(a=>a.textContent)).toEqual(['own','blue','ghia']);
});
