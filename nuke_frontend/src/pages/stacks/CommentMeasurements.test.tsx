// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({rpc:vi.fn(),revision:0,refuse:false}));
vi.mock('../../lib/supabase',()=>({supabase:{rpc:fixture.rpc}}));
vi.mock('../../components/PrefetchLink',()=>({PrefetchLink:({to,...props}:{to:string})=><a href={to} {...props}/>}));
import CommentMeasurements from './CommentMeasurements';
import { commentFixture, CLOSE, LOT, SOURCE, VEHICLE } from './__fixtures__/commentSurface';
import { commentSurfaceKey, type CommentSurfaceRequest } from './commentSurfaceReader';

let root:Root,container:HTMLDivElement,client:QueryClient;
function Address(){const go=useNavigate();return <><output data-address>{useLocation().search}</output><button type="button" onClick={()=>go(-1)}>Back comment controls</button></>;}
async function settle(){await act(async()=>{await new Promise(resolve=>setTimeout(resolve,15));});}
async function render(search='?layer=dimension'){
  await act(async()=>root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[search]}>
    <CommentMeasurements vehicleId={VEHICLE} lotId={LOT} closeAt={CLOSE}/><Address/>
  </MemoryRouter></QueryClientProvider>));await settle();
}
const button=(name:string)=>[...container.querySelectorAll('button')].find(el=>el.textContent===name)!;
async function click(name:string){await act(async()=>{
  const target=button(name),details=target.closest('details');
  if(details&&!details.open)details.querySelector('summary')!.click();
  target.click();
});await settle();}
beforeEach(()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  fixture.revision=0;fixture.refuse=false;fixture.rpc.mockReset().mockImplementation(async(_name,args:{p_request:CommentSurfaceRequest})=>({
    data:fixture.refuse&&args.p_request.snapshot_hash?{state:'unavailable',reason:'evidence_snapshot_changed'}:commentFixture(args.p_request,fixture.revision),error:null,
  }));
  client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());client.clear();container.remove();});

