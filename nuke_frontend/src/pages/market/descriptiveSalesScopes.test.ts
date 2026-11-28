import { beforeEach,expect,it,vi } from 'vitest';
const mock=vi.hoisted(()=>({from:vi.fn(),rpc:vi.fn()}));
vi.mock('../../lib/supabase',()=>({supabase:mock}));
import { fetchDescriptiveSalesScopes,type DescriptiveScopeRule } from './useRecordedSales';
const id=(n:number)=>`70000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const model='20000000-0000-4000-8000-000000000001';
const purpose='captured_sell_through_descriptive',method='unique_exact_registered_model_alias_with_declared_year_scope_v1';
let source:{data:{subject_id:string}[]|null;count:number|null;error:unknown},rows:DescriptiveScopeRule[],chain:Record<string,ReturnType<typeof vi.fn>>;
function row(n:number):DescriptiveScopeRule{return {subject_id:id(n),canonical_make:'SYNTHETIC',canonical_model:'MODEL',grain:'year',year:1977,
  year_start:null,year_end:null,canonical_model_id:model,comparison_scope_status:'context_only',admission_purpose:purpose,
  membership_method:method,state:'admitted',reason:'canonical_registry_scope_shape_supported_for_descriptive_outcomes',registered_model_label:n===2?'model alias':'MODEL',
  catalog_subject_id:id(1),equivalent_catalog_subjects:2};}
beforeEach(()=>{
  mock.from.mockReset();mock.rpc.mockReset();source={data:[1,2,3,4].map(n=>({subject_id:id(n)})),count:4,error:null};
  rows=[row(1),row(2),{...row(3),grain:'model',year:null,year_start:1970,catalog_subject_id:id(3),equivalent_catalog_subjects:1},
    {...row(4),grain:'generation',state:'unavailable',reason:'scope_grain_not_descriptive',membership_method:null,catalog_subject_id:null,equivalent_catalog_subjects:0}];
  chain=Object.fromEntries(['select','ilike','in','order','limit','abortSignal'].map(key=>[key,vi.fn(()=>chain)]));
  Object.assign(chain,{then:(resolve:(v:typeof source)=>unknown)=>Promise.resolve(source).then(resolve)});mock.from.mockReturnValue(chain);
  mock.rpc.mockImplementation(()=>{const p=Promise.resolve({data:rows,error:null});return Object.assign(p,{abortSignal:()=>p});});
});
it('uses SQL admission and alias representatives instead of creating a second grouping policy',async()=>{
  const d=await fetchDescriptiveSalesScopes('Synthetic');
  expect(mock.from).toHaveBeenCalledExactlyOnceWith('make_model_profiles');expect(chain.ilike).toHaveBeenCalledWith('canonical_make','Synthetic');
  expect(chain.in).toHaveBeenCalledWith('grain',['year','model']);expect(chain.limit).toHaveBeenCalledWith(1001);
  expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('cohort_scope_rule',{p_subject_ids:[1,2,3,4].map(id),p_purpose:purpose});
  expect(d.candidateCount).toBe(4);expect(d.options).toHaveLength(2);expect(d.rules).toHaveLength(4);
  expect(d.options.every(o=>o.scope.kind==='descriptive_subject')).toBe(true);expect(d.options.some(o=>o.key===`descriptive:${id(2)}`)).toBe(false);
  expect(d.options.find(o=>o.key===`descriptive:${id(3)}`)?.descriptive?.yearEnd).toBeNull();
  expect(d.rules.find(r=>r.subject_id===id(4))?.reason).toBe('scope_grain_not_descriptive');
});
it('preserves a known empty registry catalog without calling it zero auction activity',async()=>{
  source={data:[],count:0,error:null};expect(await fetchDescriptiveSalesScopes('SYNTHETIC')).toEqual({candidateCount:0,options:[],rules:[]});expect(mock.rpc).not.toHaveBeenCalled();
});
it.each(['missing total','hidden sentinel','duplicate keys'])('refuses an incomplete candidate collection: %s',async kind=>{
  if(kind==='missing total')source.count=null;
  if(kind==='hidden sentinel')source.count=1001;
  if(kind==='duplicate keys')source.data![1].subject_id=id(1);
  await expect(fetchDescriptiveSalesScopes('SYNTHETIC')).rejects.toThrow('catalog');expect(mock.rpc).not.toHaveBeenCalled();
});
it('escapes literal make pattern characters before the bounded candidate query',async()=>{
  source={data:[],count:0,error:null};await fetchDescriptiveSalesScopes('SYN%_');expect(chain.ilike).toHaveBeenCalledWith('canonical_make','SYN\\%\\_');
});
it('does not fall back to raw labels if the SQL purpose rule is undeployed',async()=>{
  mock.rpc.mockResolvedValue({data:null,error:{code:'PGRST202'}});await expect(fetchDescriptiveSalesScopes('SYNTHETIC')).rejects.toMatchObject({code:'PGRST202'});expect(mock.rpc).toHaveBeenCalledTimes(1);
});
it.each(['missing row','wrong key','duplicate response','unknown method','wrong purpose','wrong make','missing representative','wrong representative shape','wrong alias count','fractional year','unknown state'])('withholds malformed SQL catalog: %s',async kind=>{
  if(kind==='missing row')rows.pop();
  if(kind==='wrong key')rows[0].subject_id=id(99);
  if(kind==='duplicate response')rows[1].subject_id=id(1);
  if(kind==='unknown method')rows[0].membership_method='other';
  if(kind==='wrong purpose')rows[0].admission_purpose='valuation' as typeof purpose;
  if(kind==='wrong make')rows[0].canonical_make='OTHER';
  if(kind==='missing representative')rows[0].catalog_subject_id=id(99);
  if(kind==='wrong representative shape')rows[1].year=1978;
  if(kind==='wrong alias count')rows[0].equivalent_catalog_subjects=3;
  if(kind==='fractional year')rows[0].year=1977.5;
  if(kind==='unknown state')rows[0].state='maybe' as 'admitted';
  await expect(fetchDescriptiveSalesScopes('SYNTHETIC')).rejects.toThrow('catalog');
});
it('keeps one unknown registry key as a rejected input with its database reason',async()=>{
  rows[3]={...rows[3],canonical_make:null,canonical_model:null,grain:null,year:null,canonical_model_id:null,comparison_scope_status:null,registered_model_label:null,reason:'unknown_subject'};
  expect((await fetchDescriptiveSalesScopes('SYNTHETIC')).rules[3].reason).toBe('unknown_subject');
});
it('passes the query cancellation signal to the candidate and SQL rule calls',async()=>{
  const signal=new AbortController().signal;await fetchDescriptiveSalesScopes('SYNTHETIC',signal);expect(chain.abortSignal).toHaveBeenCalledWith(signal);
});
