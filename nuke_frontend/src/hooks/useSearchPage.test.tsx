// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ params: new URLSearchParams(), requests: [] as any[], navigate: vi.fn(),
  respond: null as null | ((request: any) => any), rpcCalls: [] as any[], vin: null as null | ((args: any) => any), stats: null as null | ((args: any) => any), byId: null as null | ((id: string) => any) }));
vi.mock('react-router-dom', () => ({ useSearchParams: () => [fixture.params], useNavigate: () => fixture.navigate }));
vi.mock('../lib/track', () => ({ track: vi.fn() }));
vi.mock('../services/aiDataIngestion', () => ({ ingestVehicle: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: {
  from: () => { let id = ''; const chain: any = { select: () => chain, eq: (_key: string, value: string) => { id = value; return chain; }, maybeSingle: () => fixture.byId ? fixture.byId(id) : Promise.resolve({data:null,error:null}) }; return chain; },
  rpc: async (name: string, args: any) => {
    fixture.rpcCalls.push([name, args]);
    if (name === 'vehicle_by_vin_public' && fixture.vin) return fixture.vin(args);
    if (name === 'browse_stats' && fixture.stats) return fixture.stats(args);
    return { data: null };
  },
  functions: { invoke: async (_name: string, request: any) => {
    fixture.requests.push(request.body);
    if (fixture.respond) return fixture.respond(request.body);
    return { error: null, data: { results: [
      { id: 'under', type: 'vehicle', metadata: { sale_price: 12000 } },
      { id: 'over', type: 'vehicle', metadata: { sale_price: 77000 } },
      { id: 'ask-over', type: 'vehicle', metadata: { asking_price: 204000 } },
      { id: 'unknown', type: 'vehicle', metadata: {} },
      { id: 'estimate-under', type: 'vehicle', metadata: { current_value: 14000 } },
    ], meta: { total_count: null, returned_count: 5, offset: request.body.offset || 0, limit: 100,
      has_more: !request.body.offset, next_offset: request.body.offset ? null : 94, vehicle_source: 'ranked' } } };
  } },
} }));
import { useSearchPage } from './useSearchPage';
let state: ReturnType<typeof useSearchPage>; let root: Root; let container: HTMLDivElement;
function Harness() { state = useSearchPage(); return <div>{state.displayResults.map(r => <span key={r.id}>{r.id}</span>)}</div>; }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.params = new URLSearchParams({ q: 'cool cars under $30,000' }); fixture.requests = []; fixture.respond = null; fixture.rpcCalls = []; fixture.vin = null; fixture.stats = null; fixture.byId = null; fixture.navigate.mockReset();
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it('constrains a direct natural-language budget query and excludes unknown/over-budget displayed prices', async () => {
  await act(async () => root.render(<Harness />));
  expect(state.filters.priceMax).toBe('30000');
  expect(state.displayResults.map(r => r.id)).toEqual(['under','estimate-under']);
  expect(fixture.requests[0].includeAI).toBe(false);
  expect(state.vehicleCount).toBe(5); expect(state.displayVehicleCount).toBe(2);
});
it('keeps the budget on loaded pages and clears it when the user changes to an unbounded query', async () => {
  await act(async () => root.render(<Harness />));
  await act(async () => state.handleLoadMore());
  expect(fixture.requests[1]).toMatchObject({ offset: 94, vehicle_source: 'ranked', includeAI: false });
  expect(state.displayResults.map(r => r.id)).toEqual(['under','estimate-under']);
  fixture.params = new URLSearchParams({ q: 'Jeep Cherokee' });
  await act(async () => root.render(<Harness />));
  expect(state.filters.priceMax).toBe(''); expect(state.displayResults).toHaveLength(5);
});
it('uses explicit URL price filters and never lets absent sale prices bypass an upper bound', async () => {
  fixture.params = new URLSearchParams({ q: 'Jeep Cherokee', priceMax: '13000' });
  await act(async () => root.render(<Harness />));
  expect(state.displayResults.map(r => r.id)).toEqual(['under']);
});

