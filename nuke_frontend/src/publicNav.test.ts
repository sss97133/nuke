import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PUBLIC_DISCOVERY_LINKS } from './lib/publicNav';

const ROOT = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

const CHROME = [
  'nuke_frontend/src/components/layout/AppFooter.tsx',
  'nuke_frontend/src/pages/journal/JournalIndex.tsx',
  'nuke_frontend/src/pages/journal/JournalPage.tsx',
  'nuke_frontend/src/pages/market/SourcesBoard.tsx',
];

describe('PUBLIC_DISCOVERY_LINKS', () => {
  it('are routed in the SPA and appear in About, the footer, and market/journal chrome', () => {
    const routes = read('nuke_frontend/src/routes/DomainRoutes.tsx');
    expect(PUBLIC_DISCOVERY_LINKS.map((l) => l.to)).toEqual([
      '/methodology',
      '/sources',
      '/compare',
      '/use',
    ]);
    for (const link of PUBLIC_DISCOVERY_LINKS) {
      expect(routes).toContain(`path="${link.to}"`);
    }
    const about = read('nuke_frontend/src/pages/About.tsx');
    for (const link of PUBLIC_DISCOVERY_LINKS) {
      expect(about).toContain(`to="${link.to}"`);
    }
    expect(about).toContain('to="/api/docs"');
    for (const file of CHROME) {
      expect(read(file), file).toContain('PublicDiscoveryLinks');
    }
  });
});
