import { normalizeMake, normalizeYear } from '../_shared/normalizeVehicle.ts';

// ─── Markdown parsing helpers ───────────────────────────────────────────────

function extractBetween(md: string, startMarker: string, endMarker: string): string {
  const startIdx = md.indexOf(startMarker);
  if (startIdx === -1) return '';
  const afterStart = startIdx + startMarker.length;
  const endIdx = endMarker ? md.indexOf(endMarker, afterStart) : md.length;
  return md.slice(afterStart, endIdx === -1 ? md.length : endIdx).trim();
}

function extractField(md: string, label: string): string | null {
  // Pattern: "Label\n\nValue" or "Label\nValue" in markdown
  const patterns = [
    new RegExp(`(?:^|\\n)${label}\\s*\\n\\n([^\\n]+)`, 'i'),
    new RegExp(`(?:^|\\n)${label}\\s*\\n([^\\n]+)`, 'i'),
    new RegExp(`${label}[:\\s]+([^\\n]+)`, 'i'),
  ];
  for (const p of patterns) {
    const m = md.match(p);
    if (m && m[1]?.trim()) return m[1].trim();
  }
  return null;
}

function parsePrice(text: string | null): number | null {
  if (!text) return null;
  const m = text.match(/[\$€£]?\s*([\d,]+(?:\.\d{2})?)/);
  if (!m) return null;
  const val = parseFloat(m[1].replace(/,/g, ''));
  return isNaN(val) || val < 100 ? null : val;
}

function parseMileage(text: string | null): { value: number; unit: string } | null {
  if (!text) return null;
  const m = text.match(/([\d,]+)\s*(mi|km|miles|kilometers)/i);
  if (!m) return null;
  const value = parseInt(m[1].replace(/,/g, ''));
  const unit = m[2].toLowerCase().startsWith('km') ? 'km' : 'mi';
  return { value: unit === 'km' ? Math.round(value * 0.621371) : value, unit };
}

function extractImages(md: string): string[] {
  const images: string[] = [];
  const imgPattern = /!\[.*?\]\((https:\/\/img\.jamesedition\.com\/[^)]+)\)/g;
  let match;
  while ((match = imgPattern.exec(md)) !== null) {
    // Get full-res version by removing size suffix
    let url = match[1];
    // Replace size suffixes like /je/507x312xc.jpg with /je/1100xxs.jpg for bigger images
    url = url.replace(/\/je\/\d+x\d+[a-z]*\./, '/je/1100xxs.');
    if (!images.includes(url)) images.push(url);
  }
  return images;
}

function extractVin(md: string): string | null {
  // Look for VIN field
  const vinField = extractField(md, 'VIN');
  if (vinField && /^[A-HJ-NPR-Z0-9]{17}$/i.test(vinField)) return vinField.toUpperCase();
  // Fallback: find 17-char VIN pattern in text
  const m = md.match(/\b([A-HJ-NPR-Z0-9]{17})\b/i);
  return m ? m[1].toUpperCase() : null;
}

// ─── Extract single listing ─────────────────────────────────────────────────

export interface JamesEditionListing {
  url: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  asking_price: number | null;
  mileage: number | null;
  exterior_color: string | null;
  interior_color: string | null;
  engine: string | null;
  transmission: string | null;
  drivetrain: string | null;
  body_style: string | null;
  condition: string | null;
  drive_side: string | null;
  location: string | null;
  description: string | null;
  seller_name: string | null;
  image_urls: string[];
  listing_id: string | null;
  identity_issues: string[];
}