const vehicle = (n: number) => ({ id: `vehicle_${n}`, type: 'vehicle', metadata: {} });
const page = (results: any[], offset: number, next: number | null, source = 'ranked') => ({ error: null, data: {
  success: true, results, meta: { offset, limit: 100, returned_count: results.length, total_count: null,
    has_more: next !== null, next_offset: next, vehicle_source: source },
} });

it('uses consumed-candidate offsets and preserves contiguous vehicle IDs beside first-page categories', async () => {
  fixture.params = new URLSearchParams({ q: 'porsche' });
  fixture.respond = request => request.offset
    ? page(Array.from({ length: 100 }, (_, i) => vehicle(i + 94)), 94, null)
    : page([...Array.from({ length: 94 }, (_, i) => vehicle(i)), ...Array.from({ length: 6 }, (_, i) => ({ id: `tag_${i}`, type: 'tag' }))], 0, 94);
  await act(async () => root.render(<Harness />));
  await act(async () => state.handleLoadMore());
  expect(fixture.requests[1].offset).toBe(94);
  expect(state.results.filter(r => r.type === 'vehicle').map(r => r.id)).toEqual(Array.from({ length: 194 }, (_, i) => `vehicle_${i}`));
  expect(state.searchSummary).toBe('Loaded 200 results for "porsche".');
  expect(state.searchMeta?.total_count).toBeNull(); expect(state.searchMeta?.has_more).toBe(false);
});

it('continues the selected fallback reader and retains results/cursor after a failed page for retry', async () => {
  fixture.params = new URLSearchParams({ q: 'porsche gt3' });
  let failed = false;
  fixture.respond = request => {
    if (!request.offset) return page([vehicle(0)], 0, 94, 'ilike');
    if (!failed) { failed = true; return { error: new Error('timeout'), data: null }; }
    return page([vehicle(94)], 94, null, 'ilike');
  };
  await act(async () => root.render(<Harness />));
  await act(async () => state.handleLoadMore());
  expect(state.results.map(r => r.id)).toEqual(['vehicle_0']);
  expect(state.searchMeta?.next_offset).toBe(94); expect(state.searchMeta?.has_more).toBe(true);
  expect(state.searchSummary).toContain('could not be loaded');
  expect(state.loadMoreError).toBe('More results could not be loaded. Try again.');
  await act(async () => state.handleLoadMore());
  expect(fixture.requests.slice(1).map(r => [r.offset, r.vehicle_source])).toEqual([[94, 'ilike'], [94, 'ilike']]);
  expect(state.results.map(r => r.id)).toEqual(['vehicle_0', 'vehicle_94']);
  expect(state.loadMoreError).toBeNull();
});

it('does not invent an offset from a mixed page limit when continuation metadata is missing', async () => {
  fixture.respond = () => ({ error: null, data: { results: [vehicle(0)], meta: { offset: 0, limit: 100, has_more: true } } });
  await act(async () => root.render(<Harness />));
  await act(async () => state.handleLoadMore());
  expect(fixture.requests).toHaveLength(1); expect(state.searchSummary).toContain('could not be loaded');
});

it('rejects a page that switches readers or returns a nonadvancing continuation', async () => {
  fixture.params = new URLSearchParams({ q: 'porsche' });
  let attempt = 0;
  fixture.respond = request => !request.offset ? page([vehicle(0)], 0, 94)
    : ++attempt === 1 ? page([vehicle(94)], 94, null, 'ilike') : page([vehicle(94)], 94, 94);
  await act(async () => root.render(<Harness />));
  await act(async () => state.handleLoadMore());
  await act(async () => state.handleLoadMore());
  expect(state.results.map(r => r.id)).toEqual(['vehicle_0']);
  expect(state.searchMeta?.next_offset).toBe(94); expect(state.searchMeta?.vehicle_source).toBe('ranked');
});

it('rejects a failed payload and a rejected initial request without reporting a zero-result success', async () => {
  fixture.respond = () => ({ error: null, data: { success: false, results: [] } });
  await act(async () => root.render(<Harness />));
  expect(state.searchSummary).toBe('Search failed.'); expect(state.searchMeta).toBeNull();
  fixture.params = new URLSearchParams({ q: 'porsche' });
  fixture.respond = () => Promise.reject(new Error('network'));
  await act(async () => root.render(<Harness />));
  expect(state.searchSummary).toBe('Search failed.'); expect(state.loading).toBe(false);
});

