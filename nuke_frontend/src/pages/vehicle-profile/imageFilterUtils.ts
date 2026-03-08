/**
 * Pure utility functions for filtering and scoring vehicle images.
 * Extracted from VehicleProfile.tsx to reduce file size.
 * These functions have NO side effects and NO React dependencies.
 */

export const normalizeUrl = (u: any): string => {
  const s = String(u || '').trim();
  if (!s) return '';
  // Some scrapers store HTML-encoded query params (e.g. &amp;). Browsers won't decode those in URLs.
  return s.replace(/&amp;/g, '&');
};

export const buildBatImageNeedle = (v: any): string | null => {
  try {
    const discoveryUrl = String(v?.discovery_url || '');
    const origin = String(v?.profile_origin || '');
    const isBat = origin === 'bat_import' || discoveryUrl.includes('bringatrailer.com/listing/');
    if (!isBat) return null;
    const year = v?.year ? String(v.year) : '';
    const makeRaw = String(v?.make || '').trim().toLowerCase();
    const modelRaw = String(v?.model || '').trim().toLowerCase();
    if (!year || !makeRaw || !modelRaw) return null;
    const makeSlug = makeRaw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const modelSlug = modelRaw.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!makeSlug || !modelSlug) return null;
    // BaT WordPress image paths typically include `${year}_${make}_${model}` with `_` between year+make and `-` in model tokens.
    return `${year}_${makeSlug}_${modelSlug}`;
  } catch {
    return null;
  }
};