export function parseListingMarkdown(md: string, url: string): JamesEditionListing {
  // JamesEdition also uses "# Make Model", with Year in Car Details.
  const titleMatch = md.split(/^##\s/m, 1)[0].match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1]?.trim() || null;

  // Price: "$XXX,XXX" near the top
  const priceMatch = md.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
  const asking_price = priceMatch ? parsePrice(priceMatch[0]) : null;

  const detailsSection = extractBetween(md, '## Car Details', '## ');
  const identity_issues: string[] = [];
  const titleYearMatch = title?.match(/^(\d{4})\s+/);
  const titleYear = titleYearMatch ? normalizeYear(titleYearMatch[1]) : null;
  const yearField = extractField(detailsSection, 'Year');
  const detailsYear = yearField && /^\d{4}$/.test(yearField) ? normalizeYear(yearField) : null;
  if (titleYearMatch && !titleYear) identity_issues.push('invalid_title_year');
  if (yearField && !detailsYear) identity_issues.push('invalid_details_year');
  const yearConflict = titleYear !== null && detailsYear !== null && titleYear !== detailsYear;
  if (yearConflict) identity_issues.push('title_year_conflicts_with_details');
  const year = yearConflict ? null : titleYear ?? detailsYear;

  // The route establishes the make boundary, but is never sufficient by itself:
  // the heading must name that make explicitly, followed by a separate model.
  // This also handles multiword makes without guessing from concatenated text.
  let make: string | null = null;
  let model: string | null = null;
  let sourceMake: string | null = null;
  try {
    const sourceUrl = new URL(url);
    const route = sourceUrl.pathname.match(/^\/cars\/([^/]+)\/[^/]+\/[^/]+-for-sale-\d+\/?$/);
    if (sourceUrl.protocol === 'https:' && ['jamesedition.com', 'www.jamesedition.com'].includes(sourceUrl.hostname) && route) {
      sourceMake = decodeURIComponent(route[1]).replace(/[-_]+/g, ' ');
    }
  } catch {
    // An invalid route cannot corroborate identity.
  }
  if (sourceMake && /^[a-z][a-z ]*$/i.test(sourceMake)) {
    const canonicalMake = normalizeMake(sourceMake);
    const heading = titleYearMatch ? title!.slice(titleYearMatch[0].length) : title;
    for (const alias of new Set(canonicalMake ? [sourceMake, canonicalMake] : [])) {
      const makePattern = alias.split(/[-\s]+/).map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[-\\s]+');
      const match = heading?.match(new RegExp(`^${makePattern}\\s+(.+)$`, 'i'));
      if (match) {
        make = canonicalMake;
        model = match[1].trim();
        break;
      }
    }
    if (title && !make) identity_issues.push('title_make_conflicts_with_source_category');
  }
  if (!year || !make || !model) identity_issues.push('incomplete_vehicle_identity');

  const mileageRaw = extractField(detailsSection || md, 'Mileage');
  const mileageData = parseMileage(mileageRaw);
  const mileage = mileageData?.value || null;

  const engine = extractField(detailsSection || md, 'Engine');
  const body_style = extractField(detailsSection || md, 'Car type');
  const drivetrain = extractField(detailsSection || md, 'Drive train');
  const drive_side = extractField(detailsSection || md, 'Drive');
  const condition = extractField(detailsSection || md, 'Condition');
  const exterior_color = extractField(detailsSection || md, 'Color');
  const interior_color = extractField(detailsSection || md, 'Interior color');
  const transmission = extractField(detailsSection || md, 'Transmission') || extractField(detailsSection || md, 'Gearbox');
  const vin = extractVin(detailsSection || md);

  // Location
  const locField = extractField(detailsSection || md, 'Location');
  const location = locField || extractField(md, 'Address');

  // Description: "## About This Car" section
  const description = extractBetween(md, '## About This Car', '## ') || null;

  // Seller — take first line only, strip markdown escapes
  const sellerMatch = md.match(/## For Sale by\s*\n\n\[([^\]]+)/);
  let seller_name = sellerMatch?.[1]?.split('\n')[0]?.replace(/\\+$/g, '').trim() || null;

  // Images
  const image_urls = extractImages(md);

  // Listing ID from URL
  const idMatch = url.match(/-(\d+)$/);
  const listing_id = idMatch?.[1] || null;

  return {
    url, title, year, make, model, vin, asking_price,
    mileage, exterior_color, interior_color, engine,
    transmission, drivetrain, body_style, condition,
    drive_side, location, description, seller_name,
    image_urls, listing_id, identity_issues,
  };
}

// ─── Discover listings from category page ───────────────────────────────────

export function parseListingUrls(md: string): string[] {
  const urls: string[] = [];
  const pattern = /\(https:\/\/www\.jamesedition\.com\/cars\/[^)]+for-sale-\d+[^)]*\)/g;
  let match;
  while ((match = pattern.exec(md)) !== null) {
    const url = match[0].slice(1, -1); // remove parens
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}