it('ignores an old query load-more response after a new query starts', async () => {
  fixture.params = new URLSearchParams({ q: 'porsche' });
  let finish: (value: any) => void = () => {};
  fixture.respond = request => request.offset ? new Promise(resolve => { finish = resolve; })
    : page([vehicle(request.query === 'porsche' ? 0 : 999)], 0, 94);
  await act(async () => root.render(<Harness />));
  let pending: Promise<void>;
  await act(async () => { pending = state.handleLoadMore(); });
  fixture.params = new URLSearchParams({ q: 'volvo' });
  await act(async () => root.render(<Harness />));
  await act(async () => { finish(page([vehicle(94)], 94, null)); await pending; });
  expect(state.results.map(r => r.id)).toEqual(['vehicle_999']);
  expect(state.searchMeta?.offset).toBe(0);
});

it('retains unread-population metadata at the offset ceiling and asks for refinement without retrying', async () => {
  fixture.params = new URLSearchParams({ q: 'porsche' });
  fixture.respond = request => {
    if (!request.offset) return page([vehicle(0)], 0, 10000);
    const limited = page([vehicle(10000)], 10000, null);
    Object.assign(limited.data.meta, { has_more: true, pagination_limited: true });
    return limited;
  };
  await act(async () => root.render(<Harness />));
  await act(async () => state.handleLoadMore());
  expect(state.results.map(r => r.id)).toEqual(['vehicle_0', 'vehicle_10000']);
  expect(state.searchMeta).toMatchObject({ has_more: true, next_offset: null, pagination_limited: true });
  expect(state.searchSummary).toContain('Refine your search to see more results.');
  await act(async () => state.handleLoadMore());
  expect(fixture.requests).toHaveLength(2); expect(state.searchSummary).not.toContain('Try again');
});

it('continues and retries an empty eligible page using its raw cursor', async () => {
  fixture.params = new URLSearchParams({ q: 'porsche' });
  let failed = false;
  fixture.respond = request => {
    if (!request.offset) return page([], 0, 100);
    if (!failed) { failed = true; return { error: new Error('timeout'), data: null }; }
    return page([vehicle(100)], 100, null);
  };
  await act(async () => root.render(<Harness />));
  expect(state.displayResults).toHaveLength(0); expect(state.searchMeta?.next_offset).toBe(100);
  await act(async () => state.handleLoadMore());
  expect(state.searchMeta?.next_offset).toBe(100); expect(state.loadMoreError).toContain('Try again');
  await act(async () => state.handleLoadMore());
  expect(fixture.requests.slice(1).map(request => request.offset)).toEqual([100,100]);
  expect(state.displayResults.map(result => result.id)).toEqual(['vehicle_100']);
  expect(state.loadMoreError).toBeNull(); expect(state.searchMeta?.has_more).toBe(false);
});

it('keeps pagination available when the price filter removes every loaded result', async () => {
  fixture.respond = request => !request.offset
    ? page([{ ...vehicle(0), metadata: { sale_price: 77000 } }], 0, 94)
    : page([{ ...vehicle(94), metadata: { sale_price: 12000 } }], 94, null);
  await act(async () => root.render(<Harness />));
  expect(state.displayResults).toHaveLength(0); expect(state.searchMeta?.has_more).toBe(true);
  await act(async () => state.handleLoadMore());
  expect(fixture.requests[1].offset).toBe(94);
  expect(state.displayResults.map(result => result.id)).toEqual(['vehicle_94']);
});

