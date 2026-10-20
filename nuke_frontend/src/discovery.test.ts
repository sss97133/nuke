// What a crawler or link preview reads on the open job, provider and organization pages, and the work sitemap.
// The middleware is called directly with fetch stubbed to fixtures in the live readers' shapes (2026-10-19).
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HEADER_CSS_RULES } from './lib/discoveryFace';

const SHELL = '<!doctype html><html><head><title>Nuke</title>' +
  '<meta name="description" content="x" /><link rel="canonical" href="https://nuke.ag" />' +
  '<meta property="og:title" content="x" /><meta property="og:description" content="x" /><meta property="og:type" content="website" />' +
  '<meta property="og:url" content="x" /><meta property="og:image" content="https://nuke.ag/og-image.png" />' +
  '<meta name="twitter:title" content="x" /><meta name="twitter:description" content="x" /><meta name="twitter:image" content="x" />' +
  '</head><body><div id="root"></div></body></html>';

const WO = '3df0f925-1b79-49b4-9181-fd0f4c6e14ad';
const WO2 = '11111111-1111-4111-8111-111111111111';
const VEH = 'a90c008a-3379-41d8-9eb2-b4eda365d74c';
const UID = '0b9f107a-d124-49de-9ded-94698f63c1c4';
const ORG = '50c4c2f1-3e91-44bb-9600-2168e0037ff4';
const PERSONAL = /(@[a-z0-9.-]+\.[a-z]{2,}|\d{3}[-. )]\d{3}[-. ]\d{4}|Jane Customer|Private Shop LLC|\$\d)/i;

type Fixtures = Record<string, unknown>;
function stub(fx: Fixtures) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    const rpc = /\/rpc\/([a-z_]+)/.exec(u)?.[1];
    if (rpc) {
      const key = rpc === 'open_requirements_read' && init?.body && JSON.parse(String(init.body)).p_after ? 'open_requirements_read:2' : rpc;
      return key in fx ? new Response(JSON.stringify(fx[key])) : new Response('{"message":"unavailable"}', { status: 400 });
    }
    const rest = /\/rest\/v1\/([a-z_]+)\?/.exec(u)?.[1];
    if (rest) return new Response(JSON.stringify(fx[`rest:${rest}`] ?? []));
    return new Response(SHELL);
  }));
}

