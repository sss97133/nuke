// @vitest-environment jsdom
import { act } from 'react';
import { createRoot,type Root } from 'react-dom/client';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
vi.mock('../../components/PrefetchLink',()=>({PrefetchLink:({to,...props}:{to:string})=><a href={to} {...props}/> }));
import { BidPathFold } from './BidPathView';
import { bidFixture,bidId } from './__fixtures__/bidPath';
import type { BidPathReceipt } from './bidPathReader';
let root:Root,container:HTMLDivElement;
beforeEach(()=>{(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
async function render(receipt:BidPathReceipt,selectedId:string|null=receipt.selected_bid_comment_id){await act(async()=>root.render(<BidPathFold receipt={receipt} identities={{}} selectedId={selectedId} bookReady onSelect={()=>{}}/>));}
it('uses exact decimal labels and accommodates long values without nonfinite chart coordinates',async()=>{
  const d=bidFixture({selected_bid_comment_id:bidId(0)}),amount='9007199254740993.123456';
  d.states=[{...d.states[0],amount,price:amount}];d.book[0].maximum_revealed_bid=amount;d.summary.bid_count=1;d.summary.running_high_bid=amount;d.summary.latest_bid=amount;
  await render(d);expect(container.textContent).toContain('9,007,199,254,740,993.123456');
  expect(container.innerHTML).not.toMatch(/NaN|Infinity/);expect(Number(container.querySelector('svg line')!.getAttribute('x1'))).toBeGreaterThan(200);
  expect(container.textContent).toContain('First eligible bid; no prior high');expect(container.textContent).toContain('Not defined with fewer than two entries');
});
it('does not silently replace an absent selected source bid with the latest point',async()=>{
  await render(bidFixture(),'00000000-0000-4000-8000-000000000099');expect(container.querySelector('svg')).toBeNull();expect(container.textContent).toContain('No other bid is selected');
});
it('keeps known zero eligible inputs distinct from zero platform activity',async()=>{
  const d=bidFixture();d.states=[];d.book=[];d.selected_bid_comment_id=null;d.selected_seq=null;
  await render(d);expect(container.querySelector('svg')).toBeNull();expect(container.textContent).toContain('does not establish zero auction activity');
});
