#!/usr/bin/env node
/**
 * scrape-brand-assets.mjs — Automated brand design language extraction
 *
 * For each org that has a `website` but empty `brand_design_language`:
 * 1. Fetch homepage HTML
 * 2. Extract: logos (SVG preferred), favicon, og:image, meta theme-color
 * 3. Extract: CSS variables / inline styles for brand colors
 * 4. Extract: font-family declarations from CSS
 * 5. Attempt dark/light logo variants
 * 6. Store results in brand_design_language JSONB
 * 7. Flag as status: "scraped_pending_validation"
 *
 * Usage:
 *   dotenvx run -- node scripts/scrape-brand-assets.mjs                    # scrape all missing
 *   dotenvx run -- node scripts/scrape-brand-assets.mjs --org "Ford"       # scrape specific org
 *   dotenvx run -- node scripts/scrape-brand-assets.mjs --org-id <uuid>    # scrape by ID
 *   dotenvx run -- node scripts/scrape-brand-assets.mjs --url <url>        # preview scrape (no DB write)
 *   dotenvx run -- node scripts/scrape-brand-assets.mjs --dry-run          # show what would be scraped
 *   dotenvx run -- node scripts/scrape-brand-assets.mjs --limit 5          # max orgs to process
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── CLI args ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = parseInt(args[args.indexOf('--limit') + 1]) || 50;
const ORG_NAME = args.includes('--org') ? args[args.indexOf('--org') + 1] : null;
const ORG_ID = args.includes('--org-id') ? args[args.indexOf('--org-id') + 1] : null;
const PREVIEW_URL = args.includes('--url') ? args[args.indexOf('--url') + 1] : null;

// ── Fetch with timeout ───────────────────────────────────────────────
async function fetchPage(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
}

// ── CSS fetcher (fetch linked stylesheets) ───────────────────────────
async function fetchLinkedCSS(html, baseUrl, maxSheets = 3) {
  const cssTexts = [];
  const linkRe = /<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["'][^>]*>/gi;
  let count = 0;
  for (const m of html.matchAll(linkRe)) {
    if (count >= maxSheets) break;
    try {
      const cssUrl = new URL(m[1], baseUrl).toString();
      // Only fetch same-origin or CDN stylesheets
      const cssHost = new URL(cssUrl).hostname;
      const baseHost = new URL(baseUrl).hostname;
      if (cssHost !== baseHost && !cssHost.includes('cdn') && !cssHost.includes('fonts') && !cssHost.includes('static')) continue;
      const css = await fetchPage(cssUrl, 8000);
      cssTexts.push(css);
      count++;
    } catch { /* skip failed sheets */ }
  }
  return cssTexts.join('\n');
}