export const isIconUrl = (rawUrl: string): boolean => {
  const raw = String(rawUrl || '').trim();
  if (!raw) return true;
  const s = raw.toLowerCase();

  // Hard blocks: favicon endpoints and icon manifests
  if (s.includes('gstatic.com/faviconv2')) return true;
  if (s.includes('favicon.ico') || s.includes('/favicon')) return true;
  if (s.includes('apple-touch-icon')) return true;
  if (s.includes('site.webmanifest')) return true;
  if (s.includes('safari-pinned-tab')) return true;
  if (s.includes('android-chrome')) return true;
  if (s.includes('mstile')) return true;

  // Likely non-photo assets (avoid using as hero/gallery)
  if (s.endsWith('.ico')) return true;
  // Filter SVGs that are clearly UI elements (social icons, navigation, etc.)
  // BUT preserve business/auction/dealer logos stored in proper paths
  if (s.endsWith('.svg')) {
    // Allow logos from known business/auction paths
    if (s.includes('/businesses/') || s.includes('/organizations/') ||
        s.includes('/dealers/') || s.includes('/auctions/') ||
        s.includes('logo_url') || s.includes('business_logo')) {
      return false; // Keep these
    }
    // Filter out UI chrome SVGs (social icons, navigation, etc.)
    if (s.includes('social-') || s.includes('nav-') || s.includes('icon-') ||
        s.includes('/assets/') || s.includes('/icons/') || s.includes('/themes/')) {
      return true; // Filter these
    }
    return true; // Default: filter other SVGs
  }
  // CRITICAL: Filter out organization/dealer logos - these should NEVER be vehicle images
  // Organization logos are stored in organization-logos/ and should only appear as favicons
  if (s.includes('organization-logos/') || s.includes('organization_logos/')) return true;
  if (s.includes('images.classic.com/uploads/dealer/')) return true;
  if (s.includes('/uploads/dealer/')) return true;

  // Filter generic logo paths that are site chrome, but preserve business logos in specific contexts
  if (s.includes('/logo') || s.includes('logo.')) {
    // Filter ALL logos in storage paths (these are organization/dealer logos)
    if (s.includes('/storage/') || s.includes('supabase.co')) return true;
    // Filter site chrome logos (navigation, header, footer)
    if (s.includes('/assets/') || s.includes('/themes/') ||
        s.includes('/header') || s.includes('/footer') || s.includes('/nav')) {
      return true; // Filter these
    }
    return true; // Default: filter other logo paths (vehicle images should not be logos)
  }
  if (s.includes('avatar') || s.includes('badge') || s.includes('sprite')) return true;

  // Query-param size heuristics (favicons/icons are commonly <= 64px)
  try {
    const url = new URL(raw);
    // Small square assets (e.g. Framer site badges/icons) often appear as PNGs with width/height params.
    const wRaw = url.searchParams.get('width') || url.searchParams.get('w');
    const hRaw = url.searchParams.get('height') || url.searchParams.get('h');
    if (wRaw && hRaw) {
      const w = Number(String(wRaw).replace(/[^0-9.]/g, ''));
      const h = Number(String(hRaw).replace(/[^0-9.]/g, ''));
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        const squareish = Math.abs(w - h) <= 8;
        // More aggressive: filter square images with small dimensions (likely logos/badges)
        if (squareish && Math.max(w, h) <= 600 && (s.endsWith('.png') || s.endsWith('.svg'))) return true;
        // Filter very small images (icons)
        if (Math.max(w, h) <= 200 && (s.endsWith('.png') || s.endsWith('.svg') || s.endsWith('.jpg') || s.endsWith('.jpeg'))) return true;
      }
    }
    const sizeParam =
      url.searchParams.get('size') ||
      url.searchParams.get('sz') ||
      url.searchParams.get('w') ||
      url.searchParams.get('width');
    if (sizeParam) {
      const n = Number(String(sizeParam).replace(/[^0-9.]/g, ''));
      if (Number.isFinite(n) && n > 0 && n <= 64) return true;
    }
  } catch {
    // ignore URL parsing errors; fall back to substring filters above
  }

  // Additional checks for Framer/CDN hosted logos and UI elements
  if (s.includes('framerusercontent.com') && (
    s.includes('logo') ||
    s.includes('icon') ||
    s.includes('badge') ||
    s.match(/width=\d+.*height=\d+.*[&=](width|height)=\d{1,3}/) // Small square with width/height params
  )) return true;

  // Flag/banner/site chrome frequently leaks into naive scrapes and even imports.
  // Treat these as noise so they can never become the computed hero/primary.
  // Aggressive filtering: catch all flag variations and patterns
  if (
    /(?:^|\/|\-|_)(flag|flags|banner)(?:$|\/|\-|_|\.)/i.test(s) ||
    s.includes('stars-and-stripes') ||
    s.includes('stars_and_stripes') ||
    s.includes('american-flag') ||
    s.includes('american_flag') ||
    s.includes('us-flag') ||
    s.includes('us_flag') ||
    s.includes('usa-flag') ||
    s.includes('usa_flag') ||
    s.includes('flag-usa') ||
    s.includes('flag_usa') ||
    s.includes('united-states-flag') ||
    s.includes('united_states_flag') ||
    s.includes('old-glory') ||
    s.includes('old_glory') ||
    /(?:^|\/|\-|_)(flag|flags)(?:.*usa|.*us|.*american)/i.test(s) ||
    /(?:usa|us|american).*(?:flag|flags)/i.test(s)
  ) return true;

  return false;
};

export const filterIconNoise = (urls: string[]): string[] => {
  const arr = Array.isArray(urls) ? urls : [];
  const keep = arr.filter((u) => !isIconUrl(String(u || '')));
  // Safety: if we filtered everything out, keep the originals rather than showing nothing.
  return keep.length > 0 ? keep : arr;
};

