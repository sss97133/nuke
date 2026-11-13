import { beforeEach, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({from:vi.fn(),rows:[] as unknown[],error:null as null|{message:string;code:string},query: {} as Record<string,ReturnType<typeof vi.fn>>}));
vi.mock('../../lib/supabase',()=>({supabase:{from:fixture.from}}));
import { JobReaders } from './jobsReaders';
beforeEach(()=>{
  fixture.rows=[];fixture.error=null;fixture.from.mockReset();
  const query:Record<string,unknown>={then:(done:(value:unknown)=>unknown)=>Promise.resolve(done({data:fixture.rows,error:fixture.error}))};
  for(const method of ['select','eq','is','order','limit','gt'])query[method]=vi.fn(()=>query);
  fixture.query=query as typeof fixture.query;fixture.from.mockReturnValue(query);
});
it('reads current vehicle-filed lines through the parent, without importing receipt money or card details into the job view',async()=>{
  await JobReaders.vehicleReceiptLines('fixture-vehicle');
  expect(fixture.from).toHaveBeenCalledWith('receipt_items');
  expect(fixture.query.select.mock.calls[0][0]).toContain('receipt:receipts!inner');
  expect(fixture.query.select.mock.calls[0][0]).not.toMatch(/unit_price|total_price|card_last|raw_extraction/);
  expect(fixture.query.eq.mock.calls).toEqual(expect.arrayContaining([
    ['receipt.vehicle_id','fixture-vehicle'],['receipt.scope_type','vehicle'],['receipt.scope_id','fixture-vehicle'],
    ['receipt.is_active',true],['receipt.is_superseded',false],
  ]));
  expect(fixture.query.is).toHaveBeenCalledWith('receipt.duplicate_of',null);
});
it('keeps the extra row as a paging sentinel and resumes after the last delivered line',async()=>{
  fixture.rows=Array.from({length:101},(_,i)=>({id:`line-${String(i).padStart(3,'0')}`}));
  const first=await JobReaders.vehicleReceiptLines('fixture-vehicle');
  expect(first.refusal).toBeNull();expect(first.data?.rows).toHaveLength(100);expect(first.data?.next_after).toBe('line-099');
  fixture.rows=[{id:'line-100'}];const next=await JobReaders.vehicleReceiptLines('fixture-vehicle',first.data!.next_after);
  expect(fixture.query.gt).toHaveBeenCalledWith('id','line-099');expect(next.data?.rows).toEqual([{id:'line-100'}]);expect(next.data?.next_after).toBeNull();
});
it('does not present a read failure as an empty receipt population',async()=>{
  fixture.error={code:'42501',message:'Permission denied for relation receipt_items'};
  const read=await JobReaders.vehicleReceiptLines('fixture-vehicle');
  expect(read.data).toBeNull();expect(read.refusal?.code).toBe('42501');
});
