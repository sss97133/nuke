import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SITE } from './lib/discoveryFace';
import { moneyAmounts } from './lib/cohortReport';
import {
  DEVELOPERS_FAQS,
  DEVELOPERS_PUBLIC_LINKS,
  VALUATION_FAQS,
  developersFace,
  productFace,
  valuationFace,
} from './lib/productFaces';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function ld(page: { head?: string }): { '@graph': Array<Record<string, unknown>> } {
  const m = page.head?.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no json-ld');
  return JSON.parse(m[1]);
}

describe('product faces', () => {
  it('/valuation is a self-described recorded-sales tool with FAQ JSON-LD and no invented prices', () => {
    const page = valuationFace();
    expect(page.path).toBe('/valuation');
    expect(page.title).toBe('Recorded sale prices | Nuke');
    expect(page.description).toContain('valuation_by_ymm');
    expect(page.body).toContain('valuation_by_ymm');
    expect(page.body).toContain('Bring a Trailer');
    expect(page.body).toContain('https://bringatrailer.com/policies/');
    expect(page.body).toContain('<h2>How does Nuke show recorded sale prices for a year, make, and model?</h2>');
    expect(page.body).toContain('Is this an appraisal');
    expect(moneyAmounts(`${page.title}\n${page.description}\n${page.body}\n${page.head}`)).toEqual([]);
    const graph = ld(page);
    expect(graph['@graph'].map((n) => n['@type'])).toEqual(['WebApplication', 'FAQPage']);
    expect(graph['@graph'][0].url).toBe(`${SITE}/valuation`);
    expect(productFace('/valuation/')).toEqual(page);
  });

  it('valuation claims appear in Valuation.tsx or the valuation_by_ymm name', () => {
    const src = readFileSync(path.join(root, 'nuke_frontend/src/pages/Valuation.tsx'), 'utf8');
    expect(src).toContain("supabase.rpc('valuation_by_ymm'");
    expect(src).toContain('https://bringatrailer.com/policies/');
    expect(src).toContain('Bring a Trailer');
    expect(src).toContain('no inflation or exchange-rate adjustment');
    expect(src).toContain('Condition and equipment remain unmatched');
    expect(VALUATION_FAQS[0].a).toContain('valuation_by_ymm');
    expect(VALUATION_FAQS[1].a).toContain('evaluate_listing');
  });

  it('/developers lists only public no-key surfaces and invents no prices', () => {
    const page = developersFace();
    expect(page.path).toBe('/developers');
    expect(page.title).toBe('Developers | Nuke');
    expect(page.body).toContain(`${SITE}/api/v1/vehicle/`);
    expect(page.body).toContain(`${SITE}/api/docs`);
    expect(page.body).toContain(`${SITE}/mcp/advisor`);
    expect(page.body).toContain('find_asset, get_asset, get_comps, value_asset, evaluate_listing, and budget_options');
    expect(page.body).not.toContain('@sss97133/nuke-mcp-server');
    expect(page.body).not.toContain('nk_live_');
    expect(moneyAmounts(`${page.title}\n${page.description}\n${page.body}\n${page.head}`)).toEqual([]);
    const graph = ld(page);
    expect(graph['@graph'].map((n) => n['@type'])).toEqual(['WebApplication', 'FAQPage']);
    expect(productFace('/developers')).toEqual(page);
    expect(productFace('/market')).toBeNull();
  });

  it('developer public links and advisor tools match this repo', () => {
    const tools = readFileSync(path.join(root, 'supabase/functions/mcp-connector/advisor/tools.ts'), 'utf8');
    for (const name of ['find_asset', 'get_asset', 'get_comps', 'value_asset', 'evaluate_listing', 'budget_options']) {
      expect(tools).toContain(`name: "${name}"`);
      expect(DEVELOPERS_PUBLIC_LINKS[2].note).toContain(name);
      expect(DEVELOPERS_FAQS[0].a).toContain(name);
    }
    expect(tools).toContain('ADVISOR_TOOLS');
    const middleware = readFileSync(path.join(root, 'nuke_frontend/middleware.ts'), 'utf8');
    expect(middleware).toContain("url: 'https://nuke.ag/mcp/advisor'");
    expect(middleware).toContain('/api/v1/vehicle/');
    expect(middleware).toContain('/llms.txt');
    expect(middleware).toContain('/.well-known/mcp.json');
    const docs = readFileSync(path.join(root, 'nuke_frontend/api/docs/index.ts'), 'utf8');
    expect(docs.length).toBeGreaterThan(0);
    for (const link of DEVELOPERS_PUBLIC_LINKS) {
      expect(link.href.startsWith(SITE)).toBe(true);
    }
  });
});
