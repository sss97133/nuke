import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { expect, it } from 'vitest';

// Exercise the existing Deno handler offline, without importing its remote SDK
// or calling production. The query recorder preserves every AND/OR scope clause.
function handler(segment: any, failure?: string) {
  const reads: Array<{ table: string; clauses: any[] }> = [];
  let serve!: (request: Request) => Promise<Response>;
  const db = { from(table: string) {
    const read = { table, clauses: [] as any[] };
    const result = () => {
      reads.push(read);
      if (table === 'market_segments_index') return { data: segment, error: failure === 'definition' ? { message: 'unavailable' } : null };
      if (table.startsWith('vehicle_valuation_feed')) return { data: [], error: failure === 'timeout' ? { code: '57014', message: 'timeout' } : null };
      return { data: table === 'portfolio_stats_cache' ? null : [], count: 0, error: null };
    };
    const q: any = { then: (yes: any, no: any) => Promise.resolve(result()).then(yes, no) };
    for (const method of ['select','eq','in','gte','lte','gt','lt','not','or','order','limit','single','maybeSingle']) {
      q[method] = (...args: any[]) => { read.clauses.push([method,...args]); return q; };
    }
    return q;
  } };
  const source = readFileSync(resolve(process.cwd(), '../supabase/functions/feed-query/index.ts'), 'utf8').replace(/^import .*$/gm, '');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  runInNewContext(code, { Deno: { env: { get: () => '' }, serve: (fn: any) => { serve = fn; } },
    createClient: () => db, corsHeaders: {}, Request, Response, console: { warn() {}, error() {} } });
  const request = (body: any) => serve(new Request('https://fixture.test/feed-query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  return { request, reads };
}
const id = '00000000-0000-4000-8000-000000000001';
it('retains all eleven definition keywords alongside narrower user filters', async () => {
  const keywords = Array.from({length:11},(_,i) => `Model${i}`);
  const h = handler({ year_min:1973, year_max:1987, makes:['Chevrolet','GMC'], model_keywords:keywords });
  const response = await h.request({ segment_id:id, models:['Model10'], year_min:1980, include_dealers:true });
  expect(response.status).toBe(200);
  const clauses = h.reads.find(r => r.table === 'vehicle_valuation_feed')!.clauses;
  expect(clauses).toContainEqual(['gte','year',1973]);
  expect(clauses).toContainEqual(['lte','year',1987]);
  expect(clauses).toContainEqual(['gte','year',1980]);
  const or = clauses.filter(c => c[0] === 'or').map(c => c[1]);
  expect(or.some(value => keywords.every(keyword => value.includes(keyword)))).toBe(true);
  expect(or).toContain('model.ilike.%Model10%');
});
it.each(['definition','timeout'])('keeps %s failure unavailable instead of serving an unscoped fallback', async failure => {
  const h = handler({ model_keywords:['Truck'] }, failure);
  const response = await h.request({ segment_id:id, include_dealers:true });
  expect(response.status).toBe(503);
  expect(h.reads.filter(r => r.table === 'vehicle_valuation_feed')).toHaveLength(failure === 'timeout' ? 1 : 0);
});
it('distinguishes a genuinely missing segment', async () => {
  const h = handler(null);
  expect((await h.request({segment_id:id})).status).toBe(404);
});
