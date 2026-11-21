// The journal's public routes read as a logged-out visitor: the publishable key, never the service-role key, even
// when the service-role key is set in the environment; the crawler preview reads nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PUBLISHABLE = 'sb_publishable_test';
const SERVICE = 'service_placeholder';

function mockRes() {
  const res: any = { statusCode: 0, headers: {} as Record<string, string>, body: undefined as unknown };
  res.setHeader = (k: string, v: string) => { res.headers[k.toLowerCase()] = v; return res; };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.send = (b: unknown) => { res.body = b; return res; };
  res.end = () => res;
  return res;
}

async function load(path: string) {
  vi.resetModules();
  return (await import(path)).default as (req: any, res: any) => Promise<unknown>;
}

describe('journal routes read as a logged-out visitor', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', PUBLISHABLE);
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE);
    fetchMock = vi.fn(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  const sentKeys = () => fetchMock.mock.calls.map(([, init]: any[]) => [init?.headers?.apikey, init?.headers?.Authorization]);

  it('the index reads vw_journal_density with the publishable key', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify([{ date: '2026-11-19', photo_count: 0 }]), { status: 200 }));
    const handler = await load('../../../api/journal/index');
    const res = mockRes();
    await handler({ method: 'GET', query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/rest/v1/vw_journal_density');
    expect(sentKeys()).toEqual([[PUBLISHABLE, `Bearer ${PUBLISHABLE}`]]);
  });

  it('the index is empty when a visitor may not read the view, and an error for a rejected key', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ code: '42501' }), { status: 401 }));
    let res = mockRes();
    await (await load('../../../api/journal/index'))({ method: 'GET', query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ rows: [] });

    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ message: 'Invalid API key' }), { status: 401 }));
    res = mockRes();
    await (await load('../../../api/journal/index'))({ method: 'GET', query: {} }, res);
    expect(res.statusCode).toBe(502);
  });

  it('the index refuses to run without a publishable key, whatever else is set', async () => {
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const res = mockRes();
    await (await load('../../../api/journal/index'))({ method: 'GET', query: {} }, res);
    expect(res.statusCode).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the day route sends only the publishable key', async () => {
    const res = mockRes();
    await (await load('../../../api/journal/[date]'))({ method: 'GET', query: { date: '2026-11-19' } }, res);
    expect(res.statusCode).toBe(200);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    for (const k of sentKeys()) expect(k).toEqual([PUBLISHABLE, `Bearer ${PUBLISHABLE}`]);
  });

  it('the day route lists photos only for profiles a visitor may read, by the indexed (user_id, taken_at) read', async () => {
    const A = 'aaaaaaaa-0000-4000-8000-000000000001';
    const B = 'bbbbbbbb-0000-4000-8000-000000000002';
    const V = 'cccccccc-0000-4000-8000-000000000003';
    fetchMock.mockImplementation(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/rest/v1/profiles?')) return new Response(JSON.stringify([{ id: A }, { id: B }, { id: 'not-a-uuid' }, {}]), { status: 200 });
      if (u.includes('/rest/v1/vehicle_images?')) {
        return new Response(JSON.stringify([{ id: 'p1', vehicle_id: V, image_url: 'https://example.test/1.jpg', angle: 'front', taken_at: '2026-10-28T10:00:00Z' }]), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    });
    const res = mockRes();
    await (await load('../../../api/journal/[date]'))({ method: 'GET', query: { date: '2026-10-28' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.work_log.photos).toEqual([{ id: 'p1', url: 'https://example.test/1.jpg', angle: 'front', vehicle_id: V, taken_at: '2026-10-28T10:00:00Z' }]);
    expect(res.body.work_log.summary.photo_count).toBe(1);
    const photoReads = fetchMock.mock.calls.map(([u]: any[]) => String(u)).filter((u: string) => u.includes('/rest/v1/vehicle_images?'));
    expect(photoReads).toHaveLength(1);
    expect(photoReads[0]).toContain(`user_id=in.(${A},${B})`);
    expect(photoReads[0]).toContain('taken_at=gte.2026-10-28T00:00:00Z&taken_at=lte.2026-10-28T23:59:59Z');
    expect(photoReads[0]).not.toContain('not-a-uuid');
    for (const k of sentKeys()) expect(k).toEqual([PUBLISHABLE, `Bearer ${PUBLISHABLE}`]);
  });

  it('the day route reads no photos when a visitor may read no profile', async () => {
    const res = mockRes();
    await (await load('../../../api/journal/[date]'))({ method: 'GET', query: { date: '2026-10-28' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.work_log.photos).toEqual([]);
    expect(fetchMock.mock.calls.some(([u]: any[]) => String(u).includes('/rest/v1/vehicle_images'))).toBe(false);
  });

  it('the day route answers 502, not an empty day, when the key is rejected', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ message: 'Invalid API key' }), { status: 401 }));
    const res = mockRes();
    await (await load('../../../api/journal/[date]'))({ method: 'GET', query: { date: '2026-10-28' } }, res);
    expect(res.statusCode).toBe(502);
  });

  it('the crawler preview reads nothing and serves the day with generic tags', async () => {
    const res = mockRes();
    await (await load('../../../api/og/journal/[date]'))({ method: 'GET', query: { date: '2024-08-24' } }, res);
    expect(res.statusCode).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(res.body)).toContain('<meta property="og:title" content="SAT AUG 24 2024 — Nuke journal">');
    expect(String(res.body)).not.toMatch(/photo/i);
  });
});
