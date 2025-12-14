#!/usr/bin/env node
/**
 * Index Bring a Trailer "Local Partners" into `public.businesses`.
 *
 * Source page: https://bringatrailer.com/local-partners/
 *
 * What it does:
 * - Fetches BaT Local Partners HTML
 * - Parses partner rows (name, location, website, BaT username)
 * - Normalizes into a stable "facility" record keyed by `geographic_key`
 * - Creates/updates `businesses` records with `discovered_via = 'bat_local_partners'`
 * - Writes a JSON snapshot to `data/bat/bat_local_partners.json` (optional)
 *
 * Usage:
 *   tsx scripts/index-bat-local-partners.ts --dry-run
 *   tsx scripts/index-bat-local-partners.ts --upsert
 *
 * Env:
 * - SUPABASE_URL / VITE_SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_SERVICE_ROLE_KEY
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';

type PartnerFacility = {
  partner_name: string;
  city: string | null;
  state: string | null;
  country: string | null;
  website_origin: string | null;
  partner_referral_url: string | null;
  bat_username: string | null;
  bat_profile_url: string | null;
  discovered_via: 'bat_local_partners';
  source_url: string;
  geographic_key: string;
  detected_section_labels: {
    group?: string | null;
    region?: string | null;
  };
};

type CliOptions = {
  url: string;
  dryRun: boolean;
  upsert: boolean;
  writeJson: boolean;
  limit: number | null;
};

const DEFAULT_URL = 'https://bringatrailer.com/local-partners/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnv(): void {
  const possiblePaths = [
    path.resolve(process.cwd(), 'nuke_frontend/.env.local'),
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '.env'),
  ];

  // Load ALL env files found (do not stop at first). This prevents a common footgun where
  // `nuke_frontend/.env.local` exists (anon keys only) and masks repo-root `.env` (service role).
  for (const envPath of possiblePaths) {
    try {
      if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath, override: false });
      }
    } catch {
      // ignore
    }
  }
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    url: DEFAULT_URL,
    dryRun: false,
    upsert: false,
    writeJson: true,
    limit: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url' && argv[i + 1]) {
      opts.url = String(argv[++i]);
      continue;
    }
    if (a === '--dry-run') {
      opts.dryRun = true;
      continue;
    }
    if (a === '--upsert') {
      opts.upsert = true;
      continue;
    }
    if (a === '--no-json') {
      opts.writeJson = false;
      continue;
    }
    if (a === '--limit' && argv[i + 1]) {
      const n = Number(argv[++i]);
      opts.limit = Number.isFinite(n) ? Math.max(1, Math.floor(n)) : null;
      continue;
    }
  }

  // Safety: default to dry-run unless explicitly asked to upsert.
  if (!opts.upsert) opts.dryRun = true;
  if (opts.dryRun) opts.upsert = false;

  return opts;
}

function safeText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s.length ? s : null;
}

function normalizeOrigin(raw: string | null): string | null {
  const s = safeText(raw);
  if (!s) return null;
  const candidate = s.startsWith('http://') || s.startsWith('https://') ? s : `https://${s}`;
  try {
    const u = new URL(candidate);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    return u.origin.replace(/\/$/, '');
  } catch {
    return null;
  }
}

function normalizeUrl(raw: string | null): string | null {
  const s = safeText(raw);
  if (!s) return null;
  const candidate = s.startsWith('http://') || s.startsWith('https://') ? s : `https://${s}`;
  try {
    const u = new URL(candidate);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function normalizeStateOrProvince(raw: string | null): string | null {
  const s = safeText(raw);
  if (!s) return null;
  const two = s.toUpperCase();
  if (/^[A-Z]{2}$/.test(two)) return two;
  return null;
}

function mapCountry(regionLabel: string | null, groupLabel: string | null): string | null {
  const r = (regionLabel || '').toLowerCase();
  const g = (groupLabel || '').toLowerCase();

  // Group-level hints first
  if (g.includes('canada')) return 'CA';
  if (g.includes('united states')) return 'US';
  if (g.includes('europe')) return null;
  if (g.includes('united kingdom')) return 'GB';

  // Region-level hints (as seen on the page)
  if (r.includes('belgium')) return 'BE';
  if (r.includes('germany')) return 'DE';
  if (r.includes('netherlands')) return 'NL';
  if (r.includes('england')) return 'GB';

  return null;
}

function computeGeographicKey(partnerName: string, city: string | null, state: string | null, country: string | null): string {
  const parts = [
    slugify(partnerName),
    city ? slugify(city) : 'na',
    state ? state.toUpperCase() : 'na',
    country ? country.toUpperCase() : 'na',
  ];
  return parts.join('|');
}

function inferBusinessTypeHint(partnerName: string, website: string | null): { type: string; business_type: string } {
  const s = `${partnerName} ${website || ''}`.toLowerCase();

  // `type` must match businesses_type_check (separate from `business_type`)
  if (/(restoration|coachwork|coachworks|body\s*shop|collision|paint|autowerks|autowerk)/i.test(s)) {
    return { type: 'restoration_shop', business_type: 'restoration_shop' };
  }
  if (/(performance|racing|dyno|tuning)/i.test(s)) {
    return { type: 'performance_shop', business_type: 'performance_shop' };
  }
  if (/(detail|detailing)/i.test(s)) {
    return { type: 'garage', business_type: 'detailing' };
  }

  return { type: 'garage', business_type: 'specialty_shop' };
}

function extractPartnerNameFromVisitLinkText(text: string | null): string | null {
  const t = safeText(text);
  if (!t) return null;
  const m = t.match(/visit\s+the\s+(.+?)\s+website/i);
  return m?.[1] ? safeText(m[1]) : null;
}

function extractSectionLabelsForTable($: cheerio.CheerioAPI, tableEl: cheerio.Element): { group: string | null; region: string | null } {
  const $table = $(tableEl);

  // The page structure tends to be: GROUP heading (e.g. "UNITED STATES") then REGION heading (e.g. "ARIZONA") then a table.
  // We look backwards from the table for the nearest headings.
  const headingTexts: string[] = [];
  $table.prevAll('h1,h2,h3,h4').each((_, h) => {
    const txt = safeText($(h).text());
    if (txt) headingTexts.push(txt);
  });

  const region = headingTexts.find((t) => t.length <= 40 && /^[A-Z][A-Z\s&.\-]+$/.test(t)) || null;
  const group = headingTexts.find((t) => /united states|canada|europe|united kingdom/i.test(t)) || null;

  return { group, region };
}

function parsePartnerFacilities(html: string, sourceUrl: string, limit: number | null): PartnerFacility[] {
  const $ = cheerio.load(html);

  const facilities: PartnerFacility[] = [];

  const tables = $('table').toArray();
  for (const table of tables) {
    const labels = extractSectionLabelsForTable($, table);
    const $table = $(table);

    $table.find('tr').each((_, tr) => {
      const $tr = $(tr);
      const rowText = safeText($tr.text());
      if (!rowText || !/bat username/i.test(rowText)) return;

      const memberLink = $tr.find('a[href*="bringatrailer.com/member/"]').first();
      const memberHref = normalizeUrl(memberLink.attr('href') || null);
      let batUsername: string | null = null;
      if (memberHref) {
        try {
          const u = new URL(memberHref);
          const parts = u.pathname.split('/').filter(Boolean);
          const memberIdx = parts.findIndex((p) => p === 'member');
          if (memberIdx >= 0 && parts[memberIdx + 1]) {
            batUsername = decodeURIComponent(parts[memberIdx + 1]);
          }
        } catch {
          // ignore
        }
      }

      // Find partner website links in row (exclude bringatrailer, wp-content, and member link itself)
      const externalAnchors = $tr
        .find('a[href]')
        .toArray()
        .map((a) => {
          const href = normalizeUrl($(a).attr('href') || null);
          const text = safeText($(a).text());
          return { href, text };
        })
        .filter((a) => !!a.href)
        .filter((a) => {
          try {
            const u = new URL(a.href!);
            const host = u.hostname.replace(/^www\./, '').toLowerCase();
            if (host === 'bringatrailer.com') return false;
            if (u.pathname.includes('/wp-content/')) return false;
            return true;
          } catch {
            return false;
          }
        });

      const referralUrl = externalAnchors.length ? externalAnchors[0].href! : null;
      const websiteOrigin = normalizeOrigin(referralUrl);

      // Name heuristics:
      // - Try the first external anchor text (often the partner name)
      // - Else try "visit the X website"
      // - Else fallback: parse from row text before "BaT username"
      let partnerName: string | null = null;
      if (externalAnchors.length) {
        partnerName = safeText(externalAnchors[0].text);
      }
      // Some rows (e.g. with an image in the left column) may only have a "visit the X website" link.
      // If we captured that verbatim as the name, extract the embedded partner name.
      if (partnerName && /^visit\s+the\s+/i.test(partnerName)) {
        const extracted = extractPartnerNameFromVisitLinkText(partnerName);
        if (extracted) partnerName = extracted;
      }
      if (!partnerName) {
        const visitAnchor = externalAnchors.find((a) => /visit\s+the/i.test(a.text || ''));
        partnerName = extractPartnerNameFromVisitLinkText(visitAnchor?.text || null);
      }
      if (!partnerName && rowText) {
        const before = rowText.split(/BaT username/i)[0] || '';
        // Usually: "<Partner Name> <City, ST> visit the <Partner> website"
        // Keep it conservative: take first chunk before a double-space or location comma.
        const m = before.match(/^\s*([^|]+?)\s{2,}/);
        partnerName = safeText(m?.[1] || before);
        if (partnerName && partnerName.length > 120) partnerName = partnerName.slice(0, 120);
      }

      // Location is usually in a <strong> like "Chandler, AZ" or "Kortrijk, Belgium"
      const strongLoc = safeText($tr.find('strong').first().text());
      let city: string | null = null;
      let state: string | null = null;
      let country: string | null = null;

      if (strongLoc && strongLoc.includes(',')) {
        const parts = strongLoc.split(',').map((p) => p.trim()).filter(Boolean);
        if (parts[0]) city = parts[0];
        if (parts[1]) {
          const maybeState = normalizeStateOrProvince(parts[1]);
          if (maybeState) {
            state = maybeState;
          } else {
            // Treat as country label when not a 2-letter code
            country = parts[1];
          }
        }
      }

      const mappedCountry = mapCountry(country, labels.group);
      if (mappedCountry) country = mappedCountry;
      if (!country && labels.group && /united states/i.test(labels.group)) country = 'US';
      if (!country && labels.group && /canada/i.test(labels.group)) country = 'CA';

      // Validate minimum viable record
      if (!partnerName) return;
      if (!batUsername && !memberHref) return;

      const geographic_key = computeGeographicKey(partnerName, city, state, country);

      facilities.push({
        partner_name: partnerName,
        city,
        state,
        country,
        website_origin: websiteOrigin,
        partner_referral_url: referralUrl,
        bat_username: batUsername || safeText(memberLink.text()) || null,
        bat_profile_url: memberHref,
        discovered_via: 'bat_local_partners',
        source_url: sourceUrl,
        geographic_key,
        detected_section_labels: {
          group: labels.group,
          region: labels.region,
        },
      });
    });
  }

  // Deduplicate by geographic_key (keep first)
  const byKey = new Map<string, PartnerFacility>();
  for (const f of facilities) {
    if (!byKey.has(f.geographic_key)) byKey.set(f.geographic_key, f);
  }

  const out = Array.from(byKey.values());
  if (typeof limit === 'number' && Number.isFinite(limit)) return out.slice(0, limit);
  return out;
}

async function fetchHtml(url: string): Promise<string> {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; NukeBot/1.0)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  return await resp.text();
}

async function upsertBusinesses(
  facilities: PartnerFacility[],
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<{ created: number; updated: number; skipped: number }> {
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const f of facilities) {
    // Try to find by geographic_key (preferred to avoid merging multi-location businesses).
    const { data: existingRows, error: findErr } = await supabase
      .from('businesses')
      .select('id, business_name, website, city, state, country, metadata, type, business_type, source_url, discovered_via')
      .eq('geographic_key', f.geographic_key)
      .limit(2);

    if (findErr) {
      console.log(`Find failed for ${f.geographic_key}: ${findErr.message}`);
      skipped++;
      continue;
    }

    const existing = Array.isArray(existingRows) && existingRows.length ? existingRows[0] : null;

    const typeHints = inferBusinessTypeHint(f.partner_name, f.website_origin);
    const desiredType = typeHints.type;
    const desiredBusinessType = typeHints.business_type;

    const nextMetadata = {
      ...(existing?.metadata || {}),
      bat_local_partners: {
        partner_referral_url: f.partner_referral_url,
        bat_username: f.bat_username,
        bat_profile_url: f.bat_profile_url,
        source_url: f.source_url,
        imported_at: new Date().toISOString(),
        detected_labels: f.detected_section_labels,
      },
    };

    if (existing?.id) {
      const updates: any = {
        updated_at: new Date().toISOString(),
        metadata: nextMetadata,
      };

      // Only fill missing columns; do not overwrite existing quality data.
      if (!existing.business_name) updates.business_name = f.partner_name;
      if (!existing.website && f.website_origin) updates.website = f.website_origin;
      if (!existing.city && f.city) updates.city = f.city;
      if (!existing.state && f.state) updates.state = f.state;
      if (!existing.country && f.country) updates.country = f.country;
      if (!existing.source_url) updates.source_url = f.source_url;
      if (!existing.discovered_via) updates.discovered_via = f.discovered_via;
      if (!existing.type) updates.type = desiredType;
      if (!existing.business_type) updates.business_type = desiredBusinessType;

      const { error: updErr } = await supabase.from('businesses').update(updates).eq('id', existing.id);
      if (updErr) {
        console.log(`Update failed for ${f.partner_name}: ${updErr.message}`);
        skipped++;
        continue;
      }

      updated++;
      continue;
    }

    const insertRow: any = {
      business_name: f.partner_name,
      website: f.website_origin,
      city: f.city,
      state: f.state,
      country: f.country || undefined,
      is_public: true,
      status: 'active',
      discovered_via: f.discovered_via,
      source_url: f.source_url,
      geographic_key: f.geographic_key,
      type: desiredType,
      business_type: desiredBusinessType,
      metadata: nextMetadata,
    };

    const { error: insErr } = await supabase.from('businesses').insert(insertRow);
    if (insErr) {
      console.log(`Insert failed for ${f.partner_name}: ${insErr.message}`);
      skipped++;
      continue;
    }
    created++;
  }

  return { created, updated, skipped };
}

async function main() {
  loadEnv();
  const opts = parseArgs(process.argv.slice(2));

  console.log('Indexing BaT Local Partners');
  console.log(`URL: ${opts.url}`);
  console.log(`Mode: ${opts.dryRun ? 'dry-run' : 'upsert'}`);

  const html = await fetchHtml(opts.url);
  const facilities = parsePartnerFacilities(html, opts.url, opts.limit);

  console.log(`Parsed facilities: ${facilities.length}`);

  if (opts.writeJson) {
    const outDir = path.resolve(__dirname, '..', 'data', 'bat');
    const outPath = path.join(outDir, 'bat_local_partners.json');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({ source_url: opts.url, scraped_at: new Date().toISOString(), facilities }, null, 2));
    console.log(`Wrote: ${outPath}`);
  }

  if (opts.dryRun) {
    console.log('Dry-run complete. Use --upsert to write into Supabase.');
    return;
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
    null;

  if (!SUPABASE_URL) {
    throw new Error('Missing SUPABASE_URL (or VITE_SUPABASE_URL)');
  }
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY (or VITE_SUPABASE_SERVICE_ROLE_KEY). Refusing to upsert because `businesses` is RLS-protected.');
  }

  const stats = await upsertBusinesses(facilities, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  console.log(`Upsert complete: created=${stats.created} updated=${stats.updated} skipped=${stats.skipped}`);
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});