it('draws SQL partitions and literal-pattern denominators with exact source entries',async()=>{
  await render();expect(container.querySelectorAll('.comment-measure__bar')).toHaveLength(6);
  expect(container.querySelector('[aria-label^="Media only: 1 of 24"]')).toBeTruthy();
  expect(container.querySelector('[aria-label^="Contains a ?: 6 of 22"]')).toBeTruthy();
  expect(container.querySelector('a[href="'+SOURCE+'#comment-1"]')).toBeTruthy();
  expect(container.textContent).toContain('1 distinct BaT identity keys');
  expect(container.textContent).toContain('These patterns do not measure expertise or literacy');
  expect(container.querySelectorAll('[data-comment-id]')).toHaveLength(20);
  expect(container.querySelector<HTMLDetailsElement>('.comment-measure__time-controls')?.open).toBe(false);
});
it('paginates through the real hook, pins both cutoffs and restores the same first page',async()=>{
  await render();await click('Next comment entries');
  const call=fixture.rpc.mock.calls.at(-1)![1].p_request;
  expect(call).toMatchObject({offset:20,snapshot_hash:'1'.repeat(32),event_cutoff:CLOSE,recorded_cutoff:'2026-11-28T06:00:00Z'});
  expect(container.querySelectorAll('[data-comment-id]')).toHaveLength(4);
  expect(container.textContent).toContain('Media-only source entry');
  await click('Previous comment entries');expect(container.querySelectorAll('[data-comment-id]')).toHaveLength(20);
});
it('removes old evidence on source change and makes a fresh first-page RPC despite its cached entry',async()=>{
  // Retain inactive pages, as in the application, to expose accidental cache reuse on reset.
  client.setDefaultOptions({queries:{retry:false,gcTime:60_000}});
  await render();await click('Next comment entries');
  fixture.refuse=true;fixture.revision=1;
  const calls=fixture.rpc.mock.calls;
  await act(async()=>client.invalidateQueries({queryKey:commentSurfaceKey(VEHICLE,LOT,calls.at(-1)![1].p_request),exact:true}));await settle();
  expect(container.textContent).toContain('Previous evidence is withheld');expect(container.querySelector('[data-comment-id]')).toBeNull();
  const before=fixture.rpc.mock.calls.length;
  await click('Refresh comment measurements');
  expect(fixture.rpc.mock.calls.length).toBe(before+1);
  expect(fixture.rpc.mock.calls.at(-1)![1].p_request).toEqual({evidence_filter:'all_discussion'});
  expect(container.querySelector('[data-comment-id]')?.getAttribute('data-comment-id')).toContain('000000001100');
  expect(container.querySelector('[data-address]')?.textContent).not.toContain('csHash');
});
it('filters media as recorded activity while preserving the whole discussion denominator',async()=>{
  await render();await click('Media only');
  expect(fixture.rpc.mock.calls.at(-1)![1].p_request).toEqual({evidence_filter:'media_only'});
  expect(container.querySelectorAll('[data-comment-id]')).toHaveLength(1);
  expect(container.textContent).toContain('Media-only source entry');
  expect(container.querySelector('[aria-label^="Media only: 1 of 24"]')).toBeTruthy();
  expect(button('Next comment entries').disabled).toBe(true);
});
it('uses the explicit cutoff for reconstruction and keeps its qualification visible',async()=>{
  await render();await click('Reconstruct 10 minutes before recorded close');
  expect(fixture.rpc.mock.calls.at(-1)![1].p_request).toMatchObject({knowledge_mode:'recorded_input_reconstruction',cutoff:'2026-11-25T20:50:00.000Z'});
  expect(container.textContent).toContain('It is not evidence that a forecast or feature was served at that time');
  await click('Next comment entries');
  expect(fixture.rpc.mock.calls.at(-1)![1].p_request.cutoff).toBe('2026-11-25T20:50:00.000Z');
  await click('Current recorded state');
  expect(container.querySelector('[data-address]')?.textContent).not.toContain('csCutoff');
});
it('does not read or reuse numbers for an incomplete shared evidence state',async()=>{
  await render('?layer=dimension&csOffset=20');expect(fixture.rpc).not.toHaveBeenCalled();
  expect(container.textContent).toContain('incomplete or invalid');expect(container.querySelector('.comment-measure__bar')).toBeNull();
  await click('Refresh comment measurements');expect(fixture.rpc).toHaveBeenCalledTimes(1);
});
it('restores the applied cutoff input with browser history',async()=>{
  await render('?layer=dimension&csCutoff=2026-11-25T20%3A50%3A00Z');
  expect(container.querySelector('input')?.value).toBe('2026-11-25T20:50:00Z');
  await click('Current recorded state');expect(container.querySelector('input')?.value).toBe('');
  await click('Back comment controls');expect(container.querySelector('input')?.value).toBe('2026-11-25T20:50:00Z');
  expect(container.textContent).toContain('Retrospective recorded-input reconstruction');
  expect(container.querySelector<HTMLDetailsElement>('.comment-measure__time-controls')?.open).toBe(true);
});
it('withholds every measurement after a response fails the contract',async()=>{
  fixture.rpc.mockResolvedValue({data:{...commentFixture(),auction_event_id:VEHICLE},error:null});
  await render();expect(container.textContent).toContain('could not be read completely');expect(container.querySelector('.comment-measure__bar')).toBeNull();
});
it('does not attach a shortened-text label to a long whitespace-only media entry',async()=>{
  fixture.rpc.mockImplementation(async(_name,args:{p_request:CommentSurfaceRequest})=>{
    const data=commentFixture(args.p_request);data.evidence.contributors[0].excerpt_truncated=true;
    return {data,error:null};
  });
  await render('?layer=dimension&csFilter=media_only');
  expect(container.textContent).toContain('Media-only source entry');
  expect(container.querySelector('[data-comment-id]')?.textContent).not.toContain('excerpt shortened');
});
