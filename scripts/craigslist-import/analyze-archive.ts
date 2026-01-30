#!/usr/bin/env npx tsx
/**
 * Archive Analyzer
 * Inventories and categorizes all files in the Craigslist archive
 * Creates a local SQLite database for organizing before upload
 */

import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import * as crypto from 'crypto';

const ARCHIVE_DIR = '/Users/skylar/Documents/PROJECTS/Content DATABASE/CRAIGSLIST BOOK';
const DB_PATH = '/Users/skylar/nuke/data/archive-inventory.db';

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize SQLite database
const db = new Database(DB_PATH);

// Create tables
db.exec(`
  -- All files in the archive
  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE NOT NULL,
    filename TEXT NOT NULL,
    extension TEXT,
    size_bytes INTEGER,
    category TEXT,  -- 'listing', 'image', 'asset', 'document', 'other'
    subcategory TEXT,  -- 'html', 'webarchive', 'full_image', 'thumbnail', 'tiny', 'pdf', etc.
    parent_dir TEXT,
    is_in_files_dir BOOLEAN DEFAULT FALSE,  -- In a _files asset directory
    associated_listing_id INTEGER REFERENCES listings(id),
    image_width INTEGER,
    image_height INTEGER,
    hash TEXT,  -- For deduplication
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Parsed listings (from HTML/webarchive)
  CREATE TABLE IF NOT EXISTS listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER REFERENCES files(id),
    source_site TEXT,  -- 'craigslist', 'ksl', 'unknown'
    post_id TEXT,
    original_url TEXT,
    title TEXT,
    year INTEGER,
    make TEXT,
    model TEXT,
    price REAL,
    location TEXT,
    description TEXT,
    vin TEXT,
    odometer INTEGER,
    post_date TEXT,
    phone_raw TEXT,
    phone_normalized TEXT,
    parse_status TEXT DEFAULT 'pending',  -- 'pending', 'parsed', 'failed', 'incomplete'
    parse_error TEXT,
    data_quality_score REAL,  -- 0-100
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Image groups (standalone image folders)
  CREATE TABLE IF NOT EXISTS image_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_path TEXT UNIQUE NOT NULL,
    folder_name TEXT,
    image_count INTEGER,
    total_size_bytes INTEGER,
    has_listing BOOLEAN DEFAULT FALSE,
    inferred_vehicle TEXT,  -- From folder name
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Deduplication tracking
  CREATE TABLE IF NOT EXISTS duplicates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER REFERENCES files(id),
    duplicate_of_id INTEGER REFERENCES files(id),
    match_type TEXT,  -- 'hash', 'filename', 'content'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Upload batches
  CREATE TABLE IF NOT EXISTS upload_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    status TEXT DEFAULT 'pending',
    file_count INTEGER,
    listing_count INTEGER,
    image_count INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    uploaded_at DATETIME
  );

  CREATE INDEX IF NOT EXISTS idx_files_category ON files(category);
  CREATE INDEX IF NOT EXISTS idx_files_parent_dir ON files(parent_dir);
  CREATE INDEX IF NOT EXISTS idx_files_hash ON files(hash);
  CREATE INDEX IF NOT EXISTS idx_listings_source ON listings(source_site);
  CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(parse_status);
`);

console.log('='.repeat(60));
console.log('Archive Analyzer');
console.log('='.repeat(60));
console.log(`Archive: ${ARCHIVE_DIR}`);
console.log(`Database: ${DB_PATH}`);
console.log('');

// Stats
const stats = {
  totalFiles: 0,
  listings: 0,
  images: { tiny: 0, thumbnail: 0, medium: 0, full: 0 },
  assets: 0,
  documents: 0,
  directories: 0,
  imageGroups: 0,
};