export const filterBatNoise = (urls: string[], v: any): string[] => {
  const cleaned = (urls || []).map(u => normalizeUrl(u)).filter(Boolean);

  // Never filter out non-BaT URLs (user uploads, Supabase storage, etc.)
  const nonBat = cleaned.filter(u => !u.includes('bringatrailer.com/wp-content/uploads/'));
  const batUrls = cleaned.filter(u => u.includes('bringatrailer.com/wp-content/uploads/'));

  if (batUrls.length === 0) return cleaned;

  // First: Filter known BaT page noise that frequently appears but isn't vehicle images
  const isKnownNoise = (u: string) => {
    const f = u.toLowerCase();
    return (
      f.includes('qotw') ||
      f.includes('winner-template') ||
      f.includes('weekly-weird') ||
      f.includes('mile-marker') ||
      f.includes('podcast') ||
      f.includes('merch') ||
      f.includes('dec-merch') ||
      f.includes('podcast-graphic') ||
      // Generic editorial images (but NOT actual listing images like "Web-40065-68-Porsche-911-1.jpg")
      // BaT listing images use "Web-NNNNN-YY-Make-Model" format — only filter if no vehicle pattern follows
      (/\/web-\d{3,}-/i.test(f) && !/\/web-\d+-\d{2,4}-[a-z]/i.test(f)) ||
      // Homepage/featured content that appears on listing pages
      f.includes('site-post-') ||
      f.includes('thumbnail-template') ||
      // Screenshots of listings (not the actual listing)
      f.includes('screenshot-') ||
      // Social media images
      f.includes('countries/') ||
      f.includes('themes/') ||
      f.includes('assets/img/')
    );
  };

  let filtered = batUrls.filter(u => !isKnownNoise(u));

  // Second: Try to match by vehicle pattern (year_make_model in filename)
  const needle = buildBatImageNeedle(v);
  if (needle && filtered.length > 0) {
    const patternMatched = filtered.filter(u =>
      u.toLowerCase().includes(needle.toLowerCase())
    );
    // Only use pattern matching if we get at least 3 matches (prevents false positives)
    if (patternMatched.length >= 3) {
      filtered = patternMatched;
    }
  }

  // Third: Use date bucket clustering (images from same YYYY/MM upload tend to be from same listing)
  if (filtered.length > 0) {
    const bucketKey = (u: string) => {
      const m = u.match(/\/wp-content\/uploads\/(\d{4})\/(\d{2})\//);
      return m ? `${m[1]}/${m[2]}` : '';
    };
    const bucketCounts = new Map<string, number>();
    for (const u of filtered) {
      const k = bucketKey(u);
      if (k) bucketCounts.set(k, (bucketCounts.get(k) || 0) + 1);
    }
    let bestBucket = '';
    let bestCount = 0;
    for (const [k, c] of bucketCounts.entries()) {
      if (c > bestCount) {
        bestBucket = k;
        bestCount = c;
      }
    }
    // If we have a clear dominant bucket (>=8 images and >=50% of total), use it
    if (bestBucket && bestCount >= 8 && bestCount >= Math.floor(filtered.length * 0.5)) {
      filtered = filtered.filter(u => bucketKey(u) === bestBucket);
    }
  }

  // Combine filtered BaT URLs with non-BaT URLs
  const result = [...nonBat, ...filtered];

  // Safety: if we filtered everything out, keep at least the non-BaT URLs
  return result.length > 0 ? result : (nonBat.length > 0 ? nonBat : urls);
};

export const filterClassicNoise = (urls: string[], v: any): string[] => {
  try {
    const discoveryUrl = String(v?.discovery_url || '');
    const origin = String(v?.profile_origin || '');
    const isClassic = origin === 'url_scraper' && discoveryUrl.includes('classic.com/veh/');
    if (!isClassic) return urls;

    const keep = (urls || []).filter((u) => {
      const raw = normalizeUrl(u);
      if (!raw) return false;
      const s = raw.toLowerCase();

      // Remove dealer logos and other site assets that get picked up by naive image scraping.
      if (s.includes('images.classic.com/uploads/dealer/')) return false;
      if (s.includes('/uploads/dealer/')) return false;

      // For Classic CDN, only keep actual vehicle images.
      if (s.includes('images.classic.com/')) {
        if (!s.includes('/vehicles/')) return false;
      }

      return true;
    });

    return keep.length > 0 ? keep : urls;
  } catch {
    return urls;
  }
};

export const filterCarsAndBidsNoise = (urls: string[], v: any): string[] => {
  const cleaned = (urls || []).map(u => normalizeUrl(u)).filter(Boolean);

  // Never filter out non-Cars & Bids URLs (user uploads, Supabase storage, etc.)
  const nonCarsAndBids = cleaned.filter(u => !u.includes('media.carsandbids.com'));
  const carsAndBidsUrls = cleaned.filter(u => u.includes('media.carsandbids.com'));

  if (carsAndBidsUrls.length === 0) return cleaned;

  // LESS AGGRESSIVE: Only filter obvious noise, keep all valid gallery images
  // This allows external URLs to display immediately
  const isKnownNoise = (u: string) => {
    const f = u.toLowerCase();
    // Only exclude explicit video paths (not just "video" anywhere in URL)
    if (f.includes('/video/') || f.includes('/videos/') || f.match(/\/video[\/\-]/)) {
      return true;
    }
    // Only exclude explicit thumbnail paths (not just "thumb" anywhere)
    if (f.includes('/thumbnail') || f.includes('/thumbnails/')) {
      return true;
    }
    // Exclude UI elements and icons (be more specific)
    if (f.includes('/icon/') || f.includes('/icons/') || f.includes('/logo/') || f.includes('/logos/') ||
        f.includes('/button/') || f.includes('/ui/') || f.includes('/assets/') || f.includes('/static/')) {
      return true;
    }
    // Only exclude /edit/ if it's clearly an edited version path (not in /photos/)
    if (f.includes('/edit/') && !f.includes('/photos/')) {
      return true;
    }
    // Only exclude VERY small thumbnails (80x80 or smaller), not all small images
    // Check both query params AND path-based params (CarsAndBids uses path format)
    try {
      const urlObj = new URL(u);
      // Method 1: Check query parameters
      const widthParam = urlObj.searchParams.get('width');
      const heightParam = urlObj.searchParams.get('height');

      // Method 2: Check path for CarsAndBids CDN format: /cdn-cgi/image/width=80,height=80,...
      const pathMatch = urlObj.pathname.match(/width=(\d+).*?height=(\d+)/i) ||
                       urlObj.pathname.match(/width=(\d+),height=(\d+)/i);

      let width: number | null = null;
      let height: number | null = null;

      if (widthParam && heightParam) {
        width = parseInt(widthParam, 10);
        height = parseInt(heightParam, 10);
      } else if (pathMatch) {
        width = parseInt(pathMatch[1], 10);
        height = parseInt(pathMatch[2], 10);
      }

      // Only filter if BOTH width and height are explicitly set to very small values
      if (width && height && width > 0 && width <= 80 && height > 0 && height <= 80) {
        return true;
      }
    } catch {
      // If URL parsing fails, don't filter it out - show it
    }
    return false;
  };

  const filtered = carsAndBidsUrls.filter(u => !isKnownNoise(u));

  // Combine filtered Cars & Bids URLs with non-Cars & Bids URLs
  const result = [...nonCarsAndBids, ...filtered];

  // Safety: if we filtered everything out, keep at least the non-Cars & Bids URLs
  return result.length > 0 ? result : (nonCarsAndBids.length > 0 ? nonCarsAndBids : urls);
};

export const isMismatchedVehicleImage = (value?: string | null, expectedId?: string | null): boolean => {
  const VEHICLE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const target = String(expectedId || '').toLowerCase();
  if (!value || !target) return false;
  const raw = String(value || '').trim();
  if (!raw) return false;
  const path = raw.includes('/vehicle-images/') ? raw.split('/vehicle-images/')[1] : raw;
  const clean = path.split('?')[0].replace(/^\/+/, '');
  const parts = clean.split('/').filter(Boolean);
  if (parts.length === 0) return false;
  let candidate: string | null = null;
  if (parts[0] === 'vehicles' && parts[1] && VEHICLE_ID_RE.test(parts[1])) candidate = parts[1];
  else if (VEHICLE_ID_RE.test(parts[0])) candidate = parts[0];
  return Boolean(candidate && candidate.toLowerCase() !== target);
};

export const filterProfileImages = (urls: string[], v: any, opts?: { skipMismatchCheck?: boolean }): string[] => {
  const normalized = (Array.isArray(urls) ? urls : []).map(normalizeUrl).filter(Boolean);
  // When images come from a DB query filtered by vehicle_id FK, the FK is the source of truth.
  // Skip the URL-path-based UUID mismatch check to avoid filtering images stored under a different
  // vehicle's directory (e.g. after reassignment/merge). Only apply for external/origin images.
  const withoutMismatched = opts?.skipMismatchCheck
    ? normalized
    : normalized.filter((u: string) => !isMismatchedVehicleImage(u, v?.id));
  // Exclude organization/dealer logos and import_queue images from profile display
  const withoutOrgLogos = withoutMismatched.filter((u: string) => {
    const urlLower = String(u || '').toLowerCase();
    // Exclude import_queue images (these are organization/dealer images)
    if (urlLower.includes('import_queue')) return false;
    // Exclude organization logo storage paths
    if (urlLower.includes('organization-logos/') || urlLower.includes('organization_logos/')) return false;
    // Exclude Classic.com dealer logos
    if (urlLower.includes('images.classic.com/uploads/dealer/')) return false;
    if (urlLower.includes('/uploads/dealer/')) return false;
    // Exclude any storage path that looks like a logo
    if (urlLower.includes('/logo') && (urlLower.includes('/storage/') || urlLower.includes('supabase.co'))) return false;
    return true;
  });
  return filterIconNoise(filterCarsAndBidsNoise(filterClassicNoise(filterBatNoise(withoutOrgLogos, v), v), v));
};

export const isSupabaseHostedImageUrl = (rawUrl: any): boolean => {
  const u = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!u) return false;
  return u.includes('/storage/v1/object/public/');
};