async function call(path: string, fx: Fixtures, accept = 'text/html') {
  stub(fx);
  const mod = await import('../middleware');
  const res = await mod.default(new Request(`https://nuke.ag${path}`, { headers: { Accept: accept } }));
  return res ? { res, body: await res.text() } : null;
}
const meta = (html: string, prop: string) => new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`).exec(html)?.[1] ?? null;

const BOARD = {
  as_of: '2026-10-19T21:00:00Z', next_after: null, coverage: { total_open: 2 },
  rows: [
    { requirement_id: 'r1', requirement_kind: 'skill', description: 'Factory radiator top brackets', work_order_id: WO, display_title: '83 GMC C10 - Drivetrain & Suspension Service',
      vehicle_label: { text: '1983 GMC K2500 Sierra Classic' }, area_band: { city: 'Boulder City', state: 'NV' } },
    { requirement_id: 'r2', requirement_kind: 'inspection', description: 'Road-test inspection', work_order_id: WO, display_title: '83 GMC C10 - Drivetrain & Suspension Service' },
  ],
};

describe('discovery faces', () => {
  beforeEach(() => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon');
    vi.resetModules();
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('/jobs states the reader total and lists requests with links', async () => {
    const out = await call('/jobs', { open_requirements_read: BOARD });
    expect(out!.body).toContain('<title>Jobs looking for someone | Nuke</title>');
    expect(meta(out!.body, 'og:description')).toContain('2 open requests on Nuke (read 2026-10-19)');
    expect(out!.body).toContain(`<link rel="canonical" href="https://nuke.ag/jobs" />`);
    expect(out!.body).toContain(`href="https://nuke.ag/jobs/${WO}"`);
    expect(out!.body).toContain('Skill: Factory radiator top brackets · 83 GMC C10 - Drivetrain &amp; Suspension Service · 1983 GMC K2500 Sierra Classic · Boulder City, NV');
  });

  it('/jobs/:id describes the job by title, vehicle, stage and requirement count, with no payments or customer', async () => {
    const out = await call(`/jobs/${WO}`, {
      work_order_job_path_read: { work_order_id: WO, display_title: '83 GMC C10 - Drivetrain & Suspension Service', vehicle_id: VEH,
        vehicle_label: { text: '1983 GMC K2500 Sierra Classic' }, customer_name: 'Jane Customer',
        stages: { intake: { state: 'recorded' }, plan: { state: 'partial' }, terms: { state: 'partial' }, execution: { state: 'absent' }, accounting: { state: 'recorded', paid: 4200 } } },
      work_order_resources_read: { requirements: [{ requirement_kind: 'skill', description: 'Factory radiator top brackets' }, { requirement_kind: 'skill', description: 'Spark plugs' }] },
      'rest:vehicles': [{ primary_image_url: 'https://images.example/k2500.jpg' }],
      'rest:vehicle_images': [{ id: 'img-1' }],
    });
    const html = out!.body;
    expect(html).toContain('<title>83 GMC C10 - Drivetrain &amp; Suspension Service | Nuke jobs</title>');
    expect(meta(html, 'og:description')).toBe('1983 GMC K2500 Sierra Classic · Furthest stage on record: Quote and acceptance partly recorded · 2 requirements listed · Open job on Nuke; technicians offer, the customer chooses');
    expect(meta(html, 'og:image')).toBe('https://images.example/k2500.jpg');
    expect(meta(html, 'og:type')).toBe('article');
    expect(html).toContain('<li>Skill: Spark plugs</li>');
    expect(html).not.toMatch(PERSONAL);
    expect(html).not.toContain('4200');
    expect(html).not.toMatch(/accounting/i);
  });

  it('uses the default preview image when the vehicle photo is not shown to the public', async () => {
    const out = await call(`/jobs/${WO}`, {
      work_order_job_path_read: { display_title: 'Job', vehicle_id: VEH, stages: {} },
      'rest:vehicles': [{ primary_image_url: 'https://images.example/held.jpg' }],
      'rest:vehicle_images': [],
    });
    expect(meta(out!.body, 'og:image')).toBe('https://nuke.ag/og-image.png');
  });

  it('pages public organizations past the 1,000-row response cap', async () => {
    const page = (start: number, n: number) => Array.from({ length: n }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(start + i).padStart(12, '0')}` }));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('/rest/v1/organizations')) {
        const offset = Number(/offset=(\d+)/.exec(u)?.[1] ?? 0);
        return new Response(JSON.stringify(offset === 0 ? page(0, 1000) : offset === 1000 ? page(1000, 1000) : page(2000, 3)));
      }
      if (u.includes('/rpc/')) return new Response('{"message":"x"}', { status: 400 });
      return new Response(SHELL);
    }));
    const mod = await import('../middleware');
    const res = await mod.default(new Request('https://nuke.ag/sitemap-work.xml'));
    const xml = await res!.text();
    expect((xml.match(/\/org\//g) ?? []).length).toBe(2003);
    expect(res!.headers.get('x-nuke-sitemap')).toBe('jobs=unread;providers=unread;organizations=ok');
  });

  it('/jobs/:id draws the header with the app\'s own markup and embeds a public header payload', async () => {
    const out = await call(`/jobs/${WO}`, {
      work_order_job_path_read: { work_order_id: WO, display_title: 'Brakes </script><b>x', vehicle_id: VEH, vehicle_label: { text: '1983 GMC K2500' },
        request_source_label: 'Requested on the web', customer_name: 'Jane Customer',
        stages: { intake: { state: 'recorded' }, terms: { state: 'partial' }, accounting: { state: 'recorded', paid: 4200 } } },
      work_order_resources_read: { requirements: [] },
    });
    const html = out!.body;
    expect(html).toContain('<style id="nuke-face-css">');
    expect(html).toContain('<header class="k-section k-masthead"><div class="job-masthead"><h1 class="k-entity">Brakes &lt;/script&gt;&lt;b&gt;x</h1>');
    expect(html).toContain(`<a class="job-link" href="https://nuke.ag/vehicle/${VEH}"><span class="k-body">1983 GMC K2500</span></a>`);
    const raw = /<script type="application\/json" id="nuke-job-header">([\s\S]*?)<\/script>/.exec(html)![1];
    expect(raw).not.toContain('</script>');
    expect(JSON.parse(raw)).toEqual({ work_order_id: WO, display_title: 'Brakes </script><b>x', vehicle_label: { text: '1983 GMC K2500' }, vehicle_id: VEH,
      request_source_label: 'Requested on the web', stages: { intake: 'recorded', terms: 'partial' } });
    expect(html).not.toMatch(PERSONAL);
    expect(html).not.toContain('4200');
  });

  it('the server header copies rules that still exist verbatim in the kit and job-page stylesheets', () => {
    const css = readFileSync(new URL('./kit/kit.css', import.meta.url), 'utf8') + readFileSync(new URL('./pages/jobs/job-page.css', import.meta.url), 'utf8');
    for (const rule of HEADER_CSS_RULES) expect(css).toContain(rule);
  });

  it.each([['/login', 'Sign in to Nuke'], ['/work', 'Work'], ['/work/setup', 'Set up your provider page'], ['/work/setup/', 'Set up your provider page']])(
    '%s paints static, noindexed text with no reads', async (path, heading) => {
      const out = await call(path, {});
      expect(out!.body).toContain(`<main><h1>${heading}</h1><p>`);
      expect(out!.body).toContain('<meta name="robots" content="noindex" />');
      const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(c => String(c[0]));
      expect(calls.some(u => u.includes('/rest/v1/'))).toBe(false);
    });

  it('leaves other /work routes to the app', async () => {
    expect(await call('/work/market', {})).toBeNull();
  });

  it('falls through to the app shell when a job is not open, or the id is not a UUID', async () => {
    expect(await call(`/jobs/${WO2}`, {})).toBeNull();
    expect(await call('/jobs/not-a-uuid', {})).toBeNull();
    expect(await call(`/jobs/${WO}`, { work_order_job_path_read: {} }, 'application/json')).toBeNull();
  });

  it('/providers/:handle shows evidence-derived skills and the area band, never account settings, shops or hand-entered rows', async () => {
    const out = await call('/providers/tigwelder', {
      'rest:profiles': [{ id: UID }],
      provider_profile_read: {
        subject: { kind: 'user', handle: 'tigwelder', city: 'Boulder City', state: 'NV' },
        claims: { account: { role: 'admin', user_type: 'professional', profession: 'mechanic' } },
        capabilities: { items: [{ capability_type: 'welding_tig', derivation: 'evidence_fold' }, { capability_type: 'fabrication_exhaust', derivation: 'evidence_fold' },
          { capability_type: 'upholstery', derivation: 'legacy_hand_entered' }] },
        service_area: { state: 'declared', city: 'Boulder City', state_code: 'NV', radius_miles: 25, mobile: true },
        identity_bridge: { state: 'evidenced' }, facilities: [{ name: 'Private Shop LLC' }], work_record: { jobs: { jobs: 3 } },
      },
    });
    const d = meta(out!.body, 'og:description')!;
    expect(out!.body).toContain('<title>@tigwelder · work record | Nuke</title>');
    expect(d).toBe('Skills from evidence: welding tig, fabrication exhaust · Area: Boulder City, NV within 25 miles, travels to the vehicle · Technician link backed by work · 3 jobs on record');
    expect(out!.body).not.toMatch(/admin|professional|upholstery/i);
    expect(out!.body).not.toMatch(PERSONAL);
    expect(meta(out!.body, 'og:type')).toBe('profile');
  });

  it('a private or unknown profile keeps the plain shell', async () => {
    expect(await call('/providers/nobody', { 'rest:profiles': [] })).toBeNull();
    expect(await call('/providers/bad%20handle!', {})).toBeNull();
    expect(await call(`/providers/actor/${UID}`, {})).toBeNull();
  });

  it('/org/:id gives the name, place and supply kinds without amounts', async () => {
    const out = await call(`/org/${ORG}`, {
      'rest:organizations': [{ id: ORG, business_name: "Tom's Offroad", city: 'Las Vegas', state: 'NV', business_type: 'garage' }],
      organization_supply_read: { work_recorded_on_nuke: { kinds: [{ supply_kind: 'offroad_parts', times: 35, last_on: '2025-09-18' }] }, amount_paid: 9999 },
    });
    expect(out!.body).toContain("<title>Tom's Offroad | Nuke</title>");
    expect(meta(out!.body, 'og:description')).toBe('Garage · Las Vegas, NV · Supplies on record: offroad parts (35 purchase records, last 2025-09-18)');
    expect(out!.body).not.toContain('9999');
    expect(await call('/org/dashboard', {})).toBeNull();
  });

  it('/sitemap-work.xml lists open jobs once, public providers and public organizations, as valid sitemap XML', async () => {
    const out = await call('/sitemap-work.xml', {
      open_requirements_read: { ...BOARD, rows: [...BOARD.rows, { work_order_id: 'not-a-uuid' }], next_after: 'r2' },
      'open_requirements_read:2': { as_of: BOARD.as_of, next_after: null, rows: [{ work_order_id: WO2 }] },
      discovery_providers_read: { providers: [{ handle: 'tig welder', updated_at: '2026-10-18T00:00:00Z' }] },
      'rest:organizations': [{ id: ORG, updated_at: '2026-10-19T00:00:00Z' }, { id: 'bad' }],
    });
    const xml = out!.body;
    expect(out!.res.headers.get('Content-Type')).toContain('application/xml');
    expect(out!.res.headers.get('x-nuke-sitemap')).toBe('jobs=ok;providers=ok;organizations=ok');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')).toBe(true);
    const locs = [...xml.matchAll(/<url><loc>([^<]+)<\/loc>(?:<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>)?<\/url>/g)].map(m => m[1]);
    expect(locs).toEqual(['https://nuke.ag/jobs', `https://nuke.ag/jobs/${WO}`, `https://nuke.ag/jobs/${WO2}`,
      'https://nuke.ag/providers/tig%20welder', `https://nuke.ag/org/${ORG}`]);
    expect((xml.match(/<url>/g) ?? []).length).toBe(locs.length);
    expect(xml).toContain('</urlset>');
  });

  it('keeps serving the sitemap when a reader fails, and says which', async () => {
    const out = await call('/sitemap-work.xml', { open_requirements_read: BOARD });
    expect(out!.res.headers.get('x-nuke-sitemap')).toBe('jobs=ok;providers=unread;organizations=ok');
    expect(out!.body).toContain(`https://nuke.ag/jobs/${WO}`);
  });
});
