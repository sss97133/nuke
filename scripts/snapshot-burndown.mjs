#!/usr/bin/env node
/**
 * SNAPSHOT BURNDOWN — Fast local extraction from archived HTML snapshots
 *
 * Bypasses the edge function bottleneck by:
 * 1. Bulk-fetching pending queue items + snapshot HTML in single SQL queries
 * 2. Parsing HTML locally with the same regex patterns
 * 3. Batch-updating vehicles via parameterized SQL
 *
 * Usage: dotenvx run -- node scripts/snapshot-burndown.mjs [platform] [batch_size] [max_batches]
 *   platform: mecum | barrett-jackson (default: mecum)
 *   batch_size: items per batch (default: 200)
 *   max_batches: how many batches to run (default: 999)
 */

import pg from 'pg';
const { Client } = pg;

const PLATFORM = process.argv[2] || 'mecum';
const BATCH_SIZE = parseInt(process.argv[3] || '200');
const MAX_BATCHES = parseInt(process.argv[4] || '999');
const CONCURRENCY = parseInt(process.argv[5] || '10'); // parallel storage downloads
const VERSION = 'snapshot-burndown:1.0.0';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ============================================================
// Database connection
// ============================================================

function getClient() {
  // Try DATABASE_URL first, fallback to constructing from individual vars
  let connectionString = process.env.DATABASE_URL;
  if (!connectionString || connectionString.includes('your-database') || connectionString === 'base') {
    const password = process.env.SUPABASE_DB_PASSWORD;
    const host = 'aws-0-us-west-1.pooler.supabase.com';
    const port = 6543;
    const user = 'postgres.qkgaybvrernstplzjaam';
    const db = 'postgres';
    connectionString = `postgresql://${user}:${password}@${host}:${port}/${db}`;
  }
  return new Client({
    connectionString,
    statement_timeout: 60000, // 60s per statement
  });
}

// ============================================================
// VIN validation
// ============================================================

