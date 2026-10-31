import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const filename=new URL('./build-canonical-models.ts',import.meta.url);
const source=ts.transpileModule(readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
for(const cap of [1000,200])test(`actual ECR builder dry-run reaches the catalogue tail with a ${cap}-row API cap`,async()=>{
  const rows=Array.from({length:1101},(_,i)=>({ecr_make_slug:i===1100?'pagani':'example',model_name:i===1100?'Tail model':`Model ${i}`}));
  const requests=[],logs=[];
  const context=vm.createContext({URL,Map,Set,console:{log:(...args)=>logs.push(args.join(' ')),error:(...args)=>{throw Error(args.join(' '));}},
    process:{env:{SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture'},argv:['node','builder','--source','ecr','--dry-run'],exit:code=>{throw Error(`Unexpected exit ${code}`);}},
    fetch:async(input,options)=>{
      const url=new URL(input);assert.equal(options.method,undefined,'dry-run must never mutate the database');
      const table=url.pathname.split('/').at(-1);
      if(table==='canonical_models')return {ok:true,json:async()=>[]};
      assert.equal(table,'ecr_models');
      const offset=Number(url.searchParams.get('offset')),limit=Number(url.searchParams.get('limit'));
      requests.push({offset,order:url.searchParams.get('order')});
      return {ok:true,json:async()=>rows.slice(offset,offset+Math.min(cap,limit))};
    }});
  // Await the real CLI's existing invocation, preserving its catch/error behavior.
  vm.runInContext(source.replace(/main\(\)\.catch\(/,'globalThis.completion=main().catch('),context);
  await context.completion;
  assert.ok(logs.includes('  ECR makes: 2, models: 1101'),logs.join('\n'));
  assert.ok(logs.includes('New models to insert: 1101'));
  assert.equal(requests.at(-1).offset,1101,'must confirm an empty page after the tail');
  assert.ok(requests.every(r=>r.order==='ecr_make_slug,ecr_model_slug'),'pagination must use stable unique source order');
});