it('answers a VIN from the indexed public reader and never calls universal-search', async () => {
  fixture.params = new URLSearchParams({ q: 'wmwsx3c52dt408613' });
  fixture.vin = () => ({ error: null, data: [{ id: 'mini', vin: 'WMWSX3C52DT408613', year: 2013, make: 'Mini', model: 'Cooper S Coupe', image_url: null, sale_price: 12000, asking_price: null, is_for_sale: false, sale_status: 'sold' }] });
  await act(async () => root.render(<Harness />));
  expect(fixture.requests).toHaveLength(0);
  expect(fixture.rpcCalls).toEqual([['vehicle_by_vin_public', { p_vin: 'WMWSX3C52DT408613' }]]);
  expect(state.results.map(r => [r.id, r.type, r.title, r.metadata.sale_price])).toEqual([['mini', 'vehicle', '2013 Mini Cooper S Coupe', 12000]]);
  expect(state.searchSummary).toBe('1 public vehicle in the ledger with VIN WMWSX3C52DT408613.');
  expect(state.loading).toBe(false);
});
it('says when the ledger holds no public vehicle with that VIN', async () => {
  fixture.params = new URLSearchParams({ q: 'WP0AA2A95ES123456' });
  fixture.vin = () => ({ error: null, data: [] });
  await act(async () => root.render(<Harness />));
  expect(fixture.requests).toHaveLength(0);
  expect(state.results).toEqual([]);
  expect(state.searchSummary).toBe('No public vehicle with VIN WP0AA2A95ES123456 in the ledger.');
});


it('finishes a missing UUID lookup and offers retry after a failed UUID read', async () => {
  fixture.params = new URLSearchParams({q:'00000000-0000-4000-8000-000000000001'});
  await act(async () => root.render(<Harness />));
  expect(state.loading).toBe(false); expect(state.searchSummary).toContain('No visible vehicle');
  fixture.byId = async () => ({data:null,error:{message:'private backend detail'}});
  await act(async () => state.retrySearch());
  expect(state.searchError).toContain('could not'); expect(state.searchError).not.toContain('private');
});

it('ignores UUID navigation after the visitor chooses another query', async () => {
  let finish!: (value:any)=>void;
  fixture.params = new URLSearchParams({q:'00000000-0000-4000-8000-000000000001'});
  fixture.byId = () => new Promise(resolve=>{finish=resolve;});
  await act(async () => root.render(<Harness />));
  fixture.params = new URLSearchParams({q:'volvo'}); await act(async()=>root.render(<Harness/>));
  await act(async()=>finish({data:{id:'stale-vehicle'},error:null}));
  expect(fixture.navigate).not.toHaveBeenCalled(); expect(state.results).toHaveLength(5);
});

it('rejects a stale same-query response after navigating away and back', async () => {
  let finish!: (value:any)=>void; let seen=false;
  fixture.params = new URLSearchParams({q:'volvo'});
  fixture.respond = request => request.query==='volvo'&&!seen ? (seen=true,new Promise(resolve=>{finish=resolve;})) : page([vehicle(222)],0,null);
  await act(async()=>root.render(<Harness/>));
  fixture.params = new URLSearchParams({q:'saab'}); await act(async()=>root.render(<Harness/>));
  fixture.params = new URLSearchParams({q:'volvo'}); await act(async()=>root.render(<Harness/>));
  await act(async()=>finish(page([vehicle(111)],0,null)));
  expect(state.results.map(r=>r.id)).toEqual(['vehicle_222']);
});

it('does not attach former-make statistics to the current query', async () => {
  let finish!: (value:any)=>void;
  fixture.params = new URLSearchParams({q:'volvo'});
  fixture.stats = args => args.p_make==='Volvo' ? new Promise(resolve=>{finish=resolve;}) : {data:{total:7},error:null};
  await act(async()=>root.render(<Harness/>));
  fixture.params = new URLSearchParams({q:'saab'}); await act(async()=>root.render(<Harness/>));
  await act(async()=>finish({data:{total:999},error:null}));
  expect(state.browseStats?.total).toBe(7);
});

it('refreshes make/year filters from new URL intent and clears previous local filters', async () => {
  fixture.params = new URLSearchParams({q:'cars',make:'Volvo',yearMin:'1990',yearMax:'2000'});
  await act(async()=>root.render(<Harness/>));
  await act(async()=>state.setFilters({...state.filters,transmission:'manual'}));
  fixture.params = new URLSearchParams({q:'cars',make:'Saab',yearMin:'2001',yearMax:'2009'});
  await act(async()=>root.render(<Harness/>));
  expect(state.filters).toMatchObject({make:'Saab',yearMin:'2001',yearMax:'2009',transmission:''});
});
