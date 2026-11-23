import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { moneyAmounts } from './lib/cohortReport';
import {
  buildCompareFace,
  CITATIONS,
  COMPARE_FETCHED_ON,
  COMPARE_PATHS,
  citation,
  NUKE_CLAIM_LOCKSTEP,
  parseComparePath,
} from './lib/compareFaces';

const ROOT = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

const hrefs = (html: string): string[] =>
  [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

const citationHrefs = new Set(CITATIONS.map((c) => c.href));

describe('parseComparePath', () => {
  it('accepts the published compare and alternatives paths only', () => {
    expect(parseComparePath('/compare')).toBe('index');
    expect(parseComparePath('/alternatives/')).toBe('index');
    expect(parseComparePath('/compare/nuke-vs-hagerty')).toBe('hagerty');
    expect(parseComparePath('/compare/nuke-vs-classic-com')).toBe('classic');
    expect(parseComparePath('/compare/nuke-vs-bat-results')).toBe('bat');
    expect(parseComparePath('/compare/nuke-vs-kbb')).toBeNull();
    expect(parseComparePath('/alternatives/nuke-vs-hagerty')).toBeNull();
    expect(COMPARE_PATHS).toContain('/compare/nuke-vs-hagerty');
  });
});

describe('citations', () => {
  it('are dated to this writing run and expose the phrases the faces use', () => {
    expect(COMPARE_FETCHED_ON).toBe('2026-11-23');
    for (const c of CITATIONS) {
      expect(c.fetchedOn).toBe(COMPARE_FETCHED_ON);
      expect(c.href.startsWith('https://')).toBe(true);
      expect(c.phrases.length).toBeGreaterThan(0);
    }
    expect(citation('bat-results').phrases).toContain('View 275,777 Completed Auctions');
  });
});

describe('buildCompareFace', () => {
  it('gives every published path a self-canonical, title, description, and FAQ JSON-LD', () => {
    for (const path of COMPARE_PATHS) {
      const page = buildCompareFace(path);
      expect(page).not.toBeNull();
      expect(page!.path).toBe(path);
      expect(page!.title).toMatch(/ \| Nuke$/);
      expect(page!.description.length).toBeGreaterThan(40);
      expect(page!.head).toContain('"@type":"WebPage"');
      expect(page!.head).toContain('"@type":"FAQPage"');
      expect(page!.head).toContain(`"url":"https://nuke.ag${path}"`);
    }
  });

  it('links every competitor phrase to a citation fetched for this unit, and invents no prices', () => {
    const pages = COMPARE_PATHS.map((p) => buildCompareFace(p)!);
    for (const page of pages) {
      expect(moneyAmounts(page.body + page.head + page.description)).toEqual([]);
      const all = page.body + page.head;
      expect(all).not.toMatch(/industry standard/i);
      expect(all).not.toMatch(/cheaper than/i);
      expect(all).not.toMatch(/more accurate than/i);
      expect(all).not.toMatch(/nuke is more accurate/i);
      expect(all).not.toMatch(/most complete map/i);
    }

    const hagerty = buildCompareFace('/compare/nuke-vs-hagerty')!;
    expect(hagerty.title).toBe('Nuke vs Hagerty | Nuke');
    expect(hagerty.body).toContain(citation('hagerty-method').href);
    expect(hagerty.body).toContain(citation('hagerty-valuation-tool').href);
    expect(hagerty.body).toContain(citation('hagerty-insurance').href);
    expect(hagerty.body).toContain('high-touch, human-centered process');
    expect(hagerty.body).toContain('four different condition classifications for every rated vehicle');
    expect(hagerty.body).toContain('Classic and collector car insurance');
    expect(hagerty.body).toContain('does not sell insurance');
    expect(hagerty.body).toContain('does not compare the number of vehicles');

    const classic = buildCompareFace('/compare/nuke-vs-classic-com')!;
    expect(classic.body).toContain(citation('classic-about').href);
    expect(classic.body).toContain(citation('classic-cmb').href);
    expect(classic.body).toContain(citation('classic-valuation').href);
    expect(classic.body).toContain('Neither figure should be used as the exact value of a specific vehicle');
    expect(classic.body).toContain('over 600 auctions and dealers around the world');
    expect(classic.body).toContain('are not the same unit');

    const bat = buildCompareFace('/compare/nuke-vs-bat-results')!;
    expect(bat.body).toContain(citation('bat-about').href);
    expect(bat.body).toContain(citation('bat-results').href);
    expect(bat.body).toContain('View 275,777 Completed Auctions');
    expect(bat.body).toContain('when fetched on 2026-11-23');
    expect(bat.body).toContain('not a count of rows Nuke holds');
    expect(bat.body).toContain('evaluate_listing currently accepts Bring a Trailer URLs only');

    const competitorHosts = ['hagerty.com', 'classic.com', 'bringatrailer.com', 'support.classic.com'];
    for (const page of [hagerty, classic, bat]) {
      const offsite = hrefs(page.body).filter((h) => competitorHosts.some((host) => h.includes(host)));
      expect(offsite.length).toBeGreaterThan(0);
      for (const href of offsite) {
        expect(citationHrefs.has(href)).toBe(true);
      }
    }
  });

  it('maps every Nuke claim phrase to a file that still contains it', () => {
    const bodies = COMPARE_PATHS.map((p) => buildCompareFace(p)!.body).join('\n');
    for (const claim of NUKE_CLAIM_LOCKSTEP) {
      expect(bodies.toLowerCase()).toContain(claim.phrase.toLowerCase());
      const hits = claim.files.filter((f) => read(f).includes(claim.phrase) || read(f).toLowerCase().includes(claim.phrase.toLowerCase()));
      expect(hits, claim.phrase).not.toEqual([]);
    }
  });
});
