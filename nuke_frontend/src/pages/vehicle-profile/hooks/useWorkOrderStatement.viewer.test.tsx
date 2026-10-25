// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
const fixture = vi.hoisted(() => ({rpc:vi.fn(), user:null as {id:string}|null, loading:false}));
vi.mock('../../../lib/supabase', () => ({supabase:{rpc:fixture.rpc}}));
vi.mock('../../../hooks/useAuth', () => ({useAuth:()=>({user:fixture.user,loading:fixture.loading})}));
import {useWorkOrderStatement} from './useWorkOrderStatement';
const query = 'wo:00000000-0000-4000-a000-000000000001';
const statement = (note:string, payment:number) => ({data:{vehicle:{id:'v',text:'Synthetic vehicle'},work_orders:[{id:'wo',display_title:'Synthetic job',notes:note,money_visible:true,parts:[],labor:[],payments:[{id:'pm',amount:payment,status:'completed'}]}]},error:null});
function Harness(){const {data,loading}=useWorkOrderStatement(query);return <output>{loading?'Loading':JSON.stringify(data)}</output>;}
let host:HTMLDivElement, root:Root, client:QueryClient;
const render = async()=>{await act(async()=>root.render(<QueryClientProvider client={client}><Harness/></QueryClientProvider>));await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});};
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);fixture.rpc.mockReset();fixture.user={id:'viewer-a'};fixture.loading=false;client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());client.clear();host.remove();vi.unstubAllGlobals();});
it('separates cached statements by viewer and withholds cached data while auth resolves',async()=>{
 fixture.rpc.mockResolvedValue(statement('PRIVATE A',812.34));await render();expect(host.textContent).toContain('PRIVATE A');
 const calls=fixture.rpc.mock.calls.length;fixture.user={id:'viewer-a'};await render();expect(fixture.rpc).toHaveBeenCalledTimes(calls);
 fixture.loading=true;await render();expect(host.textContent).toBe('Loading');expect(fixture.rpc).toHaveBeenCalledTimes(calls);
 fixture.loading=false;fixture.user=null;fixture.rpc.mockImplementation(()=>new Promise(()=>{}));await render();expect(host.textContent).not.toContain('PRIVATE A');expect(host.textContent).not.toContain('812.34');
 fixture.user={id:'viewer-b'};fixture.rpc.mockResolvedValue(statement('B record',0));await render();expect(host.textContent).toContain('B record');expect(host.textContent).not.toContain('PRIVATE A');
});
it('does not render a late former-viewer response in the new viewer scope',async()=>{
 let finish!:(value:unknown)=>void;fixture.rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await render();
 fixture.user={id:'viewer-b'};fixture.rpc.mockResolvedValue(statement('B record',0));await render();
 await act(async()=>finish(statement('PRIVATE LATE A',934.56)));await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});
 expect(host.textContent).toContain('B record');expect(host.textContent).not.toContain('PRIVATE LATE A');expect(host.textContent).not.toContain('934.56');
});
