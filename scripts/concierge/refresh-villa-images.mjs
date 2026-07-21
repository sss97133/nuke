#!/usr/bin/env node
// The sibarth villa image URLs captured 2026-01-30 have all rotted to 404 (the agency
// re-organised wp-content). The villa PAGES are still 200, so the fix is a re-read of
// the page for current image URLs — not a guess at the new paths.
//
// Two modes:
//   --mark     flag the stored URLs as rotted so nothing downstream trusts them (no network)
//   --refresh  re-read each villa page via Firecrawl and replace image_urls in place,
//              leaving the tagline/price/bedroom facts from the listing scrape untouched.
//
// GATE NOTE — argued, because the honest answer here is NOT writeField.
// Both modes write `metadata.site.facts.image_urls`: a metadata sidecar, not a
// served fact column. scripts/entity/write.mjs is the door for served columns,
// and forcing a metadata list through it would be misapplying the tool to look
// consistent. The organ that DOES apply is `sharedValue` — the same check that
// found the 244-villa defect (244 villas wearing one agency logo binary). A
// bulk image refresh across many villas is precisely where that defect is born,
// and it is only visible ACROSS rows, so it is run over the whole refreshed set
// before any of it lands. `sharedValue` is called unchanged from validate.mjs.
import { createClient } from '@supabase/supabase-js';
import { sharedValue } from '../entity/validate.mjs';

const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const FC = process.env.FIRECRAWL_API_KEY;
const MARK = process.argv.includes('--mark');
const REFRESH = process.argv.includes('--refresh');
const APPLY = process.argv.includes('--apply');
const CONC = Number(process.env.CONC || 5);

const { data: orgs, error } = await db
  .from('organizations')
  .select('id, name, website, metadata')
  .eq('metadata->>project', 'lofficiel-concierge')
  .eq('metadata->site->>extraction_method', 'sibarth-listing-scrape')
  .limit(2000);
if (error) throw error;

const s = { seen: 0, marked: 0, refreshed: 0, no_images_found: 0, failed: 0, held_shared_image: 0 };

// REFRESH is now two passes, and it has to be. A shared-image finding does not
// exist inside one villa — it exists across the set. Applying each villa as it
// came back (the old shape) makes the check unreachable at exactly the moment
// it matters, which is the same structural mistake as the per-value price band
// that catches 5 of 9 Elan villas. Collect, adjudicate the cohort, then write.
const pending = [];

async function pageImages(url) {
  const r = await fetch('https://api.firecrawl.dev/v2/scrape', {
    method: 'POST',
    headers: { Authorization: `Bearer ${FC}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, formats: ['rawHtml'], onlyMainContent: false, timeout: 45000, waitFor: 1500 }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.success) throw new Error(j?.error || `http ${r.status}`);
  const html = j.data?.rawHtml || '';
  const found = new Set();
  const re = /<img[^>]+src=["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["']/gi;
  let m;
  while ((m = re.exec(html)) && found.size < 12) {
    let u = m[1];
    if (/^data:/.test(u)) continue;
    if (/sprite|favicon|icon-|pixel|spacer|1x1|placeholder|loader|logo/i.test(u)) continue;
    if (/maps\.googleapis\.com|maps\.google/.test(u)) continue;   // map tiles are not villa photography
    try { u = new URL(u, url).href; } catch { continue; }
    found.add(u);
  }
  return [...found];
}

const queue = [...orgs];
await Promise.all(Array.from({ length: REFRESH ? CONC : 1 }, async () => {
  while (queue.length) {
    const o = queue.shift();
    s.seen++;
    const site = o.metadata?.site;
    if (!site?.facts) continue;

    if (MARK) {
      if (!site.facts.image_urls) continue;
      const upd = {
        metadata: {
          ...o.metadata,
          site: {
            ...site,
            facts: {
              ...site.facts,
              image_urls_status: 'rotted_404',
              image_urls_checked_at: new Date().toISOString(),
              image_urls_note: 'source CDN paths returned 404 on recheck; re-read the villa page for current URLs',
            },
          },
        },
      };
      s.marked++;
      if (APPLY) await db.from('organizations').update(upd).eq('id', o.id);
      continue;
    }

    if (REFRESH) {
      try {
        const imgs = await pageImages(o.website);
        if (!imgs.length) { s.no_images_found++; continue; }
        // Collected, not written. The cohort check below decides.
        pending.push({ org: o, site, imgs });
      } catch { s.failed++; }
      if (s.seen % 25 === 0) console.error(JSON.stringify(s));
    }
  }
}));

// ── PASS 2: the cohort. A LEAD image worn by many unrelated villas is the
// 244-villa defect. Each villa is keyed by its first image — the one that
// actually reaches a client surface — and clustered by `sharedValue`, which
// also knows the difference between N unrelated subjects (misattribution) and
// duplicate rows for one business (`sameBusiness`). Its verdict is used as it
// stands; nothing is reimplemented and no threshold is invented here.
if (REFRESH && pending.length) {
  const findings = sharedValue(
    pending.map((p) => ({ id: p.org.id, __name: p.org.name, lead_image: p.imgs[0] })),
    { field: 'lead_image' },
  );
  const heldIds = new Set();
  for (const f of findings) {
    if (f.severity === 'flag') continue;            // duplicate rows for one business — not a misattribution
    for (const id of f.evidence.ids) heldIds.add(id);
    console.error(`  HELD ${f.evidence.n} villas share one lead image [${f.severity}] ${f.reason}`);
    console.error(`       ${f.evidence.subjects.join(' · ')}`);
    console.error(`       ${f.evidence.value}`);
  }

  for (const { org: o, site, imgs } of pending) {
    const held = heldIds.has(o.id);
    if (held) s.held_shared_image++; else s.refreshed++;
    const upd = {
      metadata: {
        ...o.metadata,
        site: {
          ...site,
          facts: {
            ...site.facts,
            // A held set is preserved, never served and never lost — the same
            // promise the writer's quarantine makes, in this file's own shape.
            ...(held
              ? {
                image_urls_status: 'held_shared_lead_image',
                image_urls_held: imgs,
                image_urls_held_reason: 'this villa\'s lead image is worn by other unrelated villas — an agency/platform asset, not this villa\'s photography (shared_value)',
                image_urls_checked_at: new Date().toISOString(),
              }
              : {
                image_urls: imgs,
                image_urls_status: 'refreshed',
                image_urls_observed_at: new Date().toISOString(),
              }),
          },
        },
      },
    };
    if (APPLY) await db.from('organizations').update(upd).eq('id', o.id);
  }
}

console.error(JSON.stringify(s, null, 2));
