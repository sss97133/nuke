// What the edge middleware answers when it cannot read its data store. The vehicle API says "not found" only when the read
// worked and found nothing; a refused or failed read is a 503 with Retry-After. On 2026-10-28 Supabase answered 402 to every
// request and the API reported it as 404, which hid the outage from every probe.
// The middleware is called directly with fetch stubbed (the same shape as discovery.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const VEH = 'a90c008a-3379-41d8-9eb2-b4eda365d74c';
const ROW = { id: VEH, year: 1973, make: 'Datsun', model: '240Z', trim: null, sale_price: null };

type Reply = (url: string) => Response | Promise<Response>;
function upstream(reply: Reply) {
  const mock = vi.fn(async (input: RequestInfo | URL) => reply(String(input)));
  vi.stubGlobal('fetch', mock);
  return mock;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const refused = (status: number) => json({ message: 'refused' }, status);

async function call(path: string, accept = '*/*') {
  const mod = await import('../middleware');
  return mod.default(new Request(`https://nuke.ag${path}`, { headers: { Accept: accept } }));
}

/** The one shape every failed read must take: 503, the refusing status (null when none), retry in 30 s, never cached. */
async function expectUnavailable(res: Response | undefined, upstreamStatus: number | null) {
  expect(res!.status).toBe(503);
  expect(await res!.json()).toEqual({ error: 'upstream unavailable', upstream_status: upstreamStatus });
  expect(res!.headers.get('Retry-After')).toBe('30');
  expect(res!.headers.get('Cache-Control')).toBe('no-store');
  expect(res!.headers.get('Access-Control-Allow-Origin')).toBe('*');
  expect(res!.headers.get('Content-Type')).toContain('application/json');
}

describe('middleware when the data store cannot be read', () => {
  beforeEach(() => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key-for-tests');
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon');
    vi.resetModules();
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  describe('/api/v1/vehicle/:id', () => {
    it('answers 404 only when the read worked and found no public vehicle', async () => {
      const fetched = upstream(() => json([]));
      const res = await call(`/api/v1/vehicle/${VEH}`);
      expect(res!.status).toBe(404);
      expect(await res!.json()).toEqual({ error: 'Vehicle not found', message: 'Vehicle does not exist or is not public.' });
      expect(String(fetched.mock.calls[0][0])).toContain(`/rest/v1/vehicles?id=eq.${VEH}&is_public=eq.true`);
    });

    it.each([401, 402, 404, 429, 500, 521])('answers 503 with upstream_status %i when the read is refused', async (status) => {
      upstream(() => refused(status));
      await expectUnavailable(await call(`/api/v1/vehicle/${VEH}`), status);
    });

    it('answers 503 with a null upstream_status when the read throws', async () => {
      upstream(() => { throw new TypeError('fetch failed'); });
      await expectUnavailable(await call(`/api/v1/vehicle/${VEH}`), null);
    });

    it.each([['an HTML page', '<html>maintenance</html>'], ['a JSON object', '{"message":"maintenance"}'], ['nothing', '']])(
      'answers 503 with a null upstream_status when a 200 carries %s instead of rows', async (_what, body) => {
        upstream(() => new Response(body, { status: 200 }));
        await expectUnavailable(await call(`/api/v1/vehicle/${VEH}`), null);
      });

    it('serves the vehicle when the read returns its row', async () => {
      upstream(() => json([ROW]));
      const res = await call(`/api/v1/vehicle/${VEH}`);
      expect(res!.status).toBe(200);
      const body = await res!.json();
      expect(body.data).toEqual(ROW);
      expect(body.meta.api_url).toBe(`https://nuke.ag/api/v1/vehicle/${VEH}`);
      expect(res!.headers.get('Cache-Control')).toContain('s-maxage=300');
    });
  });

  describe('/vehicle/:id', () => {
    it('tells a JSON client the data store is down', async () => {
      upstream(() => refused(402));
      await expectUnavailable(await call(`/vehicle/${VEH}`, 'application/json'), 402);
    });

    it('leaves a page request to the app shell when the read fails', async () => {
      const fetched = upstream(() => refused(402));
      expect(await call(`/vehicle/${VEH}`, 'text/html')).toBeUndefined();
      expect(fetched).toHaveBeenCalledTimes(1);
    });

    it('still answers a JSON client with the row when the read works', async () => {
      upstream(() => json([ROW]));
      const res = await call(`/vehicle/${VEH}`, 'application/json');
      expect(res!.status).toBe(200);
      expect((await res!.json()).data.id).toBe(VEH);
    });
  });

  describe('/sitemap-work.xml', () => {
    it('answers 503 with the refusing status when no reader answers, not a sitemap with no pages', async () => {
      upstream(() => refused(402));
      await expectUnavailable(await call('/sitemap-work.xml'), 402);
    });

    it('reports the first status that refused when the readers fail in different ways', async () => {
      upstream((url) => {
        if (url.includes('open_requirements_read')) throw new TypeError('fetch failed');
        if (url.includes('discovery_providers_read')) return refused(429);
        return refused(500);
      });
      await expectUnavailable(await call('/sitemap-work.xml'), 429);
    });

    it('answers 200 when every reader answers, even with nothing to list', async () => {
      upstream((url) => {
        if (url.includes('open_requirements_read')) return json({ as_of: '2026-10-28T00:00:00Z', next_after: null, rows: [] });
        if (url.includes('discovery_providers_read')) return json({ providers: [] });
        return json([]);
      });
      const res = await call('/sitemap-work.xml');
      expect(res!.status).toBe(200);
      expect(res!.headers.get('x-nuke-sitemap')).toBe('jobs=ok;providers=ok;organizations=ok');
      expect(await res!.text()).toContain('<loc>https://nuke.ag/jobs</loc>');
    });
  });
});