// ── Color extraction ─────────────────────────────────────────────────
function extractColors(html, css) {
  const colors = {};

  // 1. meta theme-color
  const themeColor = html.match(/<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i)?.[1];
  if (themeColor) colors.theme = themeColor.trim();

  // 2. msapplication-TileColor
  const tileColor = html.match(/<meta[^>]+name=["']msapplication-TileColor["'][^>]+content=["']([^"']+)["']/i)?.[1];
  if (tileColor) colors.tile = tileColor.trim();

  // 3. CSS custom properties (--primary-color, --brand-color, etc.)
  const combined = (html + '\n' + css);
  const varRe = /--(primary|brand|accent|secondary|main|base|theme)[-_]?(?:color|bg|background)?:\s*([#][0-9a-fA-F]{3,8}|rgb[a]?\([^)]+\))/gi;
  for (const m of combined.matchAll(varRe)) {
    const name = m[1].toLowerCase();
    colors[`var_${name}`] = m[2].trim();
  }

  // 4. Prominent hex colors from body/header styles
  const hexRe = /#([0-9a-fA-F]{6})\b/g;
  const hexCounts = {};
  for (const m of combined.matchAll(hexRe)) {
    const hex = `#${m[1].toUpperCase()}`;
    // Skip near-black, near-white, and grays
    if (['#000000', '#FFFFFF', '#FAFAFA', '#F5F5F5', '#333333', '#666666', '#999999', '#CCCCCC', '#EEEEEE', '#FBFBFB', '#F8F8F8', '#E5E5E5', '#D4D4D4'].includes(hex)) continue;
    hexCounts[hex] = (hexCounts[hex] || 0) + 1;
  }
  const topHexes = Object.entries(hexCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([hex, count]) => ({ hex, count }));

  return { extracted: colors, frequency: topHexes };
}

// ── Font extraction ──────────────────────────────────────────────────
function extractFonts(html, css) {
  const fonts = new Set();
  const combined = (html + '\n' + css);

  // font-family declarations
  const ffRe = /font-family:\s*["']?([^;}"']+)/gi;
  for (const m of combined.matchAll(ffRe)) {
    const families = m[1].split(',').map(f => f.trim().replace(/["']/g, ''));
    for (const f of families) {
      if (['inherit', 'initial', 'unset', 'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', '-apple-system', 'BlinkMacSystemFont'].includes(f.toLowerCase())) continue;
      if (f.length > 2 && f.length < 60) fonts.add(f);
    }
  }

  // Google Fonts links
  const gfRe = /fonts\.googleapis\.com\/css[^"']*family=([^"'&]+)/gi;
  for (const m of combined.matchAll(gfRe)) {
    const families = decodeURIComponent(m[1]).split('|');
    for (const f of families) {
      const name = f.split(':')[0].replace(/\+/g, ' ').trim();
      if (name) fonts.add(name);
    }
  }

  // @font-face declarations
  const ffaceRe = /@font-face\s*\{[^}]*font-family:\s*["']?([^;"']+)/gi;
  for (const m of combined.matchAll(ffaceRe)) {
    const name = m[1].trim().replace(/["']/g, '');
    if (name.length > 1 && name.length < 60) fonts.add(name);
  }

  return [...fonts];
}

// ── Logo extraction (extends extractBrandAssets.ts pattern) ──────────
function extractLogos(html, baseUrl) {
  const logos = {
    primary: null,
    primary_svg: null,
    favicon: null,
    og_image: null,
    variants: [],
  };

  function toAbs(candidate) {
    if (!candidate || typeof candidate !== 'string') return null;
    const s = candidate.trim();
    if (s.startsWith('data:')) return null;
    try {
      if (s.startsWith('//')) return new URL(`https:${s}`).toString();
      if (s.startsWith('http')) return new URL(s).toString();
      return new URL(s, baseUrl).toString();
    } catch { return null; }
  }

  // Favicons
  const faviconRe = /<link[^>]+rel=["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]+href=["']([^"']+)["'][^>]*>/gi;
  for (const m of html.matchAll(faviconRe)) {
    const url = toAbs(m[1]);
    if (url && !logos.favicon) logos.favicon = url;
  }

  // og:image
  const ogRe = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/gi;
  for (const m of html.matchAll(ogRe)) {
    const url = toAbs(m[1]);
    if (url) logos.og_image = url;
  }

  // Logo images (img tags with logo class/id/alt/src)
  const imgRe = /<img[^>]+>/gi;
  const candidates = [];
  for (const m of html.matchAll(imgRe)) {
    const tag = m[0];
    const cls = (tag.match(/class=["']([^"']+)["']/i)?.[1] || '').toLowerCase();
    const id = (tag.match(/id=["']([^"']+)["']/i)?.[1] || '').toLowerCase();
    const alt = (tag.match(/alt=["']([^"']+)["']/i)?.[1] || '').toLowerCase();
    const src = tag.match(/src=["']([^"']+)["']/i)?.[1];
    const dataSrc = tag.match(/data-src=["']([^"']+)["']/i)?.[1];
    const url = toAbs(src || dataSrc);
    if (!url) continue;

    const looksLogo = cls.includes('logo') || id.includes('logo') || alt.includes('logo') || url.toLowerCase().includes('logo');
    if (!looksLogo) continue;

    const score = scoreLogo(url);
    candidates.push({ url, score, isSvg: url.toLowerCase().endsWith('.svg') });
  }

  // SVG logo via mask-icon
  const maskRe = /<link[^>]+rel=["']mask-icon["'][^>]+href=["']([^"']+)["'][^>]*>/gi;
  for (const m of html.matchAll(maskRe)) {
    const url = toAbs(m[1]);
    if (url) candidates.push({ url, score: 8, isSvg: true });
  }

  // Sort by score
  candidates.sort((a, b) => b.score - a.score);

  for (const c of candidates) {
    if (c.isSvg && !logos.primary_svg) logos.primary_svg = c.url;
    else if (!c.isSvg && !logos.primary) logos.primary = c.url;
    logos.variants.push(c.url);
  }

  // Try to find dark/light variants by URL pattern
  const allLogoUrls = [...new Set([logos.primary, logos.primary_svg, ...logos.variants].filter(Boolean))];
  const variantPatterns = ['-white', '-light', '-rev', '-reversed', '-dark', '-on-dark', '-on-light', '_white', '_light', '_dark'];
  for (const url of allLogoUrls) {
    for (const pat of variantPatterns) {
      if (url.toLowerCase().includes(pat)) {
        logos.variants.push(url);
      }
    }
  }
  logos.variants = [...new Set(logos.variants)].slice(0, 10);

  return logos;
}

function scoreLogo(url) {
  const u = url.toLowerCase();
  let score = 0;
  if (u.includes('logo')) score += 5;
  if (u.endsWith('.svg')) score += 3;
  if (u.endsWith('.png') || u.endsWith('.webp')) score += 2;
  if (u.endsWith('.jpg') || u.endsWith('.jpeg')) score += 1;
  if (u.includes('sprite') || u.includes('icons') || u.includes('favicon')) score -= 5;
  if (u.includes('header') || u.includes('nav')) score += 1;
  return score;
}

// ── Assemble brand_design_language ───────────────────────────────────
function assembleBrandDesignLanguage(html, css, baseUrl) {
  const colorData = extractColors(html, css);
  const fonts = extractFonts(html, css);
  const logos = extractLogos(html, baseUrl);

  // Determine primary/secondary/accent from extracted data
  const colors = {};
  if (colorData.extracted.theme) colors.primary = colorData.extracted.theme;
  else if (colorData.extracted.var_primary) colors.primary = colorData.extracted.var_primary;
  else if (colorData.extracted.var_brand) colors.primary = colorData.extracted.var_brand;
  else if (colorData.frequency[0]) colors.primary = colorData.frequency[0].hex;

  if (colorData.extracted.var_secondary) colors.secondary = colorData.extracted.var_secondary;
  else if (colorData.frequency[1]) colors.secondary = colorData.frequency[1].hex;

  if (colorData.extracted.var_accent) colors.accent = colorData.extracted.var_accent;
  else if (colorData.frequency[2]) colors.accent = colorData.frequency[2].hex;

  // Background: look for body background
  const bgRe = /body[^{]*\{[^}]*background(?:-color)?:\s*([#][0-9a-fA-F]{3,8}|rgb[a]?\([^)]+\)|white)/gi;
  const bgMatch = (html + '\n' + css).match(bgRe);
  if (bgMatch) {
    const hexM = bgMatch[0].match(/#[0-9a-fA-F]{3,8}/);
    if (hexM) colors.background = hexM[0];
  }

  return {
    status: 'scraped_pending_validation',
    scraped_at: new Date().toISOString(),
    source_url: baseUrl,
    colors: Object.keys(colors).length > 0 ? colors : null,
    colors_raw: colorData,
    typography: {
      detected_fonts: fonts,
      primary_font: fonts[0] || null,
      secondary_font: fonts[1] || null,
      font_source: fonts.length > 0 ? 'detected' : null,
    },
    logos: {
      primary_dark: logos.primary || logos.primary_svg || null,
      primary_light: null, // needs manual identification
      icon: logos.favicon || null,
      svg: logos.primary_svg || null,
      og_image: logos.og_image || null,
      all_variants: logos.variants,
    },
    voice: null, // requires human input
    usage_rules: null, // requires human input
  };
}

// ── Store to org_assets ──────────────────────────────────────────────
async function storeLogoAssets(orgId, orgSlug, logos) {
  const assets = [];
  if (logos.primary_dark) {
    assets.push({ org_slug: orgSlug, asset_type: 'logo', asset_url: logos.primary_dark, metadata: { variant: 'primary_dark' } });
  }
  if (logos.svg) {
    assets.push({ org_slug: orgSlug, asset_type: 'logo_svg', asset_url: logos.svg, metadata: { variant: 'svg' } });
  }
  if (logos.icon) {
    assets.push({ org_slug: orgSlug, asset_type: 'favicon', asset_url: logos.icon, metadata: {} });
  }
  if (logos.og_image) {
    assets.push({ org_slug: orgSlug, asset_type: 'banner', asset_url: logos.og_image, metadata: {} });
  }

  for (const asset of assets) {
    const { error } = await supabase.from('org_assets').upsert(asset, { onConflict: 'org_slug,asset_type' });
    if (error) console.warn(`  ⚠ Failed to upsert org_asset (${asset.asset_type}): ${error.message}`);
  }

  return assets.length;
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  // Preview mode: just scrape a URL and print results
  if (PREVIEW_URL) {
    console.log(`\n🔍 Preview scrape: ${PREVIEW_URL}\n`);
    try {
      const html = await fetchPage(PREVIEW_URL);
      const css = await fetchLinkedCSS(html, PREVIEW_URL);
      const bdl = assembleBrandDesignLanguage(html, css, PREVIEW_URL);
      console.log(JSON.stringify(bdl, null, 2));
    } catch (err) {
      console.error(`Failed: ${err.message}`);
    }
    return;
  }

  // Build query for orgs needing scraping
  let query = supabase
    .from('organizations')
    .select('id, name, website, slug, brand_design_language')
    .not('website', 'is', null)
    .order('created_at', { ascending: false })
    .limit(LIMIT);

  if (ORG_ID) {
    query = supabase
      .from('organizations')
      .select('id, name, website, slug, brand_design_language')
      .eq('id', ORG_ID);
  } else if (ORG_NAME) {
    query = supabase
      .from('organizations')
      .select('id, name, website, slug, brand_design_language')
      .ilike('name', `%${ORG_NAME}%`)
      .not('website', 'is', null);
  } else {
    // Only orgs without brand_design_language
    query = query.is('brand_design_language', null);
  }

  const { data: orgs, error } = await query;
  if (error) {
    console.error('Failed to fetch orgs:', error.message);
    process.exit(1);
  }

  // Filter out orgs with invalid websites
  const validOrgs = orgs.filter(o => {
    const w = o.website?.trim();
    if (!w) return false;
    if (w.includes(' ') && !w.startsWith('http')) return false; // "some description" not a URL
    try { new URL(w.startsWith('http') ? w : `https://${w}`); return true; } catch { return false; }
  });

  console.log(`\n📦 Brand asset scraper`);
  console.log(`   Orgs found: ${orgs.length} total, ${validOrgs.length} with valid websites`);
  if (DRY_RUN) console.log('   Mode: DRY RUN\n');
  else console.log('');

  let success = 0, failed = 0, skipped = 0;

  for (const org of validOrgs) {
    const url = org.website.startsWith('http') ? org.website : `https://${org.website}`;
    console.log(`\n── ${org.name} ──`);
    console.log(`   URL: ${url}`);

    if (org.brand_design_language?.status === 'validated') {
      console.log('   ⏭ Already validated, skipping');
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log('   Would scrape (dry run)');
      skipped++;
      continue;
    }

    try {
      const html = await fetchPage(url);
      const css = await fetchLinkedCSS(html, url);
      const bdl = assembleBrandDesignLanguage(html, css, url);

      // Write brand_design_language
      const { error: updateErr } = await supabase
        .from('organizations')
        .update({ brand_design_language: bdl })
        .eq('id', org.id);

      if (updateErr) {
        console.error(`   ❌ DB update failed: ${updateErr.message}`);
        failed++;
        continue;
      }

      // Store logo assets
      const slug = org.slug || org.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const assetCount = await storeLogoAssets(org.id, slug, bdl.logos);

      const colorCount = bdl.colors ? Object.keys(bdl.colors).length : 0;
      const fontCount = bdl.typography.detected_fonts.length;
      console.log(`   ✅ ${colorCount} colors, ${fontCount} fonts, ${assetCount} assets stored`);
      success++;
    } catch (err) {
      console.error(`   ❌ Scrape failed: ${err.message}`);
      failed++;
    }

    await sleep(1000); // polite crawling
  }

  console.log(`\n── Summary ──`);
  console.log(`   ✅ ${success} scraped | ❌ ${failed} failed | ⏭ ${skipped} skipped\n`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
