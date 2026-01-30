/**
 * Image Uploader for Craigslist Archive Import
 * Handles finding and uploading local images to Supabase storage
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  initSupabase,
  uploadImage,
  createVehicleImage,
} from './db-client';
import type { CraigslistListing } from './html-parser';

export interface ImageUploadResult {
  uploaded: number;
  failed: number;
  skipped: number;
  urls: string[];
}

/**
 * Find and upload images for a vehicle listing
 */
export async function uploadListingImages(
  vehicleId: string,
  listing: CraigslistListing,
  archiveFilePath: string
): Promise<ImageUploadResult> {
  const result: ImageUploadResult = {
    uploaded: 0,
    failed: 0,
    skipped: 0,
    urls: [],
  };

  // Find local image files
  const localImages = findLocalImages(archiveFilePath, listing);

  if (localImages.length === 0) {
    return result;
  }

  for (let i = 0; i < localImages.length; i++) {
    const imagePath = localImages[i];

    try {
      // Check if file exists and is readable
      if (!fs.existsSync(imagePath)) {
        result.skipped++;
        continue;
      }

      // Read file
      const imageBuffer = fs.readFileSync(imagePath);

      // Skip if file is too small (likely corrupted or placeholder)
      if (imageBuffer.length < 1000) {
        result.skipped++;
        continue;
      }

      // Determine MIME type from extension
      const ext = path.extname(imagePath).toLowerCase();
      const mimeType = getMimeType(ext);

      if (!mimeType) {
        result.skipped++;
        continue;
      }

      // Upload to Supabase storage
      const publicUrl = await uploadImage(vehicleId, imagePath, imageBuffer, mimeType);

      if (publicUrl) {
        result.uploaded++;
        result.urls.push(publicUrl);

        // Find corresponding original URL
        const originalUrl = findOriginalUrl(imagePath, listing.imageUrls);

        // Create vehicle_images record
        await createVehicleImage(vehicleId, publicUrl, {
          source_url: originalUrl,
          category: categorizeImage(imagePath, i),
          position: i,
        });
      } else {
        result.failed++;
      }
    } catch (error) {
      console.error(`Failed to upload image ${imagePath}:`, error);
      result.failed++;
    }
  }

  return result;
}

/**
 * Find local image files associated with a listing
 */
function findLocalImages(archiveFilePath: string, listing: CraigslistListing): string[] {
  const images: string[] = [];
  const baseDir = path.dirname(archiveFilePath);
  const baseName = path.basename(archiveFilePath, path.extname(archiveFilePath));

  // Check for _files directory (common pattern for saved web pages)
  const filesDir = path.join(baseDir, `${baseName}_files`);
  if (fs.existsSync(filesDir)) {
    const entries = fs.readdirSync(filesDir);
    for (const entry of entries) {
      const ext = path.extname(entry).toLowerCase();
      if (isImageExtension(ext)) {
        // Skip thumbnails (50x50)
        if (entry.includes('50x50')) continue;

        images.push(path.join(filesDir, entry));
      }
    }
  }

  // Also check local paths from listing
  for (const localPath of listing.localImagePaths) {
    if (fs.existsSync(localPath) && !images.includes(localPath)) {
      images.push(localPath);
    }
  }

  // Sort images by filename to maintain order
  images.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));

  return images;
}

/**
 * Check if file extension is an image
 */
function isImageExtension(ext: string): boolean {
  return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext);
}

/**
 * Get MIME type from file extension
 */
function getMimeType(ext: string): string | null {
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
  };
  return mimeTypes[ext] || null;
}

/**
 * Find the original URL for a local image file
 */
function findOriginalUrl(localPath: string, imageUrls: string[]): string | undefined {
  const filename = path.basename(localPath);

  // Try to match by image ID (e.g., "00D0D_1Nems1jDeUA" in filename)
  for (const url of imageUrls) {
    // Extract image ID from URL
    const urlMatch = url.match(/([0-9a-zA-Z]{5,}_[0-9a-zA-Z]+)/);
    if (urlMatch && filename.includes(urlMatch[1])) {
      return url;
    }
  }

  // Try to match by filename
  for (const url of imageUrls) {
    if (url.includes(filename.replace(/_/g, '/'))) {
      return url;
    }
  }

  return undefined;
}

/**
 * Categorize image based on filename or position
 */
function categorizeImage(imagePath: string, position: number): string {
  const filename = path.basename(imagePath).toLowerCase();

  // Check for common patterns in filenames
  if (filename.includes('engine') || filename.includes('motor')) {
    return 'engine';
  }
  if (filename.includes('interior') || filename.includes('dash') || filename.includes('seat')) {
    return 'interior';
  }
  if (filename.includes('trunk') || filename.includes('bed')) {
    return 'trunk';
  }
  if (filename.includes('under') || filename.includes('frame')) {
    return 'undercarriage';
  }

  // First image is usually the hero/exterior shot
  if (position === 0) {
    return 'exterior';
  }

  return 'general';
}

/**
 * Batch upload images for multiple vehicles
 */
export async function batchUploadImages(
  vehicleListings: Array<{
    vehicleId: string;
    listing: CraigslistListing;
    archiveFilePath: string;
  }>
): Promise<{
  totalUploaded: number;
  totalFailed: number;
  totalSkipped: number;
}> {
  let totalUploaded = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  for (const { vehicleId, listing, archiveFilePath } of vehicleListings) {
    const result = await uploadListingImages(vehicleId, listing, archiveFilePath);
    totalUploaded += result.uploaded;
    totalFailed += result.failed;
    totalSkipped += result.skipped;
  }

  return { totalUploaded, totalFailed, totalSkipped };
}

// Test function
async function testUpload() {
  const testFilePath = process.argv[2];
  const testVehicleId = process.argv[3];

  if (!testFilePath || !testVehicleId) {
    console.log('Usage: npx tsx image-uploader.ts <archive-file-path> <vehicle-id>');
    process.exit(1);
  }

  initSupabase();

  const listing = require('./html-parser').parseHtml(
    fs.readFileSync(testFilePath, 'utf-8'),
    testFilePath
  );

  console.log(`Found ${listing.imageUrls.length} image URLs`);
  console.log(`Found ${listing.localImagePaths.length} local image paths`);

  const localImages = findLocalImages(testFilePath, listing);
  console.log(`Found ${localImages.length} local image files:`);
  localImages.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));

  const result = await uploadListingImages(testVehicleId, listing, testFilePath);
  console.log('\nUpload Results:');
  console.log(`  Uploaded: ${result.uploaded}`);
  console.log(`  Failed: ${result.failed}`);
  console.log(`  Skipped: ${result.skipped}`);
  console.log(`  URLs:`);
  result.urls.forEach(u => console.log(`    ${u}`));
}

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] === __filename) {
  testUpload().catch(console.error);
}
