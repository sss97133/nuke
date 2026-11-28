// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({rpc:vi.fn(),revision:0,refuse:false,defer:null as null|(()=>void)}));
vi.mock('../../lib/supabase',()=>({supabase:{rpc:fixture.rpc}}));
vi.mock('../../components/PrefetchLink',()=>({PrefetchLink:({to,...props}:{to:string})=><a href={to} {...props}/> }));
import EpisodeInputControls,{resetEpisodeInputs} from './EpisodeInputControls';
import CommentMeasurements from './CommentMeasurements';
import { BidKnowledge, BidPathFold } from './BidPathView';
import { bidRequestFromParams, selectBidParams, useBidPath, type BidPathRequest } from './bidPathReader';
import { bidFixture,bidId,BID_CLOSE,BID_LOT,BID_VEHICLE } from './__fixtures__/bidPath';
import { commentFixture } from './__fixtures__/commentSurface';
import type { CommentSurfaceRequest } from './commentSurfaceReader';
let root:Root,container:HTMLDivElement,client:QueryClient;
const cutoff='2026-11-25T20:52:00Z';
function Harness(){
  const [params,setParams]=useSearchParams(),go=useNavigate(),location=useLocation();
  const lot=params.get('lot')??BID_LOT,request=bidRequestFromParams(params),query=useBidPath(BID_VEHICLE,lot,request);
  const data=!query.isError&&query.data?.state==='partial'?query.data:null;
  return <>
    <EpisodeInputControls vehicleId={BID_VEHICLE} lotId={lot} closeAt={BID_CLOSE}/>
    {data?<><BidKnowledge receipt={data}/><BidPathFold receipt={data} identities={{}} selectedId={request?.selected_bid_comment_id??data.states.at(-1)?.bid_comment_id??null}
      bookReady={!query.isPlaceholderData} onSelect={id=>setParams(selectBidParams(params,data,id))}/></>:<p data-bid-unavailable>Bid measurement unavailable</p>}
    <CommentMeasurements embedded vehicleId={BID_VEHICLE} lotId={lot} closeAt={BID_CLOSE}/>
    <output data-address>{location.search}</output>
    <button onClick={()=>go(-1)}>Back input controls</button><button onClick={()=>setParams({lot:'00000000-0000-4000-8000-000000000099'})}>Other auction</button>
  </>;
}
async function settle(){await act(async()=>{await new Promise(resolve=>setTimeout(resolve,15));});}
async function render(search=''){
  await act(async()=>root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[search||'/']}><Harness/></MemoryRouter></QueryClientProvider>));await settle();
}
const button=(text:string)=>[...container.querySelectorAll('button')].find(b=>b.textContent===text)!;
async function click(text:string){await act(async()=>button(text).click());await settle();}
const bidCalls=()=>fixture.rpc.mock.calls.filter(c=>c[0]==='lot_order_book_read');
const commentCalls=()=>fixture.rpc.mock.calls.filter(c=>c[0]==='popup_vehicle_intel');
const search=()=>new URLSearchParams(container.querySelector('[data-address]')!.textContent!);

it('changes the discussion hour without rereading bids, then resets the hour when the shared cutoff changes',async()=>{
  await render();const bidsBefore=bidCalls().length,commentsBefore=commentCalls().length;
  const select=container.querySelector('select')!;
  await act(async()=>{select.value='2026-11-25T19:00:00.000Z';select.dispatchEvent(new Event('change',{bubbles:true}));});await settle();
  expect(commentCalls().length).toBe(commentsBefore+1);expect(bidCalls().length).toBe(bidsBefore);
  expect(search().get('csHour')).toBe('2026-11-25T19:00:00.000Z');
  await click('Reconstruct 1 hour before recorded close');
  expect(search().has('csHour')).toBe(false);expect(commentCalls().at(-1)![1].p_request.evidence_bucket).toBeUndefined();
  expect(commentCalls().at(-1)![1].p_request.cutoff).toBe(bidCalls().at(-1)![1].p_request.cutoff);
});
beforeEach(()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  fixture.revision=0;fixture.refuse=false;fixture.defer=null;
  fixture.rpc.mockReset().mockImplementation((name:string,args:{p_request:BidPathRequest&CommentSurfaceRequest})=>{
    const request=args.p_request;
    let resolve!:()=>void;
    const promise=new Promise<unknown>(done=>{resolve=()=>done({data:fixture.refuse&&request.snapshot_hash
      ?{state:'unavailable',reason:'evidence_snapshot_changed'}
      :name==='lot_order_book_read'?bidFixture(request,fixture.revision):commentFixture(request,fixture.revision),error:null});
      if(name==='lot_order_book_read'&&request.selected_bid_comment_id&&fixture.defer)fixture.defer=resolve;else resolve();
    });
    return Object.assign(promise,{abortSignal:()=>promise});
  });
  client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:60_000}}});
  container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());client.clear();container.remove();});
