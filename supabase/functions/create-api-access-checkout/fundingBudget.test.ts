import {assertEquals} from 'jsr:@std/assert@1';
import {accountProviderUsage} from './fundingBudget.ts';
const usage={provider:'fixture',model:'fixture-model',account_reference:'fixture-account',usage_reference:'provider-request:1',input_tokens:1000,output_tokens:200,
  cached_input_tokens:0,pricing:{provider:'fixture',model:'fixture-model',currency:'USD',unit:'million_tokens',
    input_microusd:150000,output_microusd:600000,source_reference:'fixture-price-document'}};
Deno.test('actual units price separately from contribution and settlement',()=>{
  assertEquals(accountProviderUsage({...usage,contribution_cents:300}),{estimated_microusd:270,settled_microusd:null,variance_microusd:null});
  assertEquals(accountProviderUsage({...usage,settlement:{provider:'fixture',account_reference:'fixture-account',currency:'USD',usage_reference:usage.usage_reference,
    amount_microusd:280,source_reference:'provider-billing:1'}}),{estimated_microusd:270,settled_microusd:280,variance_microusd:10});
});
Deno.test('unknown units, unsupported caches and unmatched settlement are not zero cost',()=>{
  for(const patch of [{input_tokens:null},{output_tokens:undefined},{input_tokens:-1},{input_tokens:1.5},{cached_input_tokens:1},
    {pricing:null},{usage_reference:''},{pricing:{...usage.pricing,model:'other'}},
    {settlement:{provider:'other',currency:'USD',usage_reference:usage.usage_reference,amount_microusd:270,source_reference:'receipt'}}])
    assertEquals(accountProviderUsage({...usage,...patch}),null);
});
