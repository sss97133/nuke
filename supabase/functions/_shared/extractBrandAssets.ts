/**
 * Extract "brand DNA" assets from noisy dealer/marketplace pages.
 *
 * Goal: gather a small set of stable branding URLs:
 * - favicon (cached via source_favicons separately)
 * - logo (png/jpg/webp preferred) + svg logo if available
 * - banner/hero (og:image/twitter:image, etc.)
 * - a few additional "brand primary images" for continuity
 *
 * This intentionally does NOT try to understand vehicle listings.
 */

export type BrandAssets = {
  logo_url?: string | null;
  logo_svg_url?: string | null;
  banner_url?: string | null;
  primary_image_urls?: string[];
  raw?: Record<string, any>;
};

function safeString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s : null;
}

function toAbsoluteUrl(baseUrl: string, candidate: string): string | null {
  const raw = safeString(candidate);
  if (!raw) return null;
  // Ignore data URIs
  if (raw.startsWith('data:')) return null;
  try {
    // Protocol-relative
    if (raw.startsWith('//')) return new URL(`https:${raw}`).toString();
    // Absolute
    if (raw.startsWith('http://') || raw.startsWith('https://')) return new URL(raw).toString();
    // Relative
    return new URL(raw, baseUrl).toString();
  } catch {
    return null;
  }
}

function uniqKeepOrder(urls: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of urls) {
    const s = safeString(u);
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function scoreLogoUrl(url: string): number {
  const u = url.toLowerCase();
  let score = 0;
  if (u.includes('logo')) score += 5;
  if (u.endsWith('.svg')) score += 3;
  if (u.endsWith('.png') || u.endsWith('.webp')) score += 2;
  if (u.endsWith('.jpg') || u.endsWith('.jpeg')) score += 1;
  if (u.includes('sprite') || u.includes('icons') || u.includes('favicon')) score -= 5;
  return score;
}

function scoreBannerUrl(url: string): number {
  const u = url.toLowerCase();
  let score = 0;
  if (u.includes('hero') || u.includes('banner') || u.includes('header')) score += 3;
  if (u.includes('og') || u.includes('social') || u.includes('share')) score += 2;
  // Avoid obvious listing galleries when possible
  if (u.includes('galleria_images') || u.includes('inventory')) score -= 3;
  return score;
}

/**
 * Extremely lightweight extraction (regex-based).
 * Prefer stability over completeness.
 */
export function extractBrandAssetsFromHtml(html: string, baseUrl: string): BrandAssets {
  const out: BrandAssets = {
    logo_url: null,
    logo_svg_url: null,
    banner_url: null,
    primary_image_urls: [],
    raw: {},
  };

  const text = html || '';

  // --- Meta images (best banner candidates)
  const metaImagePatterns: Array<{ key: string; re: RegExp }> = [
    { key: 'og:image', re: /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/gi },
    { key: 'twitter:image', re: /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/gi },
    { key: 'twitter:image:src', re: /<meta[^>]+name=["']twitter:image:src["'][^>]+content=["']([^"']+)["'][^>]*>/gi },
  ];
  const metaImages: string[] = [];
  for (const p of metaImagePatterns) {
    for (const m of text.matchAll(p.re)) {
      const abs = toAbsoluteUrl(baseUrl, m[1]);
      if (abs) metaImages.push(abs);
    }
  }

  // --- Logo candidates: <img ... class="...logo..." src="...">
  const imgLogoRe = /<img[^>]+>/gi;
  const logoCandidates: string[] = [];
  const logoSvgCandidates: string[] = [];

  for (const m of text.matchAll(imgLogoRe)) {
    const tag = m[0];
    const cls = (tag.match(/class=["']([^"']+)["']/i)?.[1] || '').toLowerCase();
    const id = (tag.match(/id=["']([^"']+)["']/i)?.[1] || '').toLowerCase();
    const alt = (tag.match(/alt=["']([^"']+)["']/i)?.[1] || '').toLowerCase();
    const src = tag.match(/src=["']([^"']+)["']/i)?.[1] || null;
    const dataSrc =
      tag.match(/data-src=["']([^"']+)["']/i)?.[1] ||
      tag.match(/data-lazy-src=["']([^"']+)["']/i)?.[1] ||
      null;
    const candidate = src || dataSrc;
    if (!candidate) continue;

    const abs = toAbsoluteUrl(baseUrl, candidate);
    if (!abs) continue;

    const looksLogo =
      cls.includes('logo') ||
      id.includes('logo') ||
      alt.includes('logo') ||
      alt.includes('dealer') ||
      abs.toLowerCase().includes('logo');

    if (!looksLogo) continue;

    if (abs.toLowerCase().endsWith('.svg')) logoSvgCandidates.push(abs);
    else logoCandidates.push(abs);
  }

  // --- SVG logo via mask-icon (common for Safari pinned tabs)
  const maskIconRe = /<link[^>]+rel=["']mask-icon["'][^>]+href=["']([^"']+)["'][^>]*>/gi;
  for (const m of text.matchAll(maskIconRe)) {
    const abs = toAbsoluteUrl(baseUrl, m[1]);
    if (abs) logoSvgCandidates.push(abs);
  }

  // Pick best logo/png and best svg
  const bestLogo =
    uniqKeepOrder(logoCandidates)
      .map((u) => ({ u, s: scoreLogoUrl(u) }))
      .sort((a, b) => b.s - a.s)[0]?.u || null;
  const bestSvg =
    uniqKeepOrder(logoSvgCandidates)
      .map((u) => ({ u, s: scoreLogoUrl(u) + 1 }))
      .sort((a, b) => b.s - a.s)[0]?.u || null;

  // Pick best banner from meta images (or fall back to a high-scoring image)
  const banner =
    uniqKeepOrder(metaImages)
      .map((u) => ({ u, s: scoreBannerUrl(u) }))
      .sort((a, b) => b.s - a.s)[0]?.u || null;

  const primaries = uniqKeepOrder([
    ...(banner ? [banner] : []),
    ...metaImages,
    ...logoCandidates.slice(0, 3),
  ]).slice(0, 8);

  out.logo_url = bestLogo;
  out.logo_svg_url = bestSvg;
  out.banner_url = banner;
  out.primary_image_urls = primaries;
  out.raw = {
    meta_images: uniqKeepOrder(metaImages).slice(0, 10),
    logo_candidates: uniqKeepOrder(logoCandidates).slice(0, 10),
    logo_svg_candidates: uniqKeepOrder(logoSvgCandidates).slice(0, 10),
  };

  return out;
}