export const resolveDbImageUrl = (row: any, preferFullRes: boolean = false): string | null => {
  try {
    const variantsRaw = (row as any)?.variants;
    const variants = variantsRaw && typeof variantsRaw === 'object' ? variantsRaw : null;
    // For primary images, prioritize full resolution
    if (preferFullRes) {
      return (
        (variants as any)?.full ||
        (variants as any)?.large ||
        (row as any)?.image_url ||
        (variants as any)?.medium ||
        (row as any)?.medium_url ||
        (row as any)?.thumbnail_url ||
        null
      );
    }
    // For gallery display, use appropriate size
    return (
      (variants as any)?.large ||
      (variants as any)?.medium ||
      (variants as any)?.full ||
      (row as any)?.medium_url ||
      (row as any)?.thumbnail_url ||
      (row as any)?.image_url ||
      null
    );
  } catch {
    return (row as any)?.image_url || null;
  }
};

export const isOrganizationLogo = (url: string): boolean => {
  const urlLower = String(url || '').toLowerCase();
  // Organization logo storage paths
  if (urlLower.includes('organization-logos/') || urlLower.includes('organization_logos/')) return true;
  // Classic.com dealer logos
  if (urlLower.includes('images.classic.com/uploads/dealer/')) return true;
  if (urlLower.includes('/uploads/dealer/')) return true;
  // Storage paths containing "logo"
  if (urlLower.includes('/logo') && (urlLower.includes('/storage/') || urlLower.includes('supabase.co'))) return true;
  return false;
};

