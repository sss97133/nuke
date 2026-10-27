// The readable public face: what a reader without JavaScript gets from /, /market, /journal and /llms.txt.
// The Gemini audit of 2026-10-15 found these routes returned a 3 KB shell with no body text, so a reader invented the rest.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import staticAdvisorCard from '../public/.well-known/mcp.json';

const SHELL = '<!doctype html><html><head><title>Nuke</title>' +
  '<meta name="description" content="x" />' +
  '<meta property="og:title" content="x" /><meta property="og:description" content="x" /><meta property="og:url" content="x" />' +
  '<link rel="canonical" href="https://nuke.ag" /></head><body><div id="root"></div></body></html>';

const BOARD = {
  as_of: '2026-10-16T04:47:00Z', day: '2026-10-16',
  columns: ['source', 'name', 'category', 'held_lots', 'held_at', 'population', 'population_method', 'population_confidence', 'population_at'],
  rows: [
    ['mecum', 'Mecum Auctions', 'auction', 213935, '2026-10-16T00:30:07Z', 268979, 'enumerated', 0.85, '2026-10-15T01:00:00Z'],
    ['bat', 'Bring a Trailer', 'auction', 254485, '2026-10-16T00:30:07Z', null, null, null, null],
  ],
};

const words = (html: string) => html.replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;

describe('public face', () => {
  beforeEach(() => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon');
    vi.resetModules();
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  async function call(path: string, board: unknown = BOARD) {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('market_sources_read')) return board ? new Response(JSON.stringify(board)) : new Response('{}', { status: 500 });
      return new Response(SHELL);
    }));
    const mod = await import('../middleware');
    const res = await mod.default(new Request(`https://nuke.ag${path}`));
    return res ? { res, body: await res.text() } : null;
  }

  it.each(['/', '/market'])('%s has real text with dated, ranked source lines', async (path) => {
    const out = await call(path);
    expect(out).not.toBeNull();
    expect(words(out!.body)).toBeGreaterThan(80);
    // ranked by lots held, each count carries its day and the source total carries method, confidence and day
    expect(out!.body.indexOf('Bring a Trailer')).toBeLessThan(out!.body.indexOf('Mecum Auctions'));
    expect(out!.body).toContain('213,935 lots held (counted 2026-10-16)');
    expect(out!.body).toContain('source total 268,979 (enumerated, confidence 0.85, 2026-10-15)');
    // an unknown total is said, never filled
    expect(out!.body).toContain('Bring a Trailer: 254,485 lots held (counted 2026-10-16); source total unknown.');
    expect(out!.body).toContain('<div id="root"><main>');
  });

  it('shows no number when the read fails', async () => {
    const out = await call('/market', null);
    expect(out!.body).toContain('could not be read');
    expect(out!.body).not.toMatch(/\d{3},\d{3}/);
  });

  it('/journal lists no figures from the record', async () => {
    const out = await call('/journal');
    expect(words(out!.body)).toBeGreaterThan(30);
    expect(out!.body).not.toMatch(/\$\d/);
  });

  it('/llms.txt is plain text with links and dated counts', async () => {
    const out = await call('/llms.txt');
    expect(out!.res.headers.get('content-type')).toContain('text/plain');
    expect(out!.body).toContain('github.com/sss97133/nuke');
    expect(out!.body).toContain('counted 2026-10-16');
    expect(out!.body).toContain('nuke.ag/mcp/advisor');
    expect(out!.body).toContain('Nuke Asset Advisor');
  });

  it('/.well-known/mcp.json is the Asset Advisor server card', async () => {
    const out = await call('/.well-known/mcp.json');
    expect(out!.res.status).toBe(200);
    expect(out!.res.headers.get('content-type')).toContain('application/json');
    const card = JSON.parse(out!.body);
    expect(card.url).toBe('https://nuke.ag/mcp/advisor');
    expect(card.tools).toEqual(['find_asset', 'get_asset', 'get_comps', 'value_asset', 'evaluate_listing', 'budget_options']);
    expect(staticAdvisorCard.tools).toEqual(card.tools);
    expect(staticAdvisorCard.version).toEqual(card.version);
  });

  it('/docs and bare /api return real 404 JSON, not the SPA shell', async () => {
    for (const path of ['/docs', '/api']) {
      const out = await call(path);
      expect(out!.res.status).toBe(404);
      expect(out!.res.headers.get('content-type')).toContain('application/json');
      expect(out!.body).toContain('not_found');
      expect(out!.body).not.toContain('<div id="root"');
    }
  });

  it('sends a publishable key in apikey only, never as a Bearer token', async () => {
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_abc');
    vi.resetModules();
    const f = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => String(input).includes('market_sources_read')
      ? new Response(JSON.stringify(BOARD)) : new Response(SHELL));
    vi.stubGlobal('fetch', f);
    const mod = await import('../middleware');
    await mod.default(new Request('https://nuke.ag/market'));
    const rpc = f.mock.calls.find((c) => String(c[0]).includes('market_sources_read'))!;
    const h = (rpc[1]?.headers ?? {}) as Record<string, string>;
    expect(h.apikey).toBe('sb_publishable_abc');
    expect(h.Authorization).toBeUndefined();
  });

  it('the internal base-HTML fetch is not rendered again', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const mod = await import('../middleware');
    const res = await mod.default(new Request('https://nuke.ag/', { headers: { 'x-nuke-internal': '1' } }));
    expect(res).toBeUndefined();
  });
});
