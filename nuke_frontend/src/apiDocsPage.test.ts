import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { moneyAmounts } from './lib/cohortReport';
import {
  API_DOCS_DESCRIPTION,
  API_DOCS_FAQS,
  API_DOCS_PUBLIC_LINKS,
  API_DOCS_TITLE,
  apiDocsHtml,
  OPENAPI_PATH,
} from './lib/apiDocsPage';

const ROOT = resolve(__dirname, '../..');

describe('apiDocsHtml', () => {
  it('is a self-canonical page that keeps Redoc and lists only documented no-key surfaces', () => {
    const html = apiDocsHtml();
    expect(html).toContain(`<title>${API_DOCS_TITLE}</title>`);
    expect(html).toContain(`content="${API_DOCS_DESCRIPTION}"`);
    expect(html).toContain('<link rel="canonical" href="https://nuke.ag/api/docs" />');
    expect(html).toContain('spec-url="/v1/openapi.json"');
    expect(html).toContain('redoc.standalone.js');
    expect(html).toContain('"@type":"TechArticle"');
    expect(html).toContain('"@type":"FAQPage"');
    expect(html).toContain(OPENAPI_PATH);
    for (const link of API_DOCS_PUBLIC_LINKS) {
      expect(html).toContain(`href="${link.href}"`);
      expect(html).toContain(link.label);
    }
    for (const f of API_DOCS_FAQS) {
      expect(html).toContain(f.q);
    }
    expect(html).toContain('does not treat every path in it as public or free of a key');
    expect(moneyAmounts(html)).toEqual([]);

    const openapi = JSON.parse(readFileSync(resolve(__dirname, '../public/v1/openapi.json'), 'utf8')) as { info?: { title?: string } };
    expect(openapi.info?.title).toContain('Nuke Vehicle Data API');

    const developers = readFileSync(resolve(ROOT, 'nuke_frontend/src/lib/productFaces.ts'), 'utf8');
    expect(developers).toContain('/api/v1/vehicle/');
    expect(developers).toContain('/mcp/advisor');
    expect(developers).toContain('/.well-known/mcp.json');
    expect(developers).toContain('/llms.txt');

    const handler = readFileSync(resolve(ROOT, 'nuke_frontend/api/docs/index.ts'), 'utf8');
    expect(handler).toContain("from '../../src/lib/apiDocsPage'");
    expect(handler).toContain('apiDocsHtml()');
  });
});