function isValidVin(vin) {
  if (!vin || vin.length < 5 || vin.length > 17) return false;
  if (/^[0]+$/.test(vin)) return false;
  if (/^(test|none|na|n\/a|tbd|unknown)/i.test(vin)) return false;
  if (vin.length === 17 && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return false;
  if (vin.length < 17 && !/^[A-HJ-NPR-Z0-9*\- ]{5,17}$/i.test(vin)) return false;
  return true;
}

function cleanVin(raw) {
  const cleaned = raw.replace(/[\s\-–—]/g, '').replace(/[oO]/g, '0').trim();
  return isValidVin(cleaned) ? cleaned : null;
}

// ============================================================
// Utility functions
// ============================================================

function titleCase(str) {
  if (!str) return str;
  if (str === str.toUpperCase() && str.length > 3) {
    return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }
  return str;
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');
}

function extractYearMakeModel(title) {
  const MAKE_PATTERNS = [
    'Alfa Romeo', 'Aston Martin', 'Austin-Healey', 'De Tomaso', 'Land Rover', 'Mercedes-Benz',
    'Rolls-Royce', 'AC', 'Acura', 'Audi', 'Austin', 'BMW', 'Bentley', 'Buick', 'Cadillac',
    'Chevrolet', 'Chrysler', 'Citroën', 'Citroen', 'Datsun', 'DeLorean', 'Dodge', 'Ferrari', 'Fiat',
    'Ford', 'GMC', 'Honda', 'Hummer', 'Hyundai', 'Infiniti', 'International', 'Isuzu',
    'Jaguar', 'Jeep', 'Kia', 'Lamborghini', 'Lancia', 'Lexus', 'Lincoln', 'Lotus',
    'Maserati', 'Mazda', 'McLaren', 'Mercury', 'MG', 'Mini', 'Mitsubishi', 'Nissan',
    'Oldsmobile', 'Opel', 'Pagani', 'Peugeot', 'Plymouth', 'Pontiac', 'Porsche', 'RAM',
    'Renault', 'Rezvani', 'Rivian', 'Saab', 'Saturn', 'Shelby', 'Subaru', 'Suzuki', 'Tesla',
    'Toyota', 'Triumph', 'Volkswagen', 'Volvo', 'Willys',
  ];

  const result = {};
  const yearMatch = title.match(/\b(19\d{2}|20[0-2]\d)\b/);
  if (yearMatch) {
    result.year = parseInt(yearMatch[1]);
    const afterYear = title.slice(title.indexOf(yearMatch[1]) + yearMatch[1].length).trim();
    if (afterYear) {
      for (const make of MAKE_PATTERNS) {
        if (afterYear.toLowerCase().startsWith(make.toLowerCase())) {
          result.make = make;
          const rest = afterYear.slice(make.length).trim();
          if (rest) result.model = rest;
          break;
        }
      }
      if (!result.make) {
        const words = afterYear.split(/\s+/);
        if (words.length >= 2) {
          result.make = words[0];
          result.model = words.slice(1).join(' ');
        } else if (words.length === 1) {
          result.make = words[0];
        }
      }
    }
  }
  return result;
}

function normalizeBodyStyle(raw) {
  const bs = raw.trim().toLowerCase();
  const map = {
    coupe: 'Coupe', coupé: 'Coupe',
    convertible: 'Convertible', cabriolet: 'Convertible',
    roadster: 'Roadster',
    sedan: 'Sedan', saloon: 'Sedan',
    wagon: 'Wagon', estate: 'Wagon',
    hatchback: 'Hatchback',
    truck: 'Truck', pickup: 'Truck',
    suv: 'SUV',
    van: 'Van',
    targa: 'Targa',
    speedster: 'Speedster',
  };
  for (const [key, val] of Object.entries(map)) {
    if (bs.includes(key)) return val;
  }
  return null;
}

function normalizeDrivetrain(raw) {
  if (/\b(?:4x4|4wd|four.wheel.drive)\b/i.test(raw)) return '4WD';
  if (/\bawd\b|all.wheel.drive/i.test(raw)) return 'AWD';
  if (/\bfwd\b|front.wheel.drive/i.test(raw)) return 'FWD';
  if (/\brwd\b|rear.wheel.drive/i.test(raw)) return 'RWD';
  return null;
}

// ============================================================
// Download HTML from Supabase Storage
// ============================================================

async function downloadFromStorage(storagePath) {
  try {
    const url = `${SUPABASE_URL}/storage/v1/object/listing-snapshots/${storagePath}`;
    const resp = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    });
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

// Download multiple storage paths in parallel with concurrency limit
async function downloadBatch(storagePaths, concurrency = CONCURRENCY) {
  const results = new Map();
  const queue = [...storagePaths];
  let active = 0;

  return new Promise((resolve) => {
    function processNext() {
      if (queue.length === 0 && active === 0) {
        resolve(results);
        return;
      }

      while (active < concurrency && queue.length > 0) {
        const path = queue.shift();
        active++;
        downloadFromStorage(path).then(html => {
          if (html) results.set(path, html);
          active--;
          processNext();
        });
      }
    }
    processNext();
  });
}

// ============================================================
// Image extraction — extract ALL image URLs from HTML
// ============================================================

function extractAllImages(html, platform) {
  const images = new Set();

  // og:image
  const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (ogImage?.[1]) {
    const url = ogImage[1].replace(/&amp;/g, '&');
    if (url.startsWith('http') && !url.includes('logo') && !url.includes('favicon')) images.add(url);
  }

  if (platform === 'mecum') {
    // Mecum gallery images from __NEXT_DATA__
    const nextData = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (nextData?.[1]) {
      try {
        const nd = JSON.parse(nextData[1]);
        const pageProps = nd?.props?.pageProps;
        let lot = pageProps?.lot || pageProps?.post || null;
        if (!lot && pageProps?.dehydratedState?.queries) {
          for (const q of pageProps.dehydratedState.queries) {
            const data = q?.state?.data;
            if (data?.lot) { lot = data.lot; break; }
            if (data?.lotBy) { lot = data.lotBy; break; }
          }
        }
        if (lot) {
          // Gallery images
          const gallery = lot.gallery || lot.images || lot.galleryImages || lot.featuredImage || [];
          if (Array.isArray(gallery)) {
            for (const img of gallery) {
              const url = typeof img === 'string' ? img : (img?.sourceUrl || img?.url || img?.src || img?.full || img?.large || '');
              if (url && url.startsWith('http')) images.add(url);
            }
          }
          // Featured image
          if (lot.featuredImage && typeof lot.featuredImage === 'object') {
            const url = lot.featuredImage.sourceUrl || lot.featuredImage.url || lot.featuredImage.src || '';
            if (url && url.startsWith('http')) images.add(url);
          }
          if (typeof lot.featuredImage === 'string' && lot.featuredImage.startsWith('http')) {
            images.add(lot.featuredImage);
          }
        }
      } catch { /* ignore */ }
    }
    // Fallback: regex for mecum image URLs
    const mecumImgRe = /https?:\/\/(?:www\.)?mecum\.com\/[^"'\s<>]*?\.(?:jpg|jpeg|png|webp)/gi;
    let m;
    while ((m = mecumImgRe.exec(html)) !== null) {
      if (!m[0].includes('logo') && !m[0].includes('favicon') && !m[0].includes('icon')) {
        images.add(m[0]);
      }
    }
    // Also look for CDN image URLs common in Mecum pages
    const cdnRe = /https?:\/\/[^"'\s<>]*\.cloudfront\.net\/[^"'\s<>]*?\.(?:jpg|jpeg|png|webp)/gi;
    while ((m = cdnRe.exec(html)) !== null) {
      images.add(m[0]);
    }
  } else if (platform === 'barrett-jackson') {
    // BJ primary CDN: BarrettJacksonCDN.azureedge.net
    const bjCdnRe = /https?:\/\/BarrettJacksonCDN\.azureedge\.net\/[^"'\s<>\\]+\.(?:jpg|jpeg|png|webp)/gi;
    let m;
    while ((m = bjCdnRe.exec(html)) !== null) {
      const url = m[0].replace(/\\$/g, '');
      if (!url.includes('logo') && !url.includes('favicon') && !url.includes('icon')) {
        images.add(url);
      }
    }
    // BJ website images
    const bjImgRe = /https?:\/\/(?:www\.)?barrett-jackson\.com\/[^"'\s<>]*?\.(?:jpg|jpeg|png|webp)/gi;
    while ((m = bjImgRe.exec(html)) !== null) {
      if (!m[0].includes('logo') && !m[0].includes('favicon') && !m[0].includes('icon')) {
        images.add(m[0]);
      }
    }
    // Other CDN images
    const cdnPatterns = [
      /https?:\/\/[^"'\s<>]*cloudinary[^"'\s<>]*?\.(?:jpg|jpeg|png|webp)/gi,
      /https?:\/\/[^"'\s<>]*imgix[^"'\s<>]*?\.(?:jpg|jpeg|png|webp)/gi,
      /https?:\/\/[^"'\s<>]*\.cloudfront\.net\/[^"'\s<>]*?\.(?:jpg|jpeg|png|webp)/gi,
    ];
    for (const re of cdnPatterns) {
      while ((m = re.exec(html)) !== null) {
        if (!m[0].includes('logo') && !m[0].includes('favicon')) images.add(m[0]);
      }
    }
    // JSON image references
    const jsonImgRe = /"(?:image_url|photo_url|imageUrl|photoUrl|src|url)"\s*:\s*"(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
    while ((m = jsonImgRe.exec(html)) !== null) {
      if (!m[1].includes('logo') && !m[1].includes('favicon')) {
        images.add(m[1].replace(/\\\//g, '/'));
      }
    }
  }

  // Generic: any img src with photo/gallery/lot in the path
  const genericImgRe = /<img[^>]+src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/gi;
  let gm;
  while ((gm = genericImgRe.exec(html)) !== null) {
    const url = gm[1].replace(/&amp;/g, '&');
    if (!url.includes('logo') && !url.includes('favicon') && !url.includes('icon')
        && !url.includes('avatar') && !url.includes('sprite')
        && url.length < 500) {
      images.add(url);
    }
  }

  // Filter out sponsor/partner images (common BJ pattern)
  const filtered = [...images].filter(url => {
    const lower = url.toLowerCase();
    return !lower.includes('strapi-uploads') &&
           !lower.includes('sponsor') &&
           !lower.includes('partner') &&
           !lower.includes('heritage_partner') &&
           !lower.includes('adams_logo') &&
           !lower.includes('thumbnail_') &&
           !lower.includes('/uploads/') && // CMS uploads are sponsor stuff
           !lower.includes('marketing');
  });

  return filtered.length > 0 ? filtered : [...images]; // fallback to unfiltered if nothing passes
}

function extractPrimaryImage(html, platform) {
  const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (ogImage?.[1]) {
    const url = ogImage[1].replace(/&amp;/g, '&');
    if (url.startsWith('http') && !url.includes('logo') && !url.includes('favicon')) return url;
  }
  const ldMatch = html.match(/"image"\s*:\s*"(https?:\/\/[^"]+)"/);
  if (ldMatch?.[1]) {
    const url = ldMatch[1].replace(/\\\//g, '/');
    if (!url.includes('logo') && !url.includes('favicon')) return url;
  }
  return null;
}

// ============================================================
// Platform parsers (exact copy from edge function)
// ============================================================

function parseMecumHtml(html) {
  const result = {};

  const nextData = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nextData?.[1]) {
    try {
      const nd = JSON.parse(nextData[1]);
      const pageProps = nd?.props?.pageProps;
      let lot = pageProps?.lot || pageProps?.post || null;

      if (!lot && pageProps?.dehydratedState?.queries) {
        for (const q of pageProps.dehydratedState.queries) {
          const data = q?.state?.data;
          if (data?.lot) { lot = data.lot; break; }
          if (data?.lotBy) { lot = data.lotBy; break; }
        }
      }

      if (!lot) {
        const apolloMatch = html.match(/__APOLLO_STATE__\s*=\s*({[\s\S]*?});\s*<\/script>/i);
        if (apolloMatch?.[1]) {
          try {
            const apollo = JSON.parse(apolloMatch[1]);
            for (const [key, val] of Object.entries(apollo)) {
              if (key.startsWith('Lot:') && typeof val === 'object' && val !== null) {
                lot = val;
                break;
              }
            }
          } catch { /* ignore */ }
        }
      }

      if (lot) {
        const lotTitle = lot.title || lot.name || '';
        if (lotTitle) {
          const ymm = extractYearMakeModel(lotTitle);
          if (ymm.year) result.year = ymm.year;
          if (ymm.make) result.make = ymm.make;
          if (ymm.model) result.model = ymm.model;
        }

        const vinRaw = lot.vinSerial || lot.vin || lot.serialNumber || '';
        if (vinRaw) {
          const v = cleanVin(vinRaw);
          if (v) result.vin = v;
        }

        if (lot.transmission?.trim()) result.transmission = lot.transmission.trim();
        if (lot.color?.trim()) result.color = lot.color.trim();
        if (lot.interior?.trim()) result.interior_color = lot.interior.trim();
        if (lot.lotSeries?.trim()) result.engine_type = lot.lotSeries.trim();
        if (lot.engine?.trim() && !result.engine_type) result.engine_type = lot.engine.trim();

        const odo = lot.odometer || lot.mileage;
        if (odo) {
          const mi = parseInt(String(odo).replace(/[^0-9]/g, ''));
          if (mi > 0 && mi < 1_000_000) result.mileage = mi;
        }

        const hammer = lot.hammerPrice || lot.salePrice || lot.soldPrice;
        if (hammer) {
          const price = parseInt(String(hammer).replace(/[^0-9]/g, ''));
          if (price > 0) result.sale_price = price;
        }

        const content = lot.content || lot.description || lot.excerpt || '';
        if (content) {
          const desc = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          if (desc.length > 40) result.description = desc.slice(0, 2000);
        }

        if (result.description) {
          const hpMatch = result.description.match(/(\d{2,4})\s*(?:hp|bhp|horsepower)/i);
          if (hpMatch) result.horsepower = parseInt(hpMatch[1]);
        }

        const engText = result.engine_type || result.description || '';
        if (engText) {
          const dispMatch = engText.match(/([\d.]+)\s*-?\s*(?:liter|litre|l)\b/i);
          if (dispMatch) result.engine_displacement = `${dispMatch[1]}L`;
          const ciMatch = engText.match(/(\d{2,3})(?:ci|cubic[- ]?inch)/i);
          if (ciMatch && !result.engine_displacement) result.engine_displacement = `${ciMatch[1]}ci`;
          const ccMatch = engText.match(/(\d{3,5})\s*cc/i);
          if (ccMatch && !result.engine_displacement) result.engine_displacement = `${ccMatch[1]}cc`;
        }

        if (result.description) {
          const dt = normalizeDrivetrain(result.description);
          if (dt) result.drivetrain = dt;
        }

        const titleAndDesc = `${lotTitle} ${result.description || ''}`;
        const bs = normalizeBodyStyle(titleAndDesc);
        if (bs) result.body_style = bs;
      }
    } catch (e) {
      // JSON parse error, fall through to regex
    }
  }

  // Fallback: title tag
  if (!result.year) {
    const ogTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (ogTitle?.[1]) {
      const cleaned = ogTitle[1].replace(/\s*\|.*$/, '').trim();
      const ymm = extractYearMakeModel(cleaned);
      if (ymm.year) result.year = ymm.year;
      if (ymm.make) result.make = ymm.make;
      if (ymm.model) result.model = ymm.model;
    }
  }

  if (!result.vin) {
    const vinMatch = html.match(/\bVIN\s*[:;]?\s*([A-HJ-NPR-Z0-9]{11,17})\b/i);
    if (vinMatch?.[1]) {
      const v = cleanVin(vinMatch[1]);
      if (v) result.vin = v;
    }
  }

  if (!result.sale_price) {
    const hpMatch = html.match(/"hammerPrice"\s*:\s*"(\d+)"/);
    if (hpMatch?.[1]) {
      const price = parseInt(hpMatch[1]);
      if (price > 0) result.sale_price = price;
    }
  }

  return result;
}

function parseBarrettJacksonHtml(html) {
  const result = {};

  // Strategy 1: RSC data
  const vinChunkMatch = html.match(/"year"\s*:\s*"(\d{4})"\s*,\s*"make"\s*:\s*"([^"]+)"\s*,\s*"model"\s*:\s*"([^"]+)"\s*,\s*"style"\s*:\s*"([^"]*)"/);
  if (vinChunkMatch) {
    result.year = parseInt(vinChunkMatch[1]);
    result.make = titleCase(vinChunkMatch[2]);
    result.model = titleCase(vinChunkMatch[3]);
    const style = vinChunkMatch[4];
    if (style) {
      result.trim = titleCase(style);
      const bs = normalizeBodyStyle(style);
      if (bs) result.body_style = bs;
    }
  }

  // Strategy 2: H1 tag
  if (!result.year || !result.make) {
    const h1Match = html.match(/<h1[^>]*class=["'][^"']*font-black[^"']*["'][^>]*>([^<]+)<\/h1>/i);
    if (h1Match?.[1]) {
      const ymm = extractYearMakeModel(h1Match[1].trim());
      if (!result.year && ymm.year) result.year = ymm.year;
      if (!result.make && ymm.make) result.make = titleCase(ymm.make);
      if (!result.model && ymm.model) result.model = titleCase(ymm.model);
    }
  }

  // Strategy 3: Title tag
  if (!result.year || !result.make) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch?.[1]) {
      const cleaned = titleMatch[1].replace(/\s*-\s*Vehicle\s*\|.*$/i, '').trim();
      const ymm = extractYearMakeModel(cleaned);
      if (!result.year && ymm.year) result.year = ymm.year;
      if (!result.make && ymm.make) result.make = titleCase(ymm.make);
      if (!result.model && ymm.model) result.model = titleCase(ymm.model);
    }
  }

  // VIN
  const vinMatch = html.match(/"vin"\s*:\s*"([A-HJ-NPR-Z0-9]{11,17})"/i);
  if (vinMatch?.[1]) {
    const v = cleanVin(vinMatch[1]);
    if (v) result.vin = v;
  }

  // Colors
  const extColorMatch = html.match(/"exterior_color"\s*:\s*"([^"]+)"/);
  if (extColorMatch?.[1]) result.color = titleCase(extColorMatch[1]);

  const intColorMatch = html.match(/"interior_color"\s*:\s*"([^"]+)"/);
  if (intColorMatch?.[1]) result.interior_color = titleCase(intColorMatch[1]);

  // Engine
  const engineMatch = html.match(/"engine_size"\s*:\s*"([^"]+)"/);
  if (engineMatch?.[1]) {
    result.engine_type = engineMatch[1];
    const dispMatch = engineMatch[1].match(/([\d.]+)\s*-?\s*(?:liter|litre|l)\b/i);
    if (dispMatch) result.engine_displacement = `${dispMatch[1]}L`;
  }

  const cylMatch = html.match(/"number_of_cylinders"\s*:\s*"(\d+)"/);
  if (cylMatch?.[1]) {
    const cyl = parseInt(cylMatch[1]);
    if (result.engine_type) {
      result.engine_type = `${result.engine_type} ${cyl}-cylinder`;
    } else {
      result.engine_type = `${cyl}-cylinder`;
    }
  }

  // Transmission
  const transMatch = html.match(/"transmission_type_name"\s*:\s*"([^"]+)"/);
  if (transMatch?.[1]) result.transmission = titleCase(transMatch[1]);

  // Sale price
  const hammerMatch = html.match(/"hammerPrice"\s*:\s*"?(\d+)"?/);
  if (hammerMatch?.[1]) {
    const price = parseInt(hammerMatch[1]);
    if (price > 0) result.sale_price = price;
  }
  if (!result.sale_price) {
    const hp2 = html.match(/"hammer_price"\s*:\s*"?(\d+)"?/);
    if (hp2?.[1]) {
      const price = parseInt(hp2[1]);
      if (price > 0) result.sale_price = price;
    }
  }

  // Description
  if (!result.description) {
    const ogDesc = html.match(/<meta[^>]*(?:property=["']og:description["']|name=["']description["'])[^>]*content=["']([^"']{40,})["']/i);
    if (ogDesc?.[1]) {
      result.description = decodeHtmlEntities(ogDesc[1]).slice(0, 2000);
    }
  }

  // Fallback: og:title
  if (!result.year || !result.make) {
    const ogTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i) ||
      html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
    if (ogTitle?.[1]) {
      const cleaned = ogTitle[1].replace(/\s*[-|–].*$/, '').trim();
      const ymm = extractYearMakeModel(cleaned);
      if (!result.year && ymm.year) result.year = ymm.year;
      if (!result.make && ymm.make) result.make = ymm.make;
      if (!result.model && ymm.model) result.model = ymm.model;
    }
  }

  // Mileage from description
  if (!result.mileage && result.description) {
    const miMatch = result.description.match(/([\d,]+)\s*(?:actual\s+)?miles?\b/i);
    if (miMatch) {
      const mi = parseInt(miMatch[1].replace(/,/g, ''));
      if (mi > 0 && mi < 1_000_000) result.mileage = mi;
    }
  }

  // Drivetrain from description
  if (!result.drivetrain && result.description) {
    const dt = normalizeDrivetrain(result.description);
    if (dt) result.drivetrain = dt;
  }

  return result;
}

// ============================================================
// Main processing loop
// ============================================================

async function main() {
  const startTime = Date.now();
  let totalExtracted = 0;
  let totalSkipped = 0;
  let totalNoSnapshot = 0;
  let totalErrors = 0;
  let totalFieldsFilled = 0;
  let totalImagesInserted = 0;
  let batchNum = 0;

  console.log(`\n=== SNAPSHOT BURNDOWN ===`);
  console.log(`Platform: ${PLATFORM}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Max batches: ${MAX_BATCHES}`);
  console.log(`Version: ${VERSION}\n`);

  for (batchNum = 1; batchNum <= MAX_BATCHES; batchNum++) {
    const batchStart = Date.now();
    const client = getClient();

    try {
      await client.connect();

      // ============================================================
      // Step 1: Claim a batch of pending queue items
      // Use separate queries to avoid pgBouncer CTE issues
      // ============================================================

      // First, find pending items
      const pendingResult = await client.query(`
        SELECT vehicle_id, snapshot_url
        FROM snapshot_extraction_queue
        WHERE platform = $1 AND status = 'pending'
        ORDER BY created_at
        LIMIT $2
      `, [PLATFORM, BATCH_SIZE]);

      if (pendingResult.rows.length === 0) {
        console.log(`\nBatch ${batchNum}: No more pending items. Done!`);
        await client.end();
        break;
      }

      const pendingIds = pendingResult.rows.map(r => r.vehicle_id);
      const snapshotUrlMap = new Map(pendingResult.rows.map(r => [r.vehicle_id, r.snapshot_url]));

      // Claim them
      const idPlaceholders = pendingIds.map((_, i) => `$${i + 1}`).join(',');
      await client.query(
        `UPDATE snapshot_extraction_queue SET status = 'processing', claimed_at = NOW() WHERE vehicle_id IN (${idPlaceholders})`,
        pendingIds
      );

      // Fetch vehicle data
      const vehicleResult = await client.query(
        `SELECT id, year, make, model, trim, vin, mileage, horsepower, torque,
                engine_type, engine_displacement, transmission, drivetrain,
                body_style, color, color_primary, interior_color,
                description, sale_price, primary_image_url, extractor_version
         FROM vehicles WHERE id IN (${idPlaceholders})`,
        pendingIds
      );
      const vehicleMap = new Map(vehicleResult.rows.map(r => [r.id, r]));

      // Fetch snapshot metadata - batch by snapshot_url
      const uniqueUrls = [...new Set(pendingResult.rows.map(r => r.snapshot_url))];
      const urlPlaceholders = uniqueUrls.map((_, i) => `$${i + 2}`).join(',');
      const snapshotResult = await client.query(
        `SELECT listing_url, html, html_storage_path
         FROM listing_page_snapshots
         WHERE listing_url IN (${urlPlaceholders})
           AND platform = $1
           AND success = true`,
        [PLATFORM, ...uniqueUrls]
      );

      // Download HTML from storage for those that need it
      const storagePaths = snapshotResult.rows
        .filter(r => (!r.html || r.html.length < 500) && r.html_storage_path)
        .map(r => r.html_storage_path);

      let storageHtmlMap = new Map();
      if (storagePaths.length > 0) {
        storageHtmlMap = await downloadBatch(storagePaths, CONCURRENCY);
      }

      // Build snapshot map: listing_url -> html content
      const snapshotMap = new Map();
      for (const r of snapshotResult.rows) {
        let html = r.html;
        if (!html || html.length < 500) {
          if (r.html_storage_path) {
            html = storageHtmlMap.get(r.html_storage_path) || null;
          }
        }
        snapshotMap.set(r.listing_url, { ...r, html });
      }

      // Combine into rows
      const rows = pendingIds.map(vid => {
        const vehicle = vehicleMap.get(vid) || {};
        const snapUrl = snapshotUrlMap.get(vid);
        const snap = snapUrl ? snapshotMap.get(snapUrl) : null;
        return {
          vehicle_id: vid,
          snapshot_url: snapUrl,
          ...vehicle,
          html: snap?.html || null,
          html_storage_path: snap?.html_storage_path || null,
        };
      }).filter(r => r.id || r.vehicle_id); // skip if vehicle not found

      // rows is now ready to process

      let batchExtracted = 0;
      let batchSkipped = 0;
      let batchNoSnapshot = 0;
      let batchErrors = 0;
      let batchFields = 0;
      let batchImages = 0;

      // Collect all updates for batch execution
      const vehicleUpdates = [];
      const imageInserts = [];
      const queueCompleted = [];
      const queueFailed = [];

      for (const row of rows) {
        try {
          const html = row.html;

          if (!html || html.length < 500) {
            batchNoSnapshot++;
            queueFailed.push(row.vehicle_id);
            continue;
          }

          // Parse HTML based on platform
          let parsed;
          if (PLATFORM === 'mecum') {
            parsed = parseMecumHtml(html);
          } else if (PLATFORM === 'barrett-jackson') {
            parsed = parseBarrettJacksonHtml(html);
          } else {
            parsed = {};
          }

          // Extract primary image
          if (!parsed.primary_image_url) {
            const img = extractPrimaryImage(html, PLATFORM);
            if (img) parsed.primary_image_url = img;
          }

          // Extract ALL images for vehicle_images
          const allImages = extractAllImages(html, PLATFORM);

          // Build update payload — only fill missing fields
          const updatePayload = {};
          const fieldsUpdated = [];

          const fieldMap = {
            year: 'year', make: 'make', model: 'model', trim: 'trim',
            vin: 'vin', mileage: 'mileage', horsepower: 'horsepower', torque: 'torque',
            engine_type: 'engine_type', engine_displacement: 'engine_displacement',
            transmission: 'transmission', drivetrain: 'drivetrain',
            body_style: 'body_style', color: 'color', color_primary: 'color_primary',
            interior_color: 'interior_color', description: 'description',
            sale_price: 'sale_price', primary_image_url: 'primary_image_url',
          };

          for (const [parsedKey, dbField] of Object.entries(fieldMap)) {
            const newVal = parsed[parsedKey];
            if (newVal === null || newVal === undefined) continue;
            if (typeof newVal === 'string' && newVal.trim() === '') continue;

            const existing = row[dbField];
            const existingEmpty = existing === null || existing === undefined || String(existing).trim() === '';

            if (existingEmpty) {
              updatePayload[dbField] = newVal;
              fieldsUpdated.push(dbField);
            }
          }

          if (fieldsUpdated.length === 0 && allImages.length === 0) {
            batchSkipped++;
            queueCompleted.push({ id: row.vehicle_id, fields: 0 });
            continue;
          }

          // Queue vehicle update
          if (fieldsUpdated.length > 0) {
            vehicleUpdates.push({
              id: row.vehicle_id,
              payload: updatePayload,
              fields: fieldsUpdated,
            });
            batchFields += fieldsUpdated.length;
          }

          // Queue image inserts
          if (allImages.length > 0) {
            for (const imgUrl of allImages) {
              imageInserts.push({
                vehicle_id: row.vehicle_id,
                url: imgUrl,
              });
            }
            batchImages += allImages.length;
          }

          batchExtracted++;
          queueCompleted.push({ id: row.vehicle_id, fields: fieldsUpdated.length });
        } catch (e) {
          batchErrors++;
          queueFailed.push(row.vehicle_id);
        }
      }

      // ============================================================
      // Step 2: Batch-execute all updates
      // ============================================================

      // Update vehicles one at a time (each has different fields)
      for (const upd of vehicleUpdates) {
        const setClauses = Object.entries(upd.payload)
          .map(([k], i) => `${k} = $${i + 2}`)
          .join(', ');
        const values = [upd.id, ...Object.values(upd.payload)];

        try {
          await client.query(
            `UPDATE vehicles SET ${setClauses}, extractor_version = '${VERSION}', updated_at = NOW() WHERE id = $1`,
            values
          );
        } catch (e) {
          // If VIN constraint fails, retry without VIN
          if (e.message?.includes('unique') && upd.payload.vin) {
            delete upd.payload.vin;
            const retrySet = Object.entries(upd.payload)
              .map(([k], i) => `${k} = $${i + 2}`)
              .join(', ');
            if (retrySet) {
              const retryValues = [upd.id, ...Object.values(upd.payload)];
              try {
                await client.query(
                  `UPDATE vehicles SET ${retrySet}, extractor_version = '${VERSION}', updated_at = NOW() WHERE id = $1`,
                  retryValues
                );
              } catch { batchErrors++; }
            }
          } else {
            batchErrors++;
          }
        }
      }

      // Mark skipped vehicles (no fields to update) with extractor_version
      const skipIds = queueCompleted.filter(q => q.fields === 0).map(q => q.id);
      if (skipIds.length > 0) {
        // Batch update in groups of 100
        for (let i = 0; i < skipIds.length; i += 100) {
          const chunk = skipIds.slice(i, i + 100);
          const placeholders = chunk.map((_, idx) => `$${idx + 1}`).join(',');
          await client.query(
            `UPDATE vehicles SET extractor_version = '${VERSION}', updated_at = NOW() WHERE id IN (${placeholders})`,
            chunk
          );
        }
      }

      // Insert images (batch with ON CONFLICT DO NOTHING)
      if (imageInserts.length > 0) {
        // Batch insert in groups of 50
        for (let i = 0; i < imageInserts.length; i += 50) {
          const chunk = imageInserts.slice(i, i + 50);
          const values = [];
          const placeholders = chunk.map((img, idx) => {
            values.push(img.vehicle_id, img.url);
            return `($${idx * 2 + 1}, $${idx * 2 + 2})`;
          }).join(',');

          try {
            await client.query(
              `INSERT INTO vehicle_images (vehicle_id, url) VALUES ${placeholders} ON CONFLICT DO NOTHING`,
              values
            );
          } catch (e) {
            // Images are best-effort
          }
        }
      }

      // Update queue status
      const completedIds = queueCompleted.map(q => q.id);
      if (completedIds.length > 0) {
        const placeholders = completedIds.map((_, idx) => `$${idx + 1}`).join(',');
        await client.query(
          `UPDATE snapshot_extraction_queue SET status = 'completed', completed_at = NOW() WHERE vehicle_id IN (${placeholders})`,
          completedIds
        );
      }
      if (queueFailed.length > 0) {
        const placeholders = queueFailed.map((_, idx) => `$${idx + 1}`).join(',');
        await client.query(
          `UPDATE snapshot_extraction_queue SET status = 'failed', completed_at = NOW() WHERE vehicle_id IN (${placeholders})`,
          queueFailed
        );
      }

      await client.end();

      totalExtracted += batchExtracted;
      totalSkipped += batchSkipped;
      totalNoSnapshot += batchNoSnapshot;
      totalErrors += batchErrors;
      totalFieldsFilled += batchFields;
      totalImagesInserted += batchImages;

      const batchDuration = ((Date.now() - batchStart) / 1000).toFixed(1);
      const totalDuration = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = (totalExtracted / ((Date.now() - startTime) / 1000) * 3600).toFixed(0);

      console.log(
        `Batch ${batchNum}: ${rows.length} claimed | ${batchExtracted} extracted | ${batchSkipped} skipped | ${batchNoSnapshot} no-snap | ${batchErrors} err | ${batchFields} fields | ${batchImages} imgs | ${batchDuration}s | Total: ${totalExtracted} @ ${rate}/hr | ${totalDuration}s elapsed`
      );

    } catch (e) {
      console.error(`Batch ${batchNum} FATAL: ${e.message}`);
      try { await client.end(); } catch {}
      // Brief pause before retry
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(0);
  const rate = totalExtracted > 0 ? (totalExtracted / ((Date.now() - startTime) / 1000) * 3600).toFixed(0) : 0;

  console.log(`\n=== BURNDOWN COMPLETE ===`);
  console.log(`Batches: ${batchNum - 1}`);
  console.log(`Extracted: ${totalExtracted}`);
  console.log(`Skipped: ${totalSkipped}`);
  console.log(`No snapshot: ${totalNoSnapshot}`);
  console.log(`Errors: ${totalErrors}`);
  console.log(`Fields filled: ${totalFieldsFilled}`);
  console.log(`Images inserted: ${totalImagesInserted}`);
  console.log(`Duration: ${totalDuration}s`);
  console.log(`Rate: ${rate}/hr\n`);
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