export const isImportedStoragePath = (p: any): boolean => {
  const s = String(p || '').toLowerCase();
  return s.includes('external_import') || s.includes('organization_import') || s.includes('import_queue');
};

/**
 * Score an image for "money shot" quality (hero image selection).
 *
 * DEPRECATED: This function uses legacy `ai_detected_angle` / `angle` strings
 * (e.g. "exterior_three_quarter", "exterior_front"). New code should use
 * `vehicle_zone` values (e.g. "ext_front_driver") from vehicle_images and
 * the ZONE_DISPLAY_PRIORITY constant from constants/vehicleZones.ts.
 *
 * The `vehicle_zone`-aware hero selection lives in loadVehicleData.ts
 * (selectHeroImage). This function is kept as a fallback for images that
 * have not yet been classified by YONO.
 */
export const scoreMoneyShot = (url: string, record?: any): number => {
  if (!url) return 0;
  let score = 50; // Base score
  const urlLower = url.toLowerCase();

  // Prefer earlier positions (first few images are usually best)
  if (record?.position !== null && record?.position !== undefined) {
    const pos = record.position;
    if (pos <= 2) score += 30; // First 3 images are usually money shots
    else if (pos <= 5) score += 15;
    else if (pos <= 10) score += 5;
  }

  // Prefer Supabase-hosted (more reliable than external CDNs)
  if (isSupabaseHostedImageUrl(url)) score += 10;

  // Prefer full-resolution images (not thumbnails/resized)
  if (!urlLower.includes('width=') && !urlLower.includes('height=') &&
      !urlLower.includes('thumb') && !urlLower.includes('80x80')) {
    score += 15;
  }

  // Boost for CarsAndBids full-res photos (usually good quality)
  if (urlLower.includes('media.carsandbids.com') &&
      urlLower.includes('/photos/') &&
      !urlLower.includes('/edit/') &&
      !urlLower.includes('width=')) {
    score += 20;
  }

  // DEPRECATED: migrate to vehicle_zone. Use ZONE_DISPLAY_PRIORITY from
  // constants/vehicleZones.ts for new code paths. This legacy angle-string
  // scoring is kept only for images without vehicle_zone populated.
  const zone = record?.vehicle_zone || '';
  if (zone) {
    // Prefer vehicle_zone when available (new system)
    // Import dynamically avoided here to keep this a pure util; scores match ZONE_DISPLAY_PRIORITY
    if (zone.startsWith('ext_front_driver') || zone.startsWith('ext_front_passenger')) score += 35;
    else if (zone.startsWith('ext_rear_driver') || zone.startsWith('ext_rear_passenger')) score += 30;
    else if (zone === 'ext_driver_side' || zone === 'ext_passenger_side') score += 28;
    else if (zone === 'ext_front') score += 22;
    else if (zone === 'ext_rear') score += 18;
    else if (zone.startsWith('int_')) score -= 30;
    else if (zone === 'mech_engine_bay') score -= 20;
    else if (zone.startsWith('detail_')) score -= 30;
    else if (zone === 'other') score -= 50;
  } else {
    // DEPRECATED: Legacy ai_detected_angle / angle string scoring
    const angle = record?.ai_detected_angle || record?.angle || '';
    if (angle) {
      if (angle.includes('three_quarter')) score += 35;
      else if (angle.includes('exterior_side')) score += 28;
      else if (angle.includes('exterior_front')) score += 22;
      else if (angle.includes('exterior_rear')) score += 18;
      else if (angle.includes('detail_shot')) score -= 30;
      else if (angle.includes('interior')) score -= 30;
      else if (angle.includes('under_hood') || angle.includes('engine')) score -= 20;
      else if (angle.includes('document') || angle.includes('sticker')) score -= 50;
    }
  }

  // Penalize interior/detail/document shots by URL keywords (fallback for non-AI-analyzed)
  if (urlLower.includes('interior') || urlLower.includes('inside') ||
      urlLower.includes('cabin') || urlLower.includes('dash') ||
      urlLower.includes('engine') || urlLower.includes('underhood') ||
      urlLower.includes('detail') || urlLower.includes('close') ||
      urlLower.includes('document') || urlLower.includes('spec') ||
      urlLower.includes('sticker') || urlLower.includes('monroney')) {
    score -= 30;
  }

  // Boost for exterior keywords (fallback for non-AI-analyzed)
  if (urlLower.includes('exterior') || urlLower.includes('side') ||
      urlLower.includes('front') || urlLower.includes('rear') ||
      urlLower.includes('profile') || urlLower.includes('full')) {
    score += 15;
  }

  // Penalize very small images
  if (urlLower.includes('80x80') || urlLower.includes('width=80')) {
    score -= 50;
  }

  return score;
};

