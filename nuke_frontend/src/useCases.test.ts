import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SITE } from './lib/discoveryFace';
import { moneyAmounts } from './lib/cohortReport';
import {
  USE_CASE_PATHS,
  USE_CASE_ROUTE_CLAIMS,
  auctionHousesFace,
  dealersFace,
  parseUseCasePath,
  shopsFace,
  buildUseCaseFace,
  buildUseIndexFace,
} from './lib/useCases';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function ld(page: { head?: string }): { '@graph': Array<Record<string, unknown>> } {
  const m = page.head?.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no json-ld');
  return JSON.parse(m[1]);
}

function routesCorpus(): string {
  const files = [
    'nuke_frontend/src/routes/DomainRoutes.tsx',
    'nuke_frontend/src/routes/modules/dealer/routes.tsx',
    'nuke_frontend/src/routes/modules/organization/routes.tsx',
    'nuke_frontend/middleware.ts',
  ];
  return files.map((f) => readFileSync(path.join(root, f), 'utf8')).join('\n');
}

describe('use-case faces', () => {
  it('parses the four use-case paths and rejects unknown ones', () => {
    expect(parseUseCasePath('/use')).toBe('index');
    expect(parseUseCasePath('/use/dealers')).toBe('dealers');
    expect(parseUseCasePath('/use/shops')).toBe('shops');
    expect(parseUseCasePath('/use/auction-houses')).toBe('auction-houses');
    expect(parseUseCasePath('/use/other')).toBeNull();
    expect(buildUseCaseFace('/use/dealers')?.path).toBe(USE_CASE_PATHS.dealers);
  });

  it('every named route exists in DomainRoutes, dealer/org routes, or middleware', () => {
    const corpus = routesCorpus();
    for (const route of USE_CASE_ROUTE_CLAIMS) {
      const needle = route
        .replace('/dealer/:orgId/bulk-editor', '/:orgId/bulk-editor')
        .replace('/dealer/:orgId/dropbox-import', '/:orgId/dropbox-import')
        .replace('/org/:id', '/:orgId')
        .replace('/auction/', '/auction/:listingId')
        .replace('/providers/', '/providers/:handle')
        .replace('/vehicle/', '/vehicle/');
      expect(corpus.includes(needle) || corpus.includes(route) || corpus.includes(route.replace(/\/$/, ''))).toBe(true);
    }
    const dealer = readFileSync(path.join(root, 'nuke_frontend/src/routes/modules/dealer/routes.tsx'), 'utf8');
    expect(dealer).toContain('ProtectedRoute');
    expect(dealer).toContain('bulk-editor');
    expect(dealer).toContain('dropbox-import');
    const bulk = readFileSync(path.join(root, 'nuke_frontend/src/pages/DealerBulkEditor.tsx'), 'utf8');
    for (const field of ['vin', 'asking_price', 'purchase_price', 'cost_basis', 'in_stock']) {
      expect(bulk).toContain(field);
    }
  });

  it('dealer, shop, and auction-house pages self-describe, include FAQ JSON-LD, and invent no prices', () => {
    const pages = [buildUseIndexFace(), dealersFace(), shopsFace(), auctionHousesFace()];
    expect(pages.map((p) => p.path)).toEqual(['/use', '/use/dealers', '/use/shops', '/use/auction-houses']);
    for (const page of pages) {
      expect(page.title.endsWith(' | Nuke')).toBe(true);
      const graph = ld(page);
      expect(graph['@graph'].map((n) => n['@type'])).toEqual(['WebPage', 'FAQPage']);
      expect(graph['@graph'][0].url).toBe(`${SITE}${page.path}`);
      expect(moneyAmounts(`${page.title}\n${page.description}\n${page.body}\n${page.head}`)).toEqual([]);
    }
    expect(dealersFace().body).toContain('/dealer/:orgId/bulk-editor');
    expect(dealersFace().body).toContain('/dealer/:orgId/dropbox-import');
    expect(shopsFace().body).toContain('/jobs');
    expect(shopsFace().body).toContain('payments are shown only to the people on the job');
    expect(auctionHousesFace().body).toContain('/market');
    expect(auctionHousesFace().body).toContain('Bring a Trailer listing URLs only');
    expect(auctionHousesFace().body).toContain('does not claim that every auction house is fully covered');
  });
});
