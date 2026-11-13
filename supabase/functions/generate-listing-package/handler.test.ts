import { assertEquals, assert } from 'jsr:@std/assert@1';
const VEHICLE = '10000000-0000-4000-8000-000000000001';
const OWNER = '20000000-0000-4000-8000-000000000001';
const IMAGE = '30000000-0000-4000-8000-000000000001';
const EVIDENCE = '40000000-0000-4000-8000-000000000001';
const KEY = 'sb_secret_' + crypto.randomUUID();
const names = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_JWKS'];
const saved = names.map(n => Deno.env.get(n));
Deno.env.set(names[0], 'https://listing.test'); Deno.env.set(names[1], KEY);
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
Deno.env.set(names[2], JSON.stringify({ keys: [{ ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'listing', alg: 'ES256' }] }));
const b64 = (v: Uint8Array) => btoa(String.fromCharCode(...v)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const encode = (v: unknown) => b64(new TextEncoder().encode(JSON.stringify(v)));
const unsigned = encode({ alg: 'ES256', kid: 'listing' }) + '.' + encode({ role: 'authenticated', sub: OWNER, exp: Math.floor(Date.now() / 1000) + 3600 });
const USER = unsigned + '.' + b64(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(unsigned))));
let handler!: (req: Request) => Promise<Response>;
const originalServe = Deno.serve;
(Deno as any).serve = (fn: typeof handler) => { handler = fn; };
try { await import('./index.ts'); } finally { Deno.serve = originalServe; }

async function run(options: { user?: boolean; allowed?: boolean; sourceError?: boolean; marketError?: boolean; anonymous?: boolean } = {}) {
  const calls: Array<{ path: string; url: URL; method: string; body: any }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ path: url.pathname, url, method, body });
    const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.pathname === '/rest/v1/rpc/user_can_edit_vehicle') return reply(options.allowed ?? false);
    if (url.pathname === '/rest/v1/vehicles') return reply({ id: VEHICLE, user_id: OWNER, year: 1973, make: 'Pontiac', model: 'Firebird',
      trim: 'Super Duty', engine_type: 'SD455', description: 'Unsupported SD455 engine in perfect condition.', primary_image_url: 'https://example.test/other.jpg' });
    if (url.pathname === '/rest/v1/rpc/get_contributor_intake') return reply({
      invites: [{ contributor_id: OWNER, display_name: 'Example owner', relationship: 'owner' }],
      answers: [{ observation_id: EVIDENCE, contributor_id: OWNER, answer_text: 'I believe it is an SD455.', is_superseded: false }],
      uploads: [{ image_id: IMAGE, label: 'engine_proof', is_sensitive: false }],
    });
    if (url.pathname === '/rest/v1/rpc/contributor_intake_progress') return reply({ received: ['engine_proof'], proven: [], items: [] });
    if (url.pathname === '/rest/v1/vehicle_images') {
      assertEquals(url.searchParams.get('vehicle_image_gallery_eligible'), 'eq.true');
      for (const field of ['is_sensitive', 'is_document', 'doc_flag']) assertEquals(url.searchParams.get(field), 'not.is.true');
      return reply([{ id: IMAGE, image_url: 'https://example.test/allowed.jpg', vehicle_zone: 'engine_bay' }]);
    }
    if (url.pathname === '/rest/v1/auction_readiness') return reply({ composite_score: 99, tier: 'TIER_1_EXCEPTIONAL' });
    if (url.pathname === '/rest/v1/nuke_estimates') return reply({ estimated_value: 500000, confidence_score: 99, model_version: 'v1' });
    if (url.pathname === '/rest/v1/vehicle_observations') return reply([]);
    if (url.pathname === '/rest/v1/rpc/valuation_by_ymm') return reply(options.marketError ? { message: 'timeout' } : {}, options.marketError ? 504 : 200);
    if (url.pathname === '/rest/v1/rpc/get_vehicle_specs') {
      if (options.sourceError) return reply({ message: 'source read unavailable' }, 503);
      return reply([{ vehicle_id: VEHICLE, schema_version: 'vehicle_data_model_v1', typed_claims_status: 'current_registered_scope_read',
        unresolved_properties: [], claim_page: { reader: 'registered_profile_source_claims_v1', has_more: false, next_after: null },
        typed_claims: [['year', 1973], ['make', 'Pontiac'], ['model', 'Firebird'], ['engine_configuration', 'SD455']].map(([key, value], i) => ({
          property_key: key, value, property_id: EVIDENCE, source_id: OWNER, observation_id: '50000000-0000-4000-8000-' + String(i).padStart(12, '0'),
          evidence_state: 'reported', mechanical_verification: 'unestablished', source_url: 'https://example.test/record',
          observed_at: '2026-01-01T00:00:00Z', ingested_at: '2026-01-02T00:00:00Z', extraction_method: 'retained_report',
        })) }]);
    }
    throw new Error('Unexpected request: ' + url.pathname);
  };
  try {
    const response = await handler(new Request('https://listing.test/functions/v1/generate-listing-package', { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(options.anonymous ? {} : { Authorization: 'Bearer ' + (options.user ? USER : KEY) }) },
      body: JSON.stringify({ vehicle_id: VEHICLE }) }));
    return { status: response.status, data: await response.json(), calls };
  } finally { globalThis.fetch = originalFetch; }
}

