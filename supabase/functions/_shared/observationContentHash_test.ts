import { observationContentForHash, observationContentHash } from './observationContentHash.ts';
function assert(value: unknown): asserts value { if (!value) throw new Error('assertion failed'); }
Deno.test('legacy omitted undefined fields preserve frozen JSON bytes and digest', async () => {
  assert(observationContentForHash({}) === '{"vehicle_id":"","source_url":"","source_identifier":"","text":"","data":{},"observer":{}}');
  assert(await observationContentHash({}) === ['678e8ad3766a59f4', 'e62996430d365d6c', '2c256db771289ecd', '19028424e1717a16'].join(''));
});
const input = { source_slug:'bat',kind:'comment',vehicle_id:'vehicle',source_url:'https://example.invalid/comment',source_identifier:'comment:1',
  observed_at:'2026-10-03T02:00:00.000001Z',content_text:'Tire “2004” 🛞\nunknown',structured_data:{z:null,a:'café'},observer_raw:{author:'public'},
  descriptor_key:null,property_key:'tire_date',source_comment_id:'comment-id' };
Deno.test('legacy Unicode, nested key order, microseconds and explicit null retain frozen digest', async () => {
  assert(await observationContentHash(input) === ['3621e2d5cf17b958', 'e5dec1b2cd4b550e', '942ebc3fdc8a80c8', '3d8e365141540cbf'].join(''));
  assert(observationContentForHash(input).includes('"descriptor":null'));
  assert(!observationContentForHash({...input,descriptor_key:undefined}).includes('"descriptor":'));
});
Deno.test('vehicle, source identity, property and source comment remain part of replay identity', async () => {
  const original=await observationContentHash(input);
  for(const key of ['vehicle_id','source_identifier','property_key','source_comment_id','observed_at'] as const)
    assert(await observationContentHash({...input,[key]:'changed'})!==original);
});
Deno.test('new helper does not sort historical nested object bytes or add model metadata', async () => {
  assert(await observationContentHash({...input,structured_data:{a:'café',z:null}})!==await observationContentHash(input));
  assert(await observationContentHash(Object.assign({},input,{agent_model:'unhashed-model'}))===await observationContentHash(input));
});

Deno.test('transport-only source_result_json cannot change historical canonical identity',async()=>{
 assert(await observationContentHash(Object.assign({},input,{source_result_json:'proof bytes'}))===await observationContentHash(input));
});