export const getOriginImages = (v: any): { images: string[]; declaredCount: number | null } => {
  try {
    const originRaw: unknown =
      v?.origin_metadata?.images ??
      v?.origin_metadata?.image_urls ??
      v?.origin_metadata?.imageUrls ??
      null;

    const originCountRaw: unknown =
      v?.origin_metadata?.image_count ??
      v?.origin_metadata?.imageCount ??
      null;

    const declaredCount = typeof originCountRaw === 'number' && Number.isFinite(originCountRaw) ? originCountRaw : null;
    const originList = Array.isArray(originRaw) ? originRaw : [];

    // Normalize + basic cleanup; then apply our general filters.
    const cleaned = originList
      .map((u: any) => normalizeUrl(u))
      .filter((url: any) =>
        url &&
        typeof url === 'string' &&
        url.startsWith('http') &&
        !url.includes('94x63') &&
        !url.toLowerCase().includes('youtube.com') &&
        !url.toLowerCase().includes('thumbnail')
      );

    const filtered = filterProfileImages(cleaned, v);
    // NO LIMIT - show ALL images from source
    return { images: filtered, declaredCount };
  } catch {
    return { images: [], declaredCount: null };
  }
};

/** Check if a document URL looks wrong for use as primary vehicle image */
export const isValidForPrimary = (r: any, vehicle: any): boolean => {
  // Exclude documents (spec sheets, window stickers, etc.)
  if (r?.is_document === true) return false;
  // Exclude import_queue images from primary selection
  if (isImportedStoragePath(r?.storage_path)) return false;
  // Use full-resolution URL for primary images
  const url = resolveDbImageUrl(r, true) || r?.image_url;
  if (!url) return false;
  // Exclude organization/dealer logos
  if (isOrganizationLogo(url)) return false;
  // Exclude documents by URL patterns (window sticker, spec sheet, monroney, etc.)
  const urlLower = url.toLowerCase();
  if (urlLower.includes('window-sticker') || urlLower.includes('window_sticker') ||
      urlLower.includes('monroney') || urlLower.includes('spec-sheet') ||
      urlLower.includes('spec_sheet') || urlLower.includes('build-sheet') ||
      urlLower.includes('build_sheet') || urlLower.includes('spid') ||
      urlLower.includes('service-parts') || urlLower.includes('rpo') ||
      urlLower.includes('document') || urlLower.includes('sticker') ||
      urlLower.includes('sheet') || urlLower.includes('receipt') ||
      urlLower.includes('invoice') || urlLower.includes('title')) {
    return false;
  }
  return filterProfileImages([url], vehicle, { skipMismatchCheck: true }).length > 0;
};