Deno.test('actual listing handler excludes unsupported engine/class/copy and preserves attributed owner testimony', async () => {
  const r = await run(); assertEquals(r.status, 200);
  assertEquals(r.data.identity.engine_type, null); assertEquals(r.data.submission_fields.engine, null);
  assert(!JSON.stringify(r.data.listing_content).includes('SD455'));
  assertEquals(r.data.assessment.class.configuration_specific.eligible, false);
  assertEquals(r.data.assessment.attestations[0].statement, 'I believe it is an SD455.');
  assertEquals(r.data.retained_draft.description, 'Unsupported SD455 engine in perfect condition.');
  assertEquals(r.data.valuation, null); assertEquals(r.data.ars_score, null); assertEquals(r.data.submission_ready, false);
  assertEquals(r.data.photos.hero_image, 'https://example.test/allowed.jpg'); assertEquals(r.data.photos.coverage_status, 'unknown');
  for (const section of ['market', 'class', 'commentary', 'photo_audit']) assert(section in r.data.assessment);
  assertEquals(r.data.listing_assertions.length, 3);
  assert(r.calls.every(c => c.path.startsWith('/rest/v1/')), 'Only retained database readers may be called');
});
Deno.test('failed source/market reads remain explicit and never restore raw vehicle assertions', async () => {
  const r = await run({ sourceError: true, marketError: true }); assertEquals(r.status, 200);
  assertEquals(r.data.listing_content.description, null); assertEquals(r.data.identity.year, null);
  assertEquals(r.data.assessment.source_claims.status, 'unavailable'); assertEquals(r.data.assessment.market.status, 'unavailable');
  assertEquals(r.data.retained_valuation.status, 'unqualified_stored_estimate');
});
Deno.test('a signed-in stranger cannot read the draft or prepare its private contributor evidence', async () => {
  const r = await run({ user: true }); assertEquals(r.status, 403);
  assertEquals(r.calls.filter(c => c.path.includes('/rest/')).map(c => c.path), ['/rest/v1/rpc/user_can_edit_vehicle']);
});
Deno.test('an authorized editor keeps the real actor for both contributor readers', async () => {
  const r = await run({ user: true, allowed: true }); assertEquals(r.status, 200);
  assert(r.calls.filter(c => /get_contributor_intake|contributor_intake_progress/.test(c.path)).every(c => c.body.p_acting_as === OWNER));
});

addEventListener('unload', () => names.forEach((n, i) => saved[i] === undefined ? Deno.env.delete(n) : Deno.env.set(n, saved[i]!)));
