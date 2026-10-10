// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { makeStudy, type BidLot, type StudyBid } from './bidMeasurements';
const state=vi.hoisted(()=>({dataset:null as any,read:null as any,facets:[] as any[],params:new URLSearchParams(),error:false,setParams:vi.fn()}));
vi.mock('react-router-dom',()=>({useSearchParams:()=>[state.params,state.setParams],useNavigate:()=>vi.fn()}));
vi.mock('./orderBookReader',()=>({useOrderBook:()=>({data:state.read,isError:false,refetch:vi.fn()})}));
vi.mock('./bidPopulationReader',async(importOriginal)=>({...await importOriginal<any>(),useBidStudy:()=>({data:state.dataset,isError:false,refetch:vi.fn()}),useStudyFacets:()=>({data:state.facets,isError:state.error,refetch:vi.fn()})}));
vi.mock('../../components/PrefetchLink',()=>({PrefetchLink:({to,children}:any)=><a href={to}>{children}</a>}));
import { VehiclePerformance } from './VehicleCohort';
let root:Root,host:HTMLDivElement;
beforeEach(()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true; state.params=new URLSearchParams();state.error=false;state.setParams.mockReset();
  const lots:BidLot[]=[],bids:StudyBid[]=[];
  for(let i=0;i<10;i++) {
    const vehicleId=i===9?'subject':i===0?'subject':`peer-${i}`;
    const lot:BidLot={id:`episode-${i}`,vehicle_id:vehicleId,source:'bat',source_url:`https://bringatrailer.com/listing/synthetic-${i}/`,auction_end_date:i===9?'2018-09-01T20:00:00Z':'2026-09-01T20:00:00Z',total_bids:3,winning_bid:i===9?100:300+i*100,winning_bidder_external_identity_id:'c',vehicles:{id:vehicleId,year:i===8?2001:2000,make:'Synthetic',model:'Source label',normalized_model:'Coupe'}};
    lots.push(lot);
    [50,75,Number(lot.winning_bid)].forEach((amount,j)=>bids.push({id:`bid-${i}-${j}`,auction_event_id:lot.id,vehicle_id:vehicleId,source_url:lot.source_url,posted_at:lot.auction_end_date!.replace('20:00:00',`19:${j}0:00`),created_at:'2026-10-08T00:00:00Z',bid_amount:amount,external_identity_id:['a','b','c'][j],author_username:'fixture',bat_comment_id:j+1}));
  }
  state.dataset=makeStudy(lots,bids,'2026-10-08T05:29:00Z','Synthetic selected BaT sample',false);
  const row=(l:BidLot)=>({...l,outcome:'sold',lot_number:l.id,updated_at:'2026-10-09T00:00:00Z',seller_name:null,high_bid:null,winning_bidder:null,seller_external_identity_id:null});
  state.read={vehicle:{...lots[0].vehicles,listing_url:lots[0].source_url,sale_status:'sold'},lot:row(lots[0]),lots:[row(lots[0]),row(lots[9])],comments:[],unkeyedOnUrl:0,frames:[],identities:{},readAt:'2026-10-10T00:00:00Z'};
  state.facets=lots.map(l=>({id:l.vehicle_id,canonical_body_style:'COUPE',body_style:null,engine_size:l.id==='episode-1'?'Exact Engine':null,transmission:null,drivetrain:null,city:null,state:null,location:null}));
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
async function mount(facet?:any){await act(async()=>root.render(<VehiclePerformance vehicleId="subject" facet={facet}/>));}
it('shows concise rank rows, explicitly names the population, and keeps counts/methods under disclosure',async()=>{
  await mount();
  expect(host.querySelectorAll('.vp-performance__table tbody tr')).toHaveLength(3);
  expect(host.querySelector('.vp-performance__scope')!.textContent).toContain('BaT sample · 2016–2026 auctions');
  expect(host.querySelectorAll('.vp-performance__table td:last-child strong')[2].textContent).toBe('P50');
  const evidence=host.querySelector<HTMLDetailsElement>('details')!;
  expect(evidence.open).toBe(false);
  expect(evidence.textContent).toContain('not an overall vehicle grade');
  expect(host.querySelector('.vp-performance__change')!.textContent).toContain('+200.0%');
});
it('defaults a configuration door to the same model year and keeps label incidence out of the headline',async()=>{
  await mount({dimension:'body_style',value:'COUPE',label:'Coupe'});
  expect(host.querySelector<HTMLSelectElement>('select')!.value).toBe('vehicleYear');
  expect(host.querySelector('.vp-performance__scope')!.textContent).toContain('Current-label match · BaT');
  expect(host.querySelectorAll('.vp-performance__table tbody tr')).toHaveLength(3);
  const evidence=host.querySelector('details')!;
  expect(evidence.textContent).toContain('100.0% (7/7)');
  expect(evidence.textContent).toContain('2000 Coupe');
  expect(host.querySelector('.vp-performance__incidence')).toBeNull();
  const deeper = new URL(host.querySelector<HTMLAnchorElement>('details a')!.href);
  const back = new URLSearchParams(deeper.searchParams.get('back')!);
  expect(deeper.searchParams.get('lot')).toBe('episode-0');
  expect(back.get('vehicleYear')).toBe('2000');
  expect(back.get('model')).toBe('Coupe');
  expect(back.get('excludeVehicle')).toBe('subject');
  expect(evidence.textContent).toContain('without the attribute filter');
});
it('withholds a sparse exact-label rank rather than borrowing the wider model percentile',async()=>{
  await mount({dimension:'engine',value:'Exact Engine',label:'Exact Engine'});
  expect(host.querySelector('.vp-performance__table')).toBeNull();
  expect(host.querySelector('.vp-performance__unranked')!.textContent).toContain('1 auction');
  expect(host.querySelector('details')!.textContent).toContain('100.0% (1/1)');
});
it('a scope control changes the denominator and identifies all model years explicitly',async()=>{
  await mount({dimension:'body_style',value:'COUPE',label:'Coupe'});
  const select=host.querySelector<HTMLSelectElement>('select')!;
  await act(async()=>{select.value='model';select.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(select.selectedOptions[0].textContent).toContain('all model years');
  expect(host.querySelector('details')!.textContent).toContain('100.0% (8/8)');
});
it('does not replace a failed facet read with zero share or a broad model rank',async()=>{
  state.error=true;
  await mount({dimension:'engine',value:'Exact Engine',label:'Exact Engine'});
  expect(host.querySelector('[role="status"]')!.textContent).toContain('could not be read');
  expect(host.querySelector('.vp-performance__table')).toBeNull();
});

it('does not leave a settled denied or absent vehicle in an endless loading shell',async()=>{
  state.read=null;
  await mount();
  expect(host.textContent).toBe('');
});
