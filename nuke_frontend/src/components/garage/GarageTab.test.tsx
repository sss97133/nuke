// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import GarageTab from './GarageTab';
import type { VehiclesDashboardState, GarageVehicle } from '../../hooks/useVehiclesDashboard';
vi.mock('../PrefetchLink', () => ({ default: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a> }));
vi.mock('../vehicles/GarageVehicleCard', () => ({ GarageVehicleCard: ({vehicle}: any) => <a href={`/vehicle/${vehicle.id}`}>{vehicle.id}</a> }));
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
