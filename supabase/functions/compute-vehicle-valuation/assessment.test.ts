import { assert, assertEquals } from 'jsr:@std/assert@1';
const VEHICLE = '10000000-0000-4000-8000-000000000001';
const OWNER = '20000000-0000-4000-8000-000000000001';
const KEY = 'sb_secret_' + crypto.randomUUID();
const names = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_JWKS'];
const saved = names.map(n => Deno.env.get(n));
Deno.env.set(names[0], 'https://assessment.test'); Deno.env.set(names[1], KEY);
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
Deno.env.set(names[2], JSON.stringify({ keys: [{ ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'assessment', alg: 'ES256' }] }));
const b64 = (v: Uint8Array) => btoa(String.fromCharCode(...v)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const encode = (v: unknown) => b64(new TextEncoder().encode(JSON.stringify(v)));
const unsigned = encode({ alg: 'ES256', kid: 'assessment' }) + '.' + encode({ role: 'authenticated', sub: OWNER, exp: Math.floor(Date.now() / 1000) + 3600 });
const USER = unsigned + '.' + b64(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(unsigned))));
let handler!: (req: Request) => Promise<Response>;
const originalServe = Deno.serve;
(Deno as any).serve = (fn: typeof handler) => { handler = fn; };
try { await import('./index.ts'); } finally { Deno.serve = originalServe; }
async function run(options: { private?: boolean; editor?: boolean; service?: boolean; action?: string; anonymous?: boolean; deleted?: boolean } = {}) {
  const calls: Array<{ path: string; url: URL; method: string; body: any }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ path: url.pathname, url, method, body });
    const reply = (v: unknown) => new Response(JSON.stringify(v), { headers: { 'Content-Type': 'application/json' } });
    if (url.pathname === '/rest/v1/vehicles') return reply(url.searchParams.get('select')?.includes('is_public')
      ? { id: VEHICLE, is_public: !options.private, deleted_at: options.deleted ? '2026-01-01T00:00:00Z' : null }
      : { id: VEHICLE, year: 1973, make: 'Pontiac', model: 'Firebird' });
    if (url.pathname === '/rest/v1/rpc/user_can_edit_vehicle') return reply(options.editor === true);
    if (url.pathname === '/rest/v1/rpc/valuation_by_ymm') return reply({});
    if (url.pathname === '/rest/v1/rpc/get_vehicle_specs') return reply([]);
    if (['/rest/v1/vehicle_images', '/rest/v1/vehicle_observations'].includes(url.pathname)) return reply([]);
    throw new Error('Unexpected read or mutation: ' + method + ' ' + url.pathname);
  };
  try {
    const r = await handler(new Request('https://assessment.test/functions/v1/compute-vehicle-valuation', { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(options.anonymous ? {} : { Authorization: 'Bearer ' + (options.service ? KEY : USER) }) },
      body: JSON.stringify({ action: options.action ?? 'assessment', vehicle_id: VEHICLE, force: true }) }));
    return { status: r.status, data: await r.json(), calls };
  } finally { globalThis.fetch = originalFetch; }
}
Deno.test('public signed-in assessment reads all four sections without computing or writing legacy caches', async () => {
  const r = await run(); assertEquals(r.status, 200); assertEquals(r.data.read_only, true);
  for (const section of ['market', 'class', 'commentary', 'photo_audit']) assert(section in r.data.assessment);
  assert(r.calls.every(c => c.method === 'GET' || ['/rest/v1/rpc/valuation_by_ymm', '/rest/v1/rpc/get_vehicle_specs'].includes(c.path)));
  assert(!r.calls.some(c => /nuke_estimates|projection_outcomes|condition_scores|canonical_models/.test(c.path)));
});
Deno.test('private stranger is denied before source, gallery, market or identity reads', async () => {
  const r = await run({ private: true }); assertEquals(r.status, 403);
  assertEquals(r.calls.map(c => c.path), ['/rest/v1/vehicles', '/rest/v1/rpc/user_can_edit_vehicle']);
});
Deno.test('existing private editor and service can read without mutations or model calls', async () => {
  for (const opts of [{ private: true, editor: true }, { private: true, service: true }]) {
    const r = await run(opts); assertEquals(r.status, 200); assertEquals(r.data.read_only, true);
    assert(r.calls.every(c => c.path.startsWith('/rest/') && (c.method === 'GET' || c.path.includes('/rpc/'))));
  }
});
Deno.test('ordinary users cannot invoke the legacy compute/write branch', async () => {
  const r = await run({ action: 'compute' }); assertEquals(r.status, 401); assertEquals(r.calls, []);
});
Deno.test('anonymous or deleted profile reads cannot reach the evidence readers', async () => {
  const a = await run({ anonymous: true }); assertEquals(a.status, 401); assertEquals(a.calls, []);
  const d = await run({ deleted: true, service: true }); assertEquals(d.status, 404); assertEquals(d.calls.length, 1);
});
addEventListener('unload', () => names.forEach((n, i) => saved[i] === undefined ? Deno.env.delete(n) : Deno.env.set(n, saved[i]!)));
