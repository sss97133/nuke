#!/usr/bin/env npx tsx
/**
 * Craigslist Archive Import Script
 * Imports saved Craigslist listings into the vehicles database with historian attribution
 *
 * Usage:
 *   npx tsx scripts/craigslist-import/index.ts [options]
 *
 * Options:
 *   --dry-run          Don't write to database, just show what would be imported
 *   --limit N          Only process first N files
 *   --source DIR       Source directory (default: ~/Documents/PROJECTS/Content DATABASE/CRAIGSLIST BOOK)
 *   --batch-name NAME  Name for this import batch
 *   --verbose          Show detailed output
 *   --upload-images    Upload local images to Supabase storage
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseHtml, CraigslistListing } from './html-parser';
import { parseWebarchive } from './webarchive-parser';
import { extractPhoneNumbers, ExtractedPhone } from './phone-extractor';
import { uploadListingImages } from './image-uploader';
import {
  initSupabase,
  getHistorianUserId,
  createImportBatch,
  updateImportBatch,
  logImportError,
  importVehicle,
  createOrGetContact,
  linkVehicleToOwner,
  createDiscoveryEvent,
  completeImportBatch,
  vehicleExistsByPostId,
} from './db-client';

interface ImportOptions {
  dryRun: boolean;
  limit: number | null;
  sourceDir: string;
  batchName: string;
  verbose: boolean;
  uploadImages: boolean;
}

interface ImportStats {
  filesFound: number;
  filesProcessed: number;
  filesFailed: number;
  vehiclesCreated: number;
  vehiclesSkipped: number;
  contactsCreated: number;
  imagesUploaded: number;
  timelineEventsCreated: number;
  phonesExtracted: number;
}

const DEFAULT_SOURCE_DIR = path.join(
  process.env.HOME || '~',
  'Documents/PROJECTS/Content DATABASE/CRAIGSLIST BOOK'
);

async function main() {
  const options = parseArgs();

  console.log('='.repeat(60));
  console.log('Craigslist Archive Import');
  console.log('='.repeat(60));
  console.log(`Source: ${options.sourceDir}`);
  console.log(`Mode: ${options.dryRun ? 'DRY RUN' : 'LIVE'}`);
  if (options.limit) console.log(`Limit: ${options.limit} files`);
  console.log('');

  // Validate source directory
  if (!fs.existsSync(options.sourceDir)) {
    console.error(`Error: Source directory not found: ${options.sourceDir}`);
    process.exit(1);
  }

  // Find all importable files
  const files = findImportableFiles(options.sourceDir, options.limit);
  console.log(`Found ${files.length} files to import`);
  console.log('');

  if (files.length === 0) {
    console.log('No files to import. Exiting.');
    return;
  }

  // Initialize database connection
  let batchId: string | null = null;
  let historianUserId: string | null = null;

  if (!options.dryRun) {
    try {
      initSupabase();
      historianUserId = await getHistorianUserId();
      console.log(`Historian User ID: ${historianUserId || 'Not found'}`);

      const batch = await createImportBatch(
        options.batchName,
        options.sourceDir,
        files.length,
        historianUserId
      );
      batchId = batch.id;
      console.log(`Created import batch: ${batchId}`);
    } catch (error) {
      console.error('Failed to initialize database:', error);
      process.exit(1);
    }
  }

  console.log('');
  console.log('Starting import...');
  console.log('-'.repeat(60));

  const stats = await processFiles(files, options, batchId, historianUserId);

  // Complete the batch
  if (!options.dryRun && batchId) {
    await completeImportBatch(batchId, {
      files_processed: stats.filesProcessed,
      files_failed: stats.filesFailed,
      vehicles_created: stats.vehiclesCreated,
      vehicles_updated: 0,
      contacts_created: stats.contactsCreated,
      timeline_events_created: stats.timelineEventsCreated,
    });
  }

  // Print summary
  console.log('');
  console.log('='.repeat(60));
  console.log('Import Summary');
  console.log('='.repeat(60));
  console.log(`Files found:            ${stats.filesFound}`);
  console.log(`Files processed:        ${stats.filesProcessed}`);
  console.log(`Files failed:           ${stats.filesFailed}`);
  console.log(`Vehicles created:       ${stats.vehiclesCreated}`);
  console.log(`Vehicles skipped:       ${stats.vehiclesSkipped}`);
  console.log(`Contacts created:       ${stats.contactsCreated}`);
  console.log(`Phone numbers found:    ${stats.phonesExtracted}`);
  console.log(`Timeline events:        ${stats.timelineEventsCreated}`);
  console.log(`Images uploaded:        ${stats.imagesUploaded}`);
  if (batchId) {
    console.log(`Import batch ID:        ${batchId}`);
  }
  console.log('');
}

function parseArgs(): ImportOptions {
  const args = process.argv.slice(2);
  const options: ImportOptions = {
    dryRun: false,
    limit: null,
    sourceDir: DEFAULT_SOURCE_DIR,
    batchName: `CL Import ${new Date().toISOString().split('T')[0]}`,
    verbose: false,
    uploadImages: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--limit':
        options.limit = parseInt(args[++i], 10);
        break;
      case '--source':
        options.sourceDir = args[++i];
        break;
      case '--batch-name':
        options.batchName = args[++i];
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--upload-images':
        options.uploadImages = true;
        break;
      case '--help':
        printHelp();
        process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Craigslist Archive Import Script

Usage:
  npx tsx scripts/craigslist-import/index.ts [options]

Options:
  --dry-run          Don't write to database, just show what would be imported
  --limit N          Only process first N files
  --source DIR       Source directory (default: ~/Documents/PROJECTS/Content DATABASE/CRAIGSLIST BOOK)
  --batch-name NAME  Name for this import batch
  --verbose          Show detailed output
  --upload-images    Upload local images to Supabase storage
  --help             Show this help message

Environment Variables:
  VITE_SUPABASE_URL         Supabase project URL
  SUPABASE_SERVICE_ROLE_KEY Service role key for database access
  HISTORIAN_USER_ID         (Optional) User ID to attribute as historian
`);
}

function findImportableFiles(dir: string, limit: number | null): string[] {
  const files: string[] = [];

  // Recursively scan all directories, excluding _files asset directories
  function scanDirectory(currentDir: string) {
    const entries = fs.readdirSync(currentDir);

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry);

      try {
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          // Skip _files directories (contain assets, not listings)
          if (!entry.endsWith('_files')) {
            scanDirectory(fullPath);
          }
        } else if (stat.isFile()) {
          const ext = path.extname(entry).toLowerCase();
          if (ext === '.html' || ext === '.htm' || ext === '.webarchive') {
            files.push(fullPath);
          }
        }
      } catch (err) {
        // Skip files we can't access
        console.error(`Skipping ${fullPath}: ${err}`);
      }
    }
  }

  scanDirectory(dir);

  // Sort by filename for consistent ordering
  files.sort();

  // Apply limit if specified
  if (limit && limit > 0) {
    return files.slice(0, limit);
  }

  return files;
}

async function processFiles(
  files: string[],
  options: ImportOptions,
  batchId: string | null,
  historianUserId: string | null
): Promise<ImportStats> {
  const stats: ImportStats = {
    filesFound: files.length,
    filesProcessed: 0,
    filesFailed: 0,
    vehiclesCreated: 0,
    vehiclesSkipped: 0,
    contactsCreated: 0,
    imagesUploaded: 0,
    timelineEventsCreated: 0,
    phonesExtracted: 0,
  };

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    const fileName = path.basename(filePath);
    const progress = `[${i + 1}/${files.length}]`;

    try {
      // Parse the file
      const listing = await parseFile(filePath);

      if (!listing) {
        console.log(`${progress} SKIP: ${fileName} - Failed to parse`);
        stats.filesFailed++;
        if (batchId) {
          await logImportError(batchId, filePath, 'Failed to parse file');
        }
        continue;
      }

      // Check for basic vehicle info
      if (!listing.title && !listing.make && !listing.model) {
        console.log(`${progress} SKIP: ${fileName} - No vehicle information`);
        stats.filesFailed++;
        continue;
      }

      // Extract phone numbers from description
      const phones = extractPhoneNumbers(listing.description);
      stats.phonesExtracted += phones.length;

      // Log what we found
      const year = listing.year || '????';
      const make = listing.make || 'Unknown';
      const model = listing.model || listing.title?.substring(0, 20) || 'Unknown';
      const price = listing.price ? `$${listing.price.toLocaleString()}` : 'No price';
      const phoneInfo = phones.length > 0 ? ` [${phones.length} phone(s)]` : '';

      if (options.dryRun) {
        console.log(`${progress} ${year} ${make} ${model} - ${price}${phoneInfo}`);
        if (options.verbose) {
          console.log(`         Post ID: ${listing.postId}`);
          console.log(`         URL: ${listing.originalUrl || 'N/A'}`);
          console.log(`         Location: ${listing.location || 'N/A'}`);
          console.log(`         VIN: ${listing.vin || 'N/A'}`);
          console.log(`         Images: ${listing.imageUrls.length}`);
          if (phones.length > 0) {
            console.log(`         Phones: ${phones.map(p => p.normalized).join(', ')}`);
          }
          console.log('');
        }
        stats.filesProcessed++;
        stats.vehiclesCreated++; // Would be created
        stats.contactsCreated += phones.length > 0 ? 1 : 0; // Would be created
        stats.timelineEventsCreated++; // Would be created
        continue;
      }

      // Check if vehicle already exists
      const existingId = await vehicleExistsByPostId(listing.postId);
      if (existingId) {
        console.log(`${progress} EXISTS: ${year} ${make} ${model} (${existingId})`);
        stats.vehiclesSkipped++;
        stats.filesProcessed++;
        continue;
      }

      // Import the vehicle
      const result = await importVehicle(listing, historianUserId, filePath);

      if (!result.success || !result.vehicleId) {
        console.log(`${progress} FAIL: ${fileName} - ${result.error}`);
        stats.filesFailed++;
        if (batchId) {
          await logImportError(batchId, filePath, result.error || 'Unknown error');
        }
        continue;
      }

      stats.vehiclesCreated++;

      // Create timeline event
      const eventId = await createDiscoveryEvent(result.vehicleId, listing, historianUserId);
      if (eventId) {
        stats.timelineEventsCreated++;
      }

      // Create contacts and link to vehicle
      if (phones.length > 0) {
        const phone = phones[0]; // Use highest confidence phone
        const contactId = await createOrGetContact(phone, listing.location);
        if (contactId) {
          stats.contactsCreated++;
          await linkVehicleToOwner(result.vehicleId, contactId, listing, historianUserId);
        }
      }

      // Upload images if enabled
      let imageInfo = '';
      if (options.uploadImages) {
        const imageResult = await uploadListingImages(result.vehicleId, listing, filePath);
        stats.imagesUploaded += imageResult.uploaded;
        if (imageResult.uploaded > 0) {
          imageInfo = ` [${imageResult.uploaded} img]`;
        }
      }

      console.log(`${progress} OK: ${year} ${make} ${model} - ${price}${phoneInfo}${imageInfo}`);
      stats.filesProcessed++;

      // Update batch progress periodically
      if (batchId && stats.filesProcessed % 10 === 0) {
        await updateImportBatch(batchId, {
          files_processed: stats.filesProcessed,
          files_failed: stats.filesFailed,
          vehicles_created: stats.vehiclesCreated,
          contacts_created: stats.contactsCreated,
          timeline_events_created: stats.timelineEventsCreated,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.log(`${progress} ERROR: ${fileName} - ${errorMessage}`);
      stats.filesFailed++;
      if (batchId) {
        await logImportError(batchId, filePath, errorMessage);
      }
    }
  }

  return stats;
}

async function parseFile(filePath: string): Promise<CraigslistListing | null> {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.webarchive') {
    // Parse webarchive and extract HTML
    const content = await parseWebarchive(filePath);
    if (!content || !content.html) {
      return null;
    }
    return parseHtml(content.html, filePath);
  } else {
    // Parse HTML directly
    const html = fs.readFileSync(filePath, 'utf-8');
    return parseHtml(html, filePath);
  }
}

// Run main function
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
