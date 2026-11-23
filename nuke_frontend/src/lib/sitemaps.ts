// Public sitemap index and 50k-URL vehicle / cohort chunks, served by nuke_frontend/api/sitemaps/.
// PostgREST max_rows is 1,000, so each chunk is read as successive Range pages. Queries always
// filter is_public and deleted_at, including when the service role key is used.
import { gzipSync } from 'node:zlib';
import {
  SITE,
  cohortPath,
  sitemapIndexXml,
  sitemapXml,
  type SitemapUrl,
} from './discoveryFace';
import { hubSitemapUrls, parseYearProfile, type YearProfile } from './cohortHubs';

export const SITEMAP_CHUNK = 50_000;
export const SITEMAP_PAGE = 1_000;
export const SITEMAP_RANGE_CONCURRENCY = 10;
export const SITEMAP_CACHE = 'public, s-maxage=86400, stale-while-revalidate=86400';
export const SITEMAP_UNAVAILABLE = 'no-store';

export type RestEnv = { url: string; key: string };

export type Read<T> = { ok: true; value: T } | { ok: false; status: number | null };

export const STATIC_SITEMAP_URLS: SitemapUrl[] = [
  { loc: `${SITE}/` },
  { loc: `${SITE}/market` },
  { loc: `${SITE}/journal` },
  { loc: `${SITE}/jobs` },
  { loc: `${SITE}/cohort` },
  { loc: `${SITE}/valuation` },
  { loc: `${SITE}/mcp-advisor` },
  { loc: `${SITE}/use` },
  { loc: `${SITE}/use/dealers` },
  { loc: `${SITE}/use/shops` },
  { loc: `${SITE}/use/auction-houses` },
  { loc: `${SITE}/about` },
  { loc: `${SITE}/methodology` },
  { loc: `${SITE}/grades` },
  { loc: `${SITE}/sources` },
  { loc: `${SITE}/developers` },
  { loc: `${SITE}/api/docs` },
  { loc: `${SITE}/compare` },
  { loc: `${SITE}/compare/nuke-vs-hagerty` },
  { loc: `${SITE}/compare/nuke-vs-classic-com` },
  { loc: `${SITE}/compare/nuke-vs-bat-results` },
  { loc: `${SITE}/alternatives` },
  { loc: `${SITE}/privacy` },
  { loc: `${SITE}/terms` },
];

export function chunkCount(total: number, size = SITEMAP_CHUNK): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.ceil(total / size);
}

export function parseChunkParam(raw: string | string[] | undefined): number | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (!s || !/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 && n < 1000 ? n : null;
}

export function parseContentRangeTotal(header: string | null): number | null {
  if (!header) return null;
  const m = /\/(\d+)\s*$/.exec(header);
  return m ? Number(m[1]) : null;
}

const dayOf = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);

function restHeaders(env: RestEnv, extra?: Record<string, string>): Record<string, string> {
  return {
    apikey: env.key,
    Authorization: `Bearer ${env.key}`,
    Accept: 'application/json',
    ...extra,
  };
}

export async function restExactCount(env: RestEnv, pathAndQuery: string): Promise<Read<number>> {
  const url = `${env.url}/rest/v1/${pathAndQuery}`;
  try {
    const resp = await fetch(url, {
      headers: restHeaders(env, { Prefer: 'count=exact', Range: '0-0' }),
    });
    if (!resp.ok && resp.status !== 206) return { ok: false, status: resp.status };
    const total = parseContentRangeTotal(resp.headers.get('content-range'));
    if (total == null) return { ok: false, status: null };
    return { ok: true, value: total };
  } catch {
    return { ok: false, status: null };
  }
}

async function restRange<T>(env: RestEnv, pathAndQuery: string, from: number, to: number): Promise<Read<T[]>> {
  const url = `${env.url}/rest/v1/${pathAndQuery}`;
  try {
    const resp = await fetch(url, {
      headers: restHeaders(env, { Range: `${from}-${to}`, Prefer: 'count=none' }),
    });
    if (resp.status === 416) return { ok: true, value: [] };
    if (!resp.ok && resp.status !== 206) return { ok: false, status: resp.status };
    const rows = await resp.json();
    if (!Array.isArray(rows)) return { ok: false, status: null };
    return { ok: true, value: rows as T[] };
  } catch {
    return { ok: false, status: null };
  }
}


export function acceptEncodingHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(',') : value;
}

async function collectChunk<T, U>(
  env: RestEnv,
  pathAndQuery: string,
  chunk: number,
  mapRow: (row: T) => U | null,
): Promise<Read<U[]>> {
  const start = chunk * SITEMAP_CHUNK;
  const pages: { from: number; to: number }[] = [];
  for (let offset = start; offset < start + SITEMAP_CHUNK; offset += SITEMAP_PAGE) {
    pages.push({ from: offset, to: Math.min(offset + SITEMAP_PAGE - 1, start + SITEMAP_CHUNK - 1) });
  }
  const urls: U[] = [];
  for (let i = 0; i < pages.length; i += SITEMAP_RANGE_CONCURRENCY) {
    const batch = pages.slice(i, i + SITEMAP_RANGE_CONCURRENCY);
    const results = await Promise.all(batch.map((p) => restRange<T>(env, pathAndQuery, p.from, p.to)));
    for (let j = 0; j < results.length; j++) {
      const got = results[j];
      if (!got.ok) return got;
      for (const row of got.value) {
        const mapped = mapRow(row);
        if (mapped) urls.push(mapped);
      }
      if (got.value.length < batch[j].to - batch[j].from + 1) return { ok: true, value: urls };
    }
  }
  return { ok: true, value: urls };
}

