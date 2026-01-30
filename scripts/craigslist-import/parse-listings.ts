#!/usr/bin/env npx tsx
/**
 * Parse Listings
 * Extracts structured vehicle data from HTML/webarchive files
 * Updates the local inventory database with parsed data
 */

import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import * as cheerio from 'cheerio';
import { execSync } from 'child_process';

const DB_PATH = '/Users/skylar/nuke/data/archive-inventory.db';
const db = new Database(DB_PATH);

// Add missing columns if they don't exist
try {
  db.exec(`ALTER TABLE listings ADD COLUMN attributes TEXT`);
} catch (e) { /* column exists */ }

try {
  db.exec(`ALTER TABLE listings ADD COLUMN image_count INTEGER DEFAULT 0`);
} catch (e) { /* column exists */ }

console.log('='.repeat(60));
console.log('Listing Parser');
console.log('='.repeat(60));

// Get all listing files
const listingFiles = db.prepare(`
  SELECT id, path, extension FROM files
  WHERE category = 'listing'
  ORDER BY path
`).all() as { id: number; path: string; extension: string }[];

console.log(`Found ${listingFiles.length} listing files to parse`);
console.log('');

// Prepared statements
const insertListing = db.prepare(`
  INSERT OR REPLACE INTO listings
  (file_id, source_site, post_id, original_url, title, year, make, model, price,
   location, description, vin, odometer, post_date, phone_raw, phone_normalized,
   parse_status, data_quality_score, attributes, image_count)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateFileAssociation = db.prepare(`
  UPDATE files SET associated_listing_id = ? WHERE id = ?
`);

// Stats
const stats = {
  parsed: 0,
  failed: 0,
  craigslist: 0,
  ksl: 0,
  other: 0,
  withPhone: 0,
  withVin: 0,
  withPrice: 0,
  withYear: 0,
};

// Word to digit mapping for obfuscated phones
const WORD_TO_DIGIT: Record<string, string> = {
  'zero': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4',
  'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9',
  'oh': '0', 'o': '0',
};

function extractPhone(text: string): { raw: string; normalized: string } | null {
  if (!text) return null;

  // Replace word numbers
  let processed = text.toLowerCase();
  for (const [word, digit] of Object.entries(WORD_TO_DIGIT)) {
    processed = processed.replace(new RegExp(`\\b${word}\\b`, 'gi'), digit);
  }

  // Standard phone patterns
  const patterns = [
    /\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/,
    /(\d{3})[-.\s](\d{3})[-.\s](\d{4})/,
    /(\d{10})/,
  ];

  for (const pattern of patterns) {
    const match = processed.match(pattern);
    if (match) {
      const digits = match[0].replace(/\D/g, '');
      if (digits.length === 10) {
        return {
          raw: match[0],
          normalized: `+1${digits}`,
        };
      }
    }
  }

  return null;
}

function parseYear(text: string): number | null {
  const match = text.match(/\b(19[0-9]{2}|20[0-2][0-9])\b/);
  return match ? parseInt(match[1]) : null;
}

function parsePrice(text: string): number | null {
  const match = text.match(/\$\s*([\d,]+)/);
  if (match) {
    return parseInt(match[1].replace(/,/g, ''));
  }
  return null;
}

function detectSourceSite(html: string, url: string | null): string {
  if (url?.includes('craigslist.org') || html.includes('craigslist')) {
    return 'craigslist';
  }
  if (url?.includes('ksl.com') || html.includes('ksl.com')) {
    return 'ksl';
  }
  return 'unknown';
}

function calculateQualityScore(listing: any): number {
  let score = 0;
  if (listing.title) score += 15;
  if (listing.year) score += 20;
  if (listing.make) score += 15;
  if (listing.model) score += 15;
  if (listing.price) score += 10;
  if (listing.description?.length > 100) score += 10;
  if (listing.vin) score += 10;
  if (listing.phone) score += 5;
  return score;
}

function parseCraigslistHtml(html: string, filePath: string): any {
  const $ = cheerio.load(html);

  // Extract original URL from comment
  const urlMatch = html.match(/saved from url=\((\d+)\)(.+?)-->/);
  const originalUrl = urlMatch ? urlMatch[2].trim() : null;

  // Extract post ID from URL or data attributes
  let postId = originalUrl?.match(/\/(\d{8,12})\.html/)?.[1];
  if (!postId) {
    postId = $('[data-pid]').attr('data-pid') || path.basename(filePath, path.extname(filePath));
  }

  // Title
  const title = $('#titletextonly').text().trim() ||
    $('title').text().replace(/ - craigslist.*$/i, '').trim() ||
    $('h1').first().text().trim();

  // Price
  const priceText = $('.price').first().text();
  const price = parsePrice(priceText);

  // Location
  const location = $('small').first().text().replace(/[()]/g, '').trim() ||
    $('.postingtitletext small').text().trim();

  // Description
  const description = $('#postingbody').text()
    .replace(/QR Code Link to This Post/gi, '')
    .trim();

  // Posted date
  const timeEl = $('time.timeago, time.date');
  const postDate = timeEl.attr('datetime') || null;

  // Attributes
  const attributes: Record<string, string> = {};
  $('.attrgroup span').each((_, el) => {
    const text = $(el).text();
    const boldVal = $(el).find('b').text();
    if (boldVal) {
      const label = text.replace(boldVal, '').replace(':', '').trim();
      attributes[label.toLowerCase()] = boldVal;
    } else {
      // Standalone attribute
      attributes[text.toLowerCase()] = 'yes';
    }
  });

  // Extract vehicle details from title and attributes
  const year = parseYear(title) || parseYear(JSON.stringify(attributes));
  const vin = attributes['vin']?.toUpperCase() || description.match(/\b[A-HJ-NPR-Z0-9]{17}\b/)?.[0];
  const odometer = attributes['odometer'] ? parseInt(attributes['odometer'].replace(/\D/g, '')) : null;

  // Try to parse make/model from title
  let make: string | null = null;
  let model: string | null = null;

  const makes = ['ford', 'chevy', 'chevrolet', 'dodge', 'plymouth', 'pontiac', 'buick', 'oldsmobile', 'cadillac', 'lincoln', 'mercury', 'amc', 'jeep', 'willys', 'studebaker', 'packard', 'hudson', 'nash', 'desoto', 'chrysler', 'porsche', 'vw', 'volkswagen', 'volvo', 'bmw', 'mercedes', 'datsun', 'nissan', 'toyota', 'honda', 'mazda', 'subaru', 'mitsubishi', 'gmc', 'international'];

  const titleLower = title.toLowerCase();
  for (const m of makes) {
    if (titleLower.includes(m)) {
      make = m.charAt(0).toUpperCase() + m.slice(1);
      if (make === 'Chevy') make = 'Chevrolet';
      break;
    }
  }

  // Common models
  const models = ['mustang', 'camaro', 'corvette', 'charger', 'challenger', 'cuda', 'barracuda', 'roadrunner', 'road runner', 'gto', 'firebird', 'trans am', 'chevelle', 'nova', 'impala', 'bel air', 'c10', 'f100', 'f-100', '911', '912', '356', 'beetle', 'bus'];

  for (const m of models) {
    if (titleLower.includes(m)) {
      model = m.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      break;
    }
  }

  // Count images
  let imageCount = 0;
  const imgListMatch = html.match(/var imgList = \[([^\]]+)\]/);
  if (imgListMatch) {
    imageCount = (imgListMatch[1].match(/url/g) || []).length;
  } else {
    imageCount = $('img[src*="images.craigslist"]').length || $('.thumb').length;
  }

  // Extract phone from description
  const phone = extractPhone(description);

  return {
    postId,
    originalUrl,
    title,
    year,
    make,
    model,
    price,
    location,
    description: description.substring(0, 5000),
    vin,
    odometer,
    postDate,
    phone,
    attributes: JSON.stringify(attributes),
    imageCount,
  };
}

function parseWebarchive(filePath: string): string | null {
  try {
    // Try using plutil to convert to JSON
    const tmpFile = `/tmp/webarchive-${Date.now()}.json`;
    try {
      execSync(`plutil -convert json -o "${tmpFile}" "${filePath}" 2>/dev/null`);
      const data = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
      fs.unlinkSync(tmpFile);

      // Extract main HTML content
      const mainResource = data.WebMainResource;
      if (mainResource?.WebResourceData) {
        // WebResourceData might be base64 encoded or raw
        const resourceData = mainResource.WebResourceData;
        if (typeof resourceData === 'string') {
          return Buffer.from(resourceData, 'base64').toString('utf-8');
        }
      }
    } catch (e) {
      // plutil failed, try binary parsing
      const buffer = fs.readFileSync(filePath);
      // Look for HTML content in the binary
      const htmlStart = buffer.indexOf('<html');
      const htmlEnd = buffer.lastIndexOf('</html>');
      if (htmlStart !== -1 && htmlEnd !== -1) {
        return buffer.slice(htmlStart, htmlEnd + 7).toString('utf-8');
      }
    }
  } catch (e) {
    console.error(`Failed to parse webarchive: ${filePath}`);
  }
  return null;
}

function parseKslHtml(html: string, filePath: string): any {
  const $ = cheerio.load(html);

  const title = $('h1').first().text().trim() || $('title').text().trim();
  const price = parsePrice($('.price, .listing-price').text());
  const description = $('.description, .listing-description').text().trim();
  const year = parseYear(title);

  return {
    postId: path.basename(filePath, path.extname(filePath)),
    originalUrl: null,
    title,
    year,
    make: null,
    model: null,
    price,
    location: $('.location').text().trim(),
    description,
    vin: null,
    odometer: null,
    postDate: null,
    phone: extractPhone(description),
    attributes: '{}',
    imageCount: $('img').length,
  };
}

// Process each listing
db.exec('BEGIN TRANSACTION');

for (let i = 0; i < listingFiles.length; i++) {
  const file = listingFiles[i];

  try {
    let html: string | null = null;

    if (file.extension === '.webarchive') {
      html = parseWebarchive(file.path);
    } else {
      html = fs.readFileSync(file.path, 'utf-8');
    }

    if (!html) {
      stats.failed++;
      continue;
    }

    const sourceSite = detectSourceSite(html, null);
    let listing: any;

    if (sourceSite === 'ksl') {
      listing = parseKslHtml(html, file.path);
      stats.ksl++;
    } else {
      listing = parseCraigslistHtml(html, file.path);
      if (sourceSite === 'craigslist') stats.craigslist++;
      else stats.other++;
    }

    const qualityScore = calculateQualityScore(listing);

    // Track stats
    if (listing.phone) stats.withPhone++;
    if (listing.vin) stats.withVin++;
    if (listing.price) stats.withPrice++;
    if (listing.year) stats.withYear++;

    // Insert listing
    const result = insertListing.run(
      file.id,
      sourceSite,
      listing.postId,
      listing.originalUrl,
      listing.title,
      listing.year,
      listing.make,
      listing.model,
      listing.price,
      listing.location,
      listing.description,
      listing.vin,
      listing.odometer,
      listing.postDate,
      listing.phone?.raw,
      listing.phone?.normalized,
      'parsed',
      qualityScore,
      listing.attributes,
      listing.imageCount
    );

    // Update file association
    updateFileAssociation.run(result.lastInsertRowid, file.id);

    stats.parsed++;

    // Progress
    if ((i + 1) % 100 === 0) {
      console.log(`  Parsed ${i + 1}/${listingFiles.length}...`);
    }
  } catch (e) {
    console.error(`Error parsing ${file.path}:`, e);
    stats.failed++;
  }
}

db.exec('COMMIT');

console.log('');
console.log('='.repeat(60));
console.log('PARSING SUMMARY');
console.log('='.repeat(60));
console.log(`Parsed:       ${stats.parsed}`);
console.log(`Failed:       ${stats.failed}`);
console.log('');
console.log('BY SOURCE:');
console.log(`  Craigslist: ${stats.craigslist}`);
console.log(`  KSL:        ${stats.ksl}`);
console.log(`  Other:      ${stats.other}`);
console.log('');
console.log('DATA QUALITY:');
console.log(`  With year:  ${stats.withYear} (${(stats.withYear/stats.parsed*100).toFixed(1)}%)`);
console.log(`  With price: ${stats.withPrice} (${(stats.withPrice/stats.parsed*100).toFixed(1)}%)`);
console.log(`  With VIN:   ${stats.withVin} (${(stats.withVin/stats.parsed*100).toFixed(1)}%)`);
console.log(`  With phone: ${stats.withPhone} (${(stats.withPhone/stats.parsed*100).toFixed(1)}%)`);
console.log('');

// Show quality distribution
const qualityDist = db.prepare(`
  SELECT
    CASE
      WHEN data_quality_score >= 80 THEN 'Excellent (80-100)'
      WHEN data_quality_score >= 60 THEN 'Good (60-79)'
      WHEN data_quality_score >= 40 THEN 'Fair (40-59)'
      ELSE 'Poor (<40)'
    END as quality,
    COUNT(*) as count
  FROM listings
  GROUP BY quality
  ORDER BY data_quality_score DESC
`).all();

console.log('QUALITY DISTRIBUTION:');
for (const row of qualityDist as any[]) {
  console.log(`  ${row.quality}: ${row.count}`);
}

// Show sample high-quality listings
console.log('');
console.log('='.repeat(60));
console.log('SAMPLE HIGH-QUALITY LISTINGS');
console.log('='.repeat(60));

const samples = db.prepare(`
  SELECT year, make, model, price, location, data_quality_score as score
  FROM listings
  WHERE data_quality_score >= 60
  ORDER BY data_quality_score DESC, price DESC
  LIMIT 15
`).all();

for (const row of samples as any[]) {
  const price = row.price ? `$${row.price.toLocaleString()}` : 'N/A';
  console.log(`${row.year || '????'} ${row.make || 'Unknown'} ${row.model || '?'} - ${price} (${row.location || 'N/A'}) [Score: ${row.score}]`);
}

db.close();
