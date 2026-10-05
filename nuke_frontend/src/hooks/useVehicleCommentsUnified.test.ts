import { beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  rows: [] as any[], reads: [] as any[], cap: 1000, parent: 'vehicle', parentError: false,
  pages: null as any[] | null, failAfter: false, hang: false, options: null as any,
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: (options: any) => { fixture.options = options; return {}; } }));
vi.mock('../lib/supabase', () => ({ supabase: { from: (table: string) => {
  const read: any = { table }; fixture.reads.push(read);
  let cursor: { category: string; id: string } | undefined, signal: AbortSignal | undefined;
  const q: any = { then: (fn: any) => {
    if (fixture.hang) return new Promise(resolve => signal?.addEventListener('abort', () => resolve({ data: null, error: 'PRIVATE FAILURE' }), { once: true })).then(fn);
    if (table === 'vehicles') return Promise.resolve({ data: fixture.parent ? { id: fixture.parent } : null, error: fixture.parentError ? 'PRIVATE FAILURE' : null }).then(fn);
    const rows = fixture.pages ? fixture.pages.shift() : fixture.rows.filter(row => !cursor || row.source_category > cursor.category || row.source_category === cursor.category && row.comment_id > cursor.id)
      .sort((a,b) => a.source_category.localeCompare(b.source_category) || a.comment_id.localeCompare(b.comment_id)).slice(0,fixture.cap);
    return Promise.resolve({ data: rows, error: cursor && fixture.failAfter ? 'PRIVATE FAILURE' : null }).then(fn);
  } };
  for (const method of ['select','eq','is','order','limit','maybeSingle']) q[method] = (...args: any[]) => { read[method] = args; return q; };
  q.or = (value: string) => { read.or = value; const m = /source_category\.gt\.([^,]+),and\(source_category\.eq\.[^,]+,comment_id\.gt\.([^\)]+)\)/.exec(value); if (m) cursor = { category: m[1], id: m[2] }; return q; };
  q.abortSignal = (value: AbortSignal) => { signal = value; read.signal = value; return q; };
  return q;
} } }));
import { readVehicleCommentsUnified, useVehicleCommentsUnified } from './useVehicleCommentsUnified';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const row = (n: number, changes = {}) => ({ comment_id: id(n), vehicle_id: 'vehicle', source_category: 'auction', observed_at: '2026-10-05T12:00:00Z', ...changes });
beforeEach(() => { fixture.rows = [row(1)]; fixture.reads = []; fixture.cap = 1000; fixture.parent = 'vehicle'; fixture.parentError = false; fixture.pages = null; fixture.failAfter = false; fixture.hang = false; });

it('seeks past a short API cap to an empty page and retains unknown and microsecond clocks', async () => {
  fixture.cap = 64; fixture.rows = Array.from({length:1001},(_,n)=>row(n+1));
  fixture.rows[0].observed_at = null; fixture.rows[1].observed_at = '2026-10-05T12:00:00.123456+00:00';
  const rows = await readVehicleCommentsUnified('vehicle');
  expect(rows).toHaveLength(1001); expect(rows[rows.length - 1]?.observed_at).toBeNull();
  expect(rows.some(x=>x.observed_at==='2026-10-05T12:00:00.123456+00:00')).toBe(true);
  expect(fixture.reads.filter(x=>x.table==='vehicle_comments_unified')).toHaveLength(17);
  expect(fixture.reads[0].table).toBe('vehicles'); expect(fixture.reads.every(x=>x.signal)).toBe(true);
});
it('retains identical IDs in different source categories and stable equal-time ordering', async () => {
  fixture.cap = 1; fixture.rows = [row(1,{source_category:'user'}),row(1),row(1,{source_category:'observation'})];
  const rows = await readVehicleCommentsUnified('vehicle');
  expect(rows.map(x=>x.source_category)).toEqual(['auction','observation','user']);
  expect(fixture.reads[2].or).toContain('source_category.gt.auction');
});
it.each(['missing','foreign','error'])('refuses %s parent before child reads', async kind => {
  fixture.parent = kind==='missing'?'':kind==='foreign'?'other':'vehicle'; fixture.parentError = kind==='error';
  await expect(readVehicleCommentsUnified('vehicle')).rejects.toThrow('Comments could not be loaded completely.');
  expect(fixture.reads.map(x=>x.table)).toEqual(['vehicles']);
});
it('rejects failed pages without returning or caching the earlier prefix; retry reads the collection', async () => {
  fixture.cap=1;fixture.failAfter=true;
  await expect(readVehicleCommentsUnified('vehicle')).rejects.toThrow('Comments could not be loaded completely.');
  fixture.failAfter=false;
  expect(await readVehicleCommentsUnified('vehicle')).toHaveLength(1);
});
it.each(['foreign','repeat','reverse','category','id','malformed'])('rejects %s page output', async kind => {
  fixture.pages=kind==='foreign'?[[row(1,{vehicle_id:'other'})]]:kind==='repeat'?[[row(1)],[row(1)]]:kind==='reverse'?[[row(2)],[row(1)]]:kind==='category'?[[row(1,{source_category:'untrusted'})]]:kind==='id'?[[row(1,{comment_id:'INVALID'})]]:[{not:'rows'}];
  await expect(readVehicleCommentsUnified('vehicle')).rejects.toThrow('Comments could not be loaded completely.');
});
it('returns a successful empty collection distinctly and refuses the collection budget', async () => {
  fixture.rows=[]; expect(await readVehicleCommentsUnified('vehicle')).toEqual([]);
  fixture.rows=[row(1),row(2)]; await expect(readVehicleCommentsUnified('vehicle',undefined,{maxRows:1})).rejects.toThrow('Comments could not be loaded completely.');
});
it('cancels an already-aborted request before reading and bounds a stalled parent', async () => {
  const controller=new AbortController();controller.abort();
  await expect(readVehicleCommentsUnified('vehicle',controller.signal)).rejects.toThrow(); expect(fixture.reads).toEqual([]);
  fixture.hang=true; await expect(readVehicleCommentsUnified('vehicle',undefined,{timeBudgetMs:1})).rejects.toThrow();
});
it('binds the query to its subject and uses cancellation without silent retries', () => {
  useVehicleCommentsUnified('vehicle'); expect(fixture.options.queryKey).toEqual(['vehicle-comments-unified','vehicle']);expect(fixture.options.retry).toBe(false);
  useVehicleCommentsUnified(''); expect(fixture.options.enabled).toBe(false);
});