// Prepared statements
const insertFile = db.prepare(`
  INSERT OR IGNORE INTO files (path, filename, extension, size_bytes, category, subcategory, parent_dir, is_in_files_dir)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertImageGroup = db.prepare(`
  INSERT OR IGNORE INTO image_groups (folder_path, folder_name, image_count, total_size_bytes, inferred_vehicle)
  VALUES (?, ?, ?, ?, ?)
`);

function categorizeFile(filePath: string, size: number): { category: string; subcategory: string } {
  const ext = path.extname(filePath).toLowerCase();
  const isInFilesDir = filePath.includes('_files/') || filePath.includes('_files\\');

  // Listings
  if (['.html', '.htm', '.webarchive'].includes(ext) && !isInFilesDir) {
    return { category: 'listing', subcategory: ext.replace('.', '') };
  }

  // Images
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)) {
    let subcategory: string;
    if (size < 5000) subcategory = 'tiny';
    else if (size < 20000) subcategory = 'thumbnail';
    else if (size < 100000) subcategory = 'medium';
    else subcategory = 'full';
    return { category: 'image', subcategory };
  }

  // Documents
  if (['.pdf', '.doc', '.docx', '.txt'].includes(ext)) {
    return { category: 'document', subcategory: ext.replace('.', '') };
  }

  // Design files
  if (['.psd', '.ai', '.svg'].includes(ext)) {
    return { category: 'design', subcategory: ext.replace('.', '') };
  }

  // Assets (JS, CSS, etc.)
  if (['.js', '.css', '.xmp'].includes(ext) || isInFilesDir) {
    return { category: 'asset', subcategory: ext.replace('.', '') || 'other' };
  }

  return { category: 'other', subcategory: ext.replace('.', '') || 'unknown' };
}

function inferVehicleFromPath(folderPath: string): string | null {
  const name = path.basename(folderPath).toLowerCase();

  // Try to extract vehicle info from folder name
  const patterns = [
    /camaro\s*(\d+)/i,
    /(\d{4})\s*([\w]+)/,
    /(gto|corvette|mustang|charger|challenger)/i,
  ];

  for (const pattern of patterns) {
    const match = name.match(pattern);
    if (match) {
      return match[0];
    }
  }

  return name;
}

function scanDirectory(dir: string) {
  const entries = fs.readdirSync(dir);
  const imageFiles: string[] = [];
  let totalImageSize = 0;

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);

    try {
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        stats.directories++;
        scanDirectory(fullPath);
      } else if (stat.isFile()) {
        stats.totalFiles++;
        const ext = path.extname(entry).toLowerCase();
        const { category, subcategory } = categorizeFile(fullPath, stat.size);
        const isInFilesDir = fullPath.includes('_files/') || fullPath.includes('_files\\');

        insertFile.run(
          fullPath,
          entry,
          ext,
          stat.size,
          category,
          subcategory,
          dir,
          isInFilesDir ? 1 : 0
        );

        // Track stats
        if (category === 'listing') stats.listings++;
        else if (category === 'image') {
          stats.images[subcategory as keyof typeof stats.images]++;
          if (!isInFilesDir) {
            imageFiles.push(fullPath);
            totalImageSize += stat.size;
          }
        }
        else if (category === 'asset') stats.assets++;
        else if (category === 'document') stats.documents++;

        // Progress every 1000 files
        if (stats.totalFiles % 1000 === 0) {
          console.log(`  Scanned ${stats.totalFiles} files...`);
        }
      }
    } catch (err) {
      console.error(`Error scanning ${fullPath}:`, err);
    }
  }

  // Check if this is an image group (folder with images but no listing)
  const hasListing = entries.some(e =>
    ['.html', '.htm', '.webarchive'].includes(path.extname(e).toLowerCase())
  );

  if (imageFiles.length >= 3 && !hasListing && !dir.includes('_files')) {
    stats.imageGroups++;
    const inferred = inferVehicleFromPath(dir);
    insertImageGroup.run(dir, path.basename(dir), imageFiles.length, totalImageSize, inferred);
  }
}

// Run scan
console.log('Scanning archive...');
const startTime = Date.now();

db.exec('BEGIN TRANSACTION');
scanDirectory(ARCHIVE_DIR);
db.exec('COMMIT');

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`Scan complete in ${elapsed}s`);
console.log('');

// Print summary
console.log('='.repeat(60));
console.log('INVENTORY SUMMARY');
console.log('='.repeat(60));
console.log(`Total files:        ${stats.totalFiles.toLocaleString()}`);
console.log(`Directories:        ${stats.directories.toLocaleString()}`);
console.log('');
console.log('LISTINGS:');
console.log(`  HTML/HTM/Webarchive: ${stats.listings.toLocaleString()}`);
console.log('');
console.log('IMAGES:');
console.log(`  Tiny (<5KB):      ${stats.images.tiny.toLocaleString()}`);
console.log(`  Thumbnails:       ${stats.images.thumbnail.toLocaleString()}`);
console.log(`  Medium:           ${stats.images.medium.toLocaleString()}`);
console.log(`  Full size:        ${stats.images.full.toLocaleString()}`);
console.log('');
console.log('OTHER:');
console.log(`  Assets (JS/CSS):  ${stats.assets.toLocaleString()}`);
console.log(`  Documents:        ${stats.documents.toLocaleString()}`);
console.log(`  Image groups:     ${stats.imageGroups.toLocaleString()}`);
console.log('');

// Detailed breakdown by directory
console.log('='.repeat(60));
console.log('BY DIRECTORY');
console.log('='.repeat(60));

const dirStats = db.prepare(`
  SELECT
    parent_dir,
    COUNT(*) as total,
    SUM(CASE WHEN category = 'listing' THEN 1 ELSE 0 END) as listings,
    SUM(CASE WHEN category = 'image' AND subcategory IN ('medium', 'full') THEN 1 ELSE 0 END) as good_images
  FROM files
  WHERE is_in_files_dir = 0
  GROUP BY parent_dir
  HAVING listings > 0 OR good_images > 5
  ORDER BY listings DESC, good_images DESC
  LIMIT 30
`).all();

for (const row of dirStats as any[]) {
  const dirName = row.parent_dir.replace(ARCHIVE_DIR, '.');
  console.log(`${dirName}`);
  console.log(`  Listings: ${row.listings}, Good images: ${row.good_images}`);
}

console.log('');
console.log('='.repeat(60));
console.log('IMAGE GROUPS (folders with images but no listing)');
console.log('='.repeat(60));

const imageGroups = db.prepare(`
  SELECT folder_name, image_count, total_size_bytes, inferred_vehicle
  FROM image_groups
  ORDER BY image_count DESC
  LIMIT 20
`).all();

for (const row of imageGroups as any[]) {
  const sizeMB = (row.total_size_bytes / 1024 / 1024).toFixed(1);
  console.log(`${row.folder_name}: ${row.image_count} images (${sizeMB}MB) - "${row.inferred_vehicle}"`);
}

console.log('');
console.log(`Database saved to: ${DB_PATH}`);
console.log('');
console.log('Next steps:');
console.log('  1. Run parse-listings.ts to extract vehicle data from HTML');
console.log('  2. Run identify-duplicates.ts to find duplicate images');
console.log('  3. Run prepare-batches.ts to create organized upload batches');

db.close();
