import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SITE, sitemapIndexXml, sitemapXml } from './lib/discoveryFace';
import {
  STATIC_SITEMAP_URLS,
  SITEMAP_CHUNK,
  buildSitemapIndex,
  buildStaticSitemap,
  buildUrlset,
  chunkCount,
  encodeSitemap,
  indexLocs,
  parseChunkParam,
  parseContentRangeTotal,
} from './lib/sitemaps';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('sitemap helpers', () => {
  it('chunks at 50,000 URLs', () => {
    expect(SITEMAP_CHUNK).toBe(50_000);
    expect(chunkCount(0)).toBe(0);
    expect(chunkCount(1)).toBe(1);
    expect(chunkCount(50_000)).toBe(1);
    expect(chunkCount(50_001)).toBe(2);
    expect(chunkCount(879_876)).toBe(18);
  });

  it('parses chunk path parameters', () => {
    expect(parseChunkParam('0')).toBe(0);
    expect(parseChunkParam('17')).toBe(17);
    expect(parseChunkParam('00')).toBe(0);
    expect(parseChunkParam('-1')).toBeNull();
    expect(parseChunkParam('1.5')).toBeNull();
    expect(parseChunkParam('abc')).toBeNull();
    expect(parseChunkParam(undefined)).toBeNull();
  });

  it('reads a PostgREST Content-Range total', () => {
    expect(parseContentRangeTotal('0-0/879876')).toBe(879876);
    expect(parseContentRangeTotal('0-999/110')).toBe(110);
    expect(parseContentRangeTotal('0-0/*')).toBeNull();
    expect(parseContentRangeTotal(null)).toBeNull();
  });

  it('the static sitemap keeps prerendered public pages and drops the broken /api URL', () => {
    const locs = STATIC_SITEMAP_URLS.map((u) => u.loc);
    expect(locs).toContain(`${SITE}/`);
    expect(locs).toContain(`${SITE}/market`);
    expect(locs).toContain(`${SITE}/journal`);
    expect(locs).not.toContain(`${SITE}/api`);
    expect(locs).not.toContain(`${SITE}/search`);
    expect(locs).not.toContain(`${SITE}/market/dashboard`);
    const xml = buildStaticSitemap();
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).not.toContain('/api</loc>');
  });

  it('the index lists static, work, vehicle and cohort sitemaps', () => {
    const xml = buildSitemapIndex(50_001, 110, '2026-11-23');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex ')).toBe(true);
    expect(xml).toContain(`${SITE}/sitemap-static.xml`);
    expect(xml).toContain(`${SITE}/sitemap-work.xml`);
    expect(xml).toContain(`${SITE}/sitemap-vehicles/0.xml`);
    expect(xml).toContain(`${SITE}/sitemap-vehicles/1.xml`);
    expect(xml).not.toContain(`${SITE}/sitemap-vehicles/2.xml`);
    expect(xml).toContain(`${SITE}/sitemap-cohorts/0.xml`);
    expect(xml).not.toContain(`${SITE}/sitemap-cohorts/1.xml`);
    expect(indexLocs(0, 0, '2026-11-23').map((u) => u.loc)).toEqual([
      `${SITE}/sitemap-static.xml`,
      `${SITE}/sitemap-work.xml`,
    ]);
    expect(sitemapIndexXml([])).toContain('</sitemapindex>');
  });

  it('gzips a large urlset when the client accepts gzip', () => {
    const xml = buildUrlset(Array.from({ length: 3 }, (_, i) => ({ loc: `${SITE}/vehicle/${i}` })));
    const raw = encodeSitemap(xml, undefined);
    expect(typeof raw.body).toBe('string');
    const gz = encodeSitemap(xml, 'gzip, deflate');
    expect(Buffer.isBuffer(gz.body)).toBe(true);
    expect(gz.headers['Content-Encoding']).toBe('gzip');
    expect(gunzipSync(gz.body as Buffer).toString('utf8')).toBe(xml);
    expect(sitemapXml([])).toContain('<urlset');
  });
});

describe('robots.txt', () => {
  const robots = readFileSync(path.resolve(here, '../public/robots.txt'), 'utf8');

  it('points at the sitemap index and allows the public vehicle API and docs', () => {
    expect(robots).toContain('Sitemap: https://nuke.ag/sitemap.xml');
    expect(robots).not.toContain('sitemap-work.xml');
    expect(robots).toMatch(/Allow:\s+\/api\/docs/);
    expect(robots).toMatch(/Allow:\s+\/api\/v1\/vehicle\//);
    expect(robots).toMatch(/Allow:\s+\/llms\.txt/);
    expect(robots).toMatch(/Disallow:\s+\/api\//);
  });

  it('explicitly allows major AI crawlers', () => {
    for (const bot of [
      'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot',
      'ClaudeBot', 'Claude-SearchBot', 'Google-Extended', 'Applebot',
    ]) {
      expect(robots).toContain(`User-agent: ${bot}`);
    }
    const gpt = robots.slice(robots.indexOf('User-agent: GPTBot'));
    expect(gpt).toMatch(/Allow:\s+\//);
    expect(gpt).toMatch(/Disallow:\s+\/api\//);
    expect(gpt).toMatch(/Allow:\s+\/api\/docs/);
  });
});