/** Clean an image URL: remove resize params for ALL platforms */
export const cleanImageUrl = (url: string): string => {
  if (!url || typeof url !== 'string') return url;
  let cleaned = String(url || '')
    .replace(/&#038;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/[?&]w=\d+/g, '')
    .replace(/[?&]h=\d+/g, '')
    .replace(/[?&]width=\d+/g, '')
    .replace(/[?&]height=\d+/g, '')
    .replace(/[?&]resize=[^&]*/g, '')
    .replace(/[?&]fit=[^&]*/g, '')
    .replace(/[?&]quality=[^&]*/g, '')
    .replace(/[?&]strip=[^&]*/g, '')
    .replace(/[?&]format=[^&]*/g, '')
    .replace(/[?&]+$/, '');

  // Platform-specific cleaning
  if (cleaned.includes('bringatrailer.com')) {
    cleaned = cleaned
      .replace(/-scaled\.(jpg|jpeg|png|webp)$/i, '.$1')
      .replace(/-\d+x\d+\.(jpg|jpeg|png|webp)$/i, '.$1');
  } else if (cleaned.includes('carsandbids.com')) {
    cleaned = cleaned.split('?')[0];
  } else if (cleaned.includes('mecum.com')) {
    cleaned = cleaned.split('?')[0];
  } else if (cleaned.includes('barrett-jackson.com') || cleaned.includes('barrettjackson.com')) {
    cleaned = cleaned.split('?')[0].split('#')[0];
  }

  return cleaned.trim();
};