it('uses the exact SQL overload and source support, with one shared clock control',async()=>{
  await render();expect(bidCalls()).toHaveLength(1);expect(bidCalls()[0][1]).toEqual({p_auction_event_id:BID_LOT,p_request:{}});
  expect(commentCalls()).toHaveLength(1);expect(container.querySelectorAll('[data-entry-key]')).toHaveLength(3);
  expect([...container.querySelectorAll('button')].filter(b=>b.textContent==='Current recorded state')).toHaveLength(1);
});
it('withholds the previous selected book during a real delayed query while keeping path keyboard navigation',async()=>{
  await render();fixture.defer=()=>{};
  await act(async()=>container.querySelector<SVGGElement>('svg [role="button"]')!.dispatchEvent(new MouseEvent('click',{bubbles:true})));await settle();
  expect(search().get('at')).toBe(bidId(0));expect(container.querySelector('.stack-asof')?.textContent).toContain('1 of 5');
  expect(container.querySelector('[data-entry-key]')).toBeNull();expect(container.textContent).toContain('Reading this bid’s book');
  await act(async()=>fixture.defer!());await settle();expect(container.querySelectorAll('[data-entry-key]')).toHaveLength(1);
});
it('recomputes both models at the shared reconstruction cutoff, excluding a late recording',async()=>{
  await render('?csCutoff='+encodeURIComponent(cutoff));
  expect(bidCalls().at(-1)![1].p_request).toMatchObject({cutoff,knowledge_mode:'recorded_input_reconstruction'});
  expect(commentCalls().at(-1)![1].p_request).toMatchObject({cutoff,knowledge_mode:'recorded_input_reconstruction'});
  expect(container.querySelector('.stack-asof')?.textContent).toContain('2 of 2');expect(container.querySelectorAll('[data-entry-key]')).toHaveLength(1);
  expect(container.textContent).toContain('Later corrections and the currently recorded close remain hindsight');
});
it('refreshes both current models when no URL reset is needed',async()=>{
  await render();await click('Refresh auction measurements');expect(bidCalls()).toHaveLength(2);expect(commentCalls()).toHaveLength(2);
});
it('invalidates cached first pages before clearing refused pins on both models',async()=>{
  await render();await act(async()=>container.querySelector<SVGGElement>('svg [role="button"]')!.dispatchEvent(new MouseEvent('click',{bubbles:true})));await settle();
  await click('Next comment entries');fixture.refuse=true;fixture.revision=1;
  await act(async()=>client.invalidateQueries({predicate:q=>['auction-bid-path','auction-comment-surface'].includes(String(q.queryKey[0]))}));await settle();
  expect(container.querySelector('[data-entry-key]')).toBeNull();expect(container.querySelector('[data-comment-id]')).toBeNull();
  const beforeBid=bidCalls().length,beforeComment=commentCalls().length;await click('Refresh auction measurements');
  expect(bidCalls().length).toBe(beforeBid+1);expect(commentCalls().length).toBe(beforeComment+1);
  expect(bidCalls().at(-1)![1].p_request).toEqual({});expect(commentCalls().at(-1)![1].p_request).toEqual({evidence_filter:'all_discussion',include_trajectory:true});
  expect(container.querySelector('.bid-path__knowledge')?.textContent).toContain('2'.repeat(32));
  expect([...search().keys()].filter(k=>k.startsWith('bp')||k.startsWith('cs'))).toEqual([]);
});
it('restores the shared reconstruction clock through browser history',async()=>{
  await render('?csCutoff='+encodeURIComponent(cutoff));await click('Current recorded state');expect(search().has('csCutoff')).toBe(false);
  await click('Back input controls');expect(search().get('csCutoff')).toBe(cutoff);
  expect(container.querySelector<HTMLInputElement>('.episode-input-controls input')!.value).toBe(cutoff);
  expect(container.querySelector('.stack-asof')?.textContent).toContain('2 of 2');
});
it('does not let a slow refresh restore the prior auction after navigation',async()=>{
  await render();let release!:()=>void;
  vi.spyOn(client,'invalidateQueries').mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve;}));
  await click('Refresh auction measurements');await click('Other auction');const other=search().get('lot');
  await act(async()=>release());await settle();expect(search().get('lot')).toBe(other);
});
it('makes neither measurement call for an invalid shared cutoff',async()=>{
  await render('?csCutoff=yesterday');expect(fixture.rpc).not.toHaveBeenCalled();expect(container.querySelector('[data-bid-unavailable]')).toBeTruthy();
});
it('drops all continuation keys while retaining a valid source filter and exploration context',()=>{
  const params=new URLSearchParams(`layer=dimension&back=make%3DBMW&csFilter=media_only&csOffset=20&csHash=${'1'.repeat(32)}&csEvent=${BID_CLOSE}&csRecorded=2026-11-28T06:00:00Z&at=${bidId(0)}&bpHash=${'1'.repeat(32)}&bpEvent=${BID_CLOSE}&bpRecorded=2026-11-28T06:00:00Z`);
  const next=resetEpisodeInputs(params,cutoff);expect(next.get('csCutoff')).toBe(cutoff);expect(next.get('csFilter')).toBe('media_only');
  expect(next.get('layer')).toBe('dimension');expect(next.get('back')).toBe('make=BMW');
  expect([...next.keys()].filter(k=>k.startsWith('bp')||k==='at'||k==='csHash'||k==='csOffset')).toEqual([]);
});
