// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const fixture=vi.hoisted(()=>({ rpc:vi.fn(),from:vi.fn(),invoke:vi.fn(),single:vi.fn(),update:vi.fn() }));
vi.mock('../../lib/supabase',()=>({supabase:{rpc:fixture.rpc,from:fixture.from,functions:{invoke:fixture.invoke}}}));
vi.mock('../ui/CollapsibleWidget',()=>({CollapsibleWidget:({children,title,action}:any)=><section><h2>{title}</h2>{action}{children}</section>}));
import VehicleDescriptionCard from './VehicleDescriptionCard';
import { listingDescriptionsFromSpecs } from './listingDescriptions';
const id='00000000-0000-4000-8000-000000000001';
const sourceId='00000000-0000-4000-8000-000000000002';
const text='Preserved full seller text. '.repeat(90)+'The trunk floor needs replacement. Literal <script>text</script>.';
const entry={source_observation_id:sourceId,source_url:'https://source.invalid/listing',text,status:'preserved',reader_truncated:false,
 source_completeness:'unknown',source_event_time_status:'unknown',recorded_observed_at:'2020-01-01T00:00:00Z',
 source_captured_at:null,ingested_at:'2022-01-01T00:00:00Z',extraction_method:'fixture_parser',confidence:.6};
function specs(e:any=entry){return[{field:'description',value:'Manual summary',source_descriptions:[e]}];}
let container:HTMLDivElement,root:Root;
beforeEach(()=>{
 fixture.rpc.mockReset().mockResolvedValue({data:specs(),error:null});fixture.invoke.mockReset();fixture.update.mockReset();
 fixture.single.mockReset().mockResolvedValue({data:{description:'Manual summary',description_source:'user_input'},error:null});
 const query:any={select:()=>query,eq:()=>query,single:fixture.single,update:(body:any)=>{fixture.update(body);return query;},then:(resolve:any)=>Promise.resolve({error:null}).then(resolve)};
 fixture.from.mockReset().mockImplementation((table:string)=>{expect(table).toBe('vehicles');return query;});
 container=document.createElement('div');document.body.append(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
async function render(editable=false){await act(async()=>root.render(<VehicleDescriptionCard vehicleId={id} isEditable={editable}/>));}
describe('existing public profile description card',()=>{
 it('renders full tail and separate summary with exact citation and clock unknowns',async()=>{
  await render();expect(container.textContent).toContain(text);expect(container.textContent).toContain('Manual summary');
  expect(container.querySelector('a[href="https://source.invalid/listing"]')).not.toBeNull();
  expect(container.querySelector(`a[href="/vehicle/${id}/observation/${sourceId}"]`)).not.toBeNull();
  expect(container.textContent).toContain('2020-01-01T00:00:00Z');expect(container.textContent).toContain('2022-01-01T00:00:00Z');
  expect(container.textContent).toContain('Captured: Date unknown');expect(container.textContent).toContain('Original listing event date unknown');
  expect(container.textContent).toContain('Original source completeness unknown');expect(container.textContent).toContain('Stored confidence: 0.6');
  expect(container.querySelector('script')).toBeNull();expect(fixture.invoke).not.toHaveBeenCalled();expect(fixture.update).not.toHaveBeenCalled();
  expect(fixture.rpc).toHaveBeenCalledWith('get_vehicle_specs',{p_vehicle_id:id});
 });
 it('shows existing listing prose even when the canonical description is empty',async()=>{
  fixture.single.mockResolvedValue({data:{description:null},error:null});await render();expect(container.textContent).toContain(text);
  expect(container.textContent).not.toContain('No description yet');
 });
 it('failed/denied optional reader hides source prose and preserves manual text',async()=>{
  fixture.rpc.mockResolvedValue({data:null,error:{message:'denied'}});await render();expect(container.textContent).toContain('Manual summary');
  expect(container.textContent).not.toContain(text);expect(container.querySelector('a')).toBeNull();
 });
 it('editing changes only the manual vehicle summary and preserves source testimony',async()=>{
  await render(true);const edit=Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='Edit')!;
  await act(async()=>edit.click());const textarea=container.querySelector('textarea')!;expect(textarea.value).toBe('Manual summary');
  const save=Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='Save')!;await act(async()=>save.click());
  expect(fixture.update).toHaveBeenCalledWith(expect.objectContaining({description:'Manual summary',description_source:'user_input'}));
  expect(container.textContent).toContain(text);expect(fixture.invoke).not.toHaveBeenCalled();
 });
 it('rejects unsafe links, unknown qualifications and oversized artifacts instead of implying full delivery',()=>{
  for(const changed of [{source_url:'javascript:alert(1)'},{text:'x'.repeat(32001)},{reader_truncated:true},
    {source_event_time_status:'known'},{source_completeness:'complete'},{status:'oversized'},{source_observation_id:'not-a-uuid'}])
   expect(listingDescriptionsFromSpecs(specs({...entry,...changed}))).toEqual([]);
  expect(listingDescriptionsFromSpecs(null)).toEqual([]);
 });
});