const PUBLIC_VEHICLES =
  'vehicles?is_public=eq.true&deleted_at=is.null&select=id,updated_at&order=id.asc';

const YEAR_COHORTS =
  'make_model_profiles?grain=eq.year&year=not.is.null&select=canonical_make,canonical_model,year,updated_at&order=canonical_make.asc,canonical_model.asc,year.asc';

export function countPublicVehicles(env: RestEnv): Promise<Read<number>> {
  return restExactCount(env, PUBLIC_VEHICLES);
}

export function countYearCohorts(env: RestEnv): Promise<Read<number>> {
  return restExactCount(env, YEAR_COHORTS);
}

type VehicleRow = { id?: unknown; updated_at?: unknown };
type CohortRow = { canonical_make?: unknown; canonical_model?: unknown; year?: unknown; updated_at?: unknown };

export function publicVehicleUrls(env: RestEnv, chunk: number): Promise<Read<SitemapUrl[]>> {
  return collectChunk<VehicleRow, SitemapUrl>(env, PUBLIC_VEHICLES, chunk, (row) => {
    if (typeof row.id !== 'string' || !row.id) return null;
    return { loc: `${SITE}/vehicle/${row.id}`, lastmod: dayOf(typeof row.updated_at === 'string' ? row.updated_at : null) };
  });
}

export function yearCohortUrls(env: RestEnv, chunk: number): Promise<Read<SitemapUrl[]>> {
  return collectChunk<CohortRow, SitemapUrl>(env, YEAR_COHORTS, chunk, (row) => {
    const make = typeof row.canonical_make === 'string' ? row.canonical_make : '';
    const model = typeof row.canonical_model === 'string' ? row.canonical_model : '';
    const year = typeof row.year === 'number' ? row.year : Number(row.year);
    if (!make || !model || !Number.isInteger(year)) return null;
    return {
      loc: `${SITE}${cohortPath(make, model, year)}`,
      lastmod: dayOf(typeof row.updated_at === 'string' ? row.updated_at : null),
    };
  });
}

export async function allYearProfiles(env: RestEnv): Promise<Read<YearProfile[]>> {
  const rows: YearProfile[] = [];
  for (let offset = 0; ; offset += SITEMAP_PAGE) {
    const got = await restRange<CohortRow>(env, YEAR_COHORTS, offset, offset + SITEMAP_PAGE - 1);
    if (!got.ok) return got;
    for (const row of got.value) {
      const parsed = parseYearProfile(row);
      if (parsed) rows.push(parsed);
    }
    if (got.value.length < SITEMAP_PAGE) break;
  }
  return { ok: true, value: rows };
}

export function directorySitemapUrls(rows: YearProfile[]): SitemapUrl[] {
  return hubSitemapUrls(rows);
}

export function indexLocs(vehicleTotal: number, cohortTotal: number, today: string): SitemapUrl[] {
  const locs: SitemapUrl[] = [
    { loc: `${SITE}/sitemap-static.xml`, lastmod: today },
    { loc: `${SITE}/sitemap-work.xml`, lastmod: today },
  ];
  const vehicles = chunkCount(vehicleTotal);
  for (let i = 0; i < vehicles; i++) locs.push({ loc: `${SITE}/sitemap-vehicles/${i}.xml`, lastmod: today });
  const cohorts = chunkCount(cohortTotal);
  for (let i = 0; i < cohorts; i++) locs.push({ loc: `${SITE}/sitemap-cohorts/${i}.xml`, lastmod: today });
  return locs;
}

export function buildSitemapIndex(vehicleTotal: number, cohortTotal: number, today: string): string {
  return sitemapIndexXml(indexLocs(vehicleTotal, cohortTotal, today));
}

export function buildUrlset(urls: SitemapUrl[]): string {
  return sitemapXml(urls);
}

export function buildStaticSitemap(): string {
  return sitemapXml(STATIC_SITEMAP_URLS);
}

export function restEnvFromProcess(env: Record<string, string | undefined> = process.env): RestEnv | null {
  const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').trim();
  // Service role lists reliably; the query still requires is_public and a null deleted_at.
  const key = (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!url || !key) return null;
  return { url, key };
}

export function encodeSitemap(xml: string, acceptEncoding: string | undefined): {
  body: Buffer | string;
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = {
    'Content-Type': 'application/xml; charset=utf-8',
    'Cache-Control': SITEMAP_CACHE,
    'Access-Control-Allow-Origin': '*',
    Vary: 'Accept-Encoding',
  };
  const wantsGzip = (acceptEncoding || '').toLowerCase().includes('gzip');
  const large = Buffer.byteLength(xml, 'utf8') > 1_000_000;
  if (wantsGzip || large) {
    return { body: gzipSync(Buffer.from(xml, 'utf8')), headers: { ...headers, 'Content-Encoding': 'gzip' } };
  }
  return { body: xml, headers };
}
