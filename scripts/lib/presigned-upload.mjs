/**
 * presigned-upload.mjs — Shared presigned URL upload library for Nuke CLI scripts
 *
 * Client-direct upload via presigned URLs. Bytes go straight from disk to storage,
 * server only issues permission and records metadata.
 *
 * Usage:
 *   import { presignedUpload } from './lib/presigned-upload.mjs';
 *   const result = await presignedUpload({
 *     files: [{path: '/path/to/photo.jpg', vehicleId: 'uuid'}],
 *     supabaseUrl: process.env.VITE_SUPABASE_URL,
 *     serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
 *     source: 'bulk_upload',
 *     concurrency: 50,
 *     onProgress: ({uploaded, total, rate}) => {}
 *   });
 */

import { readFileSync, statSync } from 'fs';
import { basename, extname } from 'path';
import { createHash } from 'crypto';

const PREPARE_BATCH_SIZE = 500; // Max per prepare_upload call
const DEFAULT_CONCURRENCY = 50;

/**
 * Compute SHA-256 hash of a file
 */
function hashFile(filePath) {
  const data = readFileSync(filePath);
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Compute SHA-256 hash of a Buffer
 */
function hashBuffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Call image-intake edge function with given action
 */
async function callImageIntake(supabaseUrl, serviceRoleKey, body) {
  const resp = await fetch(`${supabaseUrl}/functions/v1/image-intake`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`image-intake ${body.action} failed (${resp.status}): ${text}`);
  }
  return resp.json();
}

/**
 * Upload a single file to a presigned URL via PUT
 */
async function putFile(uploadUrl, fileData, mimeType) {
  const resp = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: fileData,
  });
  return resp.ok;
}

/**
 * Run uploads with concurrency limit
 */
async function pooledMap(items, fn, concurrency) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Main presigned upload function
 *
 * @param {Object} opts
 * @param {Array<{path: string, vehicleId?: string, metadata?: object}>} opts.files - files to upload
 * @param {string} opts.supabaseUrl
 * @param {string} opts.serviceRoleKey
 * @param {string} [opts.source='presigned'] - source tag
 * @param {number} [opts.concurrency=50] - parallel upload count
 * @param {Function} [opts.onProgress] - progress callback({uploaded, total, skipped, errors, rate})
 * @param {boolean} [opts.skipHash=false] - skip hash computation (faster but no dedup)
 * @returns {Promise<{uploaded: number, skipped: number, errors: number, total: number, imageIds: string[], elapsed: number}>}
 */
export async function presignedUpload(opts) {
  const {
    files,
    supabaseUrl,
    serviceRoleKey,
    source = 'presigned',
    concurrency = DEFAULT_CONCURRENCY,
    onProgress,
    skipHash = false,
  } = opts;

  const startTime = Date.now();
  let totalUploaded = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  const allImageIds = [];

  // Process in batches of PREPARE_BATCH_SIZE (500)
  for (let batchStart = 0; batchStart < files.length; batchStart += PREPARE_BATCH_SIZE) {
    const batchFiles = files.slice(batchStart, batchStart + PREPARE_BATCH_SIZE);

    // 1. Hash files and build prepare request
    const images = batchFiles.map((f) => {
      const filePath = f.path;
      const stat = statSync(filePath);
      const filename = basename(filePath);
      let hash = null;
      if (!skipHash) {
        try { hash = hashFile(filePath); } catch {}
      }
      return {
        filename,
        hash,
        size: stat.size,
        vehicle_id: f.vehicleId || null,
        vehicle_hint: f.vehicleHint || null,
      };
    });

    // 2. Call prepare_upload to get presigned URLs
    const prepareResult = await callImageIntake(supabaseUrl, serviceRoleKey, {
      action: 'prepare_upload',
      images,
      source,
    });

    if (!prepareResult.success) {
      throw new Error(`prepare_upload failed: ${JSON.stringify(prepareResult)}`);
    }

    const { batch_id, urls, duplicates_skipped } = prepareResult;
    totalSkipped += duplicates_skipped.length;

    // 3. PUT files to presigned URLs with concurrency
    const uploadItems = urls.map((u) => ({
      ...u,
      file: batchFiles[u.index],
    }));

    let batchUploaded = 0;
    let batchErrors = 0;

    await pooledMap(uploadItems, async (item) => {
      const filePath = item.file.path;
      const ext = extname(filePath).toLowerCase();
      const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

      try {
        const fileData = readFileSync(filePath);
        const ok = await putFile(item.upload_url, fileData, mimeType);
        if (ok) {
          batchUploaded++;
          totalUploaded++;
        } else {
          batchErrors++;
          totalErrors++;
        }
      } catch (e) {
        batchErrors++;
        totalErrors++;
      }

      // Progress callback
      if (onProgress) {
        const elapsed = (Date.now() - startTime) / 1000;
        const processed = batchStart + batchUploaded + batchErrors + totalSkipped;
        onProgress({
          uploaded: totalUploaded,
          total: files.length,
          skipped: totalSkipped,
          errors: totalErrors,
          rate: Math.round(totalUploaded / elapsed * 3600),
          pct: Math.round(processed / files.length * 100),
        });
      }
    }, concurrency);

    // 4. Confirm uploads
    const confirmResults = urls.map((u) => {
      // Check if this index was successfully uploaded
      const wasUploaded = uploadItems.some(
        (item) => item.index === u.index
      );
      return { index: u.index, success: wasUploaded };
    });

    const confirmResult = await callImageIntake(supabaseUrl, serviceRoleKey, {
      action: 'confirm_upload',
      batch_id,
      results: confirmResults,
    });

    if (confirmResult.success && confirmResult.summary?.image_ids) {
      allImageIds.push(...confirmResult.summary.image_ids);
    }
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);

  return {
    uploaded: totalUploaded,
    skipped: totalSkipped,
    errors: totalErrors,
    total: files.length,
    imageIds: allImageIds,
    elapsed,
    rate: Math.round(totalUploaded / (elapsed || 1) * 3600),
  };
}

/**
 * Presigned upload from buffers (for MCP/programmatic use)
 *
 * @param {Object} opts
 * @param {Array<{buffer: Buffer, filename: string, vehicleId?: string, hash?: string}>} opts.items
 * @param {string} opts.supabaseUrl
 * @param {string} opts.serviceRoleKey
 * @param {string} [opts.source='presigned']
 * @param {number} [opts.concurrency=50]
 * @returns {Promise<{uploaded: number, skipped: number, errors: number, imageIds: string[]}>}
 */
export async function presignedUploadBuffers(opts) {
  const {
    items,
    supabaseUrl,
    serviceRoleKey,
    source = 'presigned',
    concurrency = DEFAULT_CONCURRENCY,
  } = opts;

  let totalUploaded = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  const allImageIds = [];

  for (let batchStart = 0; batchStart < items.length; batchStart += PREPARE_BATCH_SIZE) {
    const batchItems = items.slice(batchStart, batchStart + PREPARE_BATCH_SIZE);

    const images = batchItems.map((item) => ({
      filename: item.filename,
      hash: item.hash || hashBuffer(item.buffer),
      size: item.buffer.length,
      vehicle_id: item.vehicleId || null,
    }));

    const prepareResult = await callImageIntake(supabaseUrl, serviceRoleKey, {
      action: 'prepare_upload',
      images,
      source,
    });

    if (!prepareResult.success) continue;

    const { batch_id, urls, duplicates_skipped } = prepareResult;
    totalSkipped += duplicates_skipped.length;

    await pooledMap(urls, async (u) => {
      const item = batchItems[u.index];
      const ext = extname(item.filename).toLowerCase();
      const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';

      try {
        const ok = await putFile(u.upload_url, item.buffer, mimeType);
        if (ok) totalUploaded++;
        else totalErrors++;
      } catch {
        totalErrors++;
      }
    }, concurrency);

    const confirmResult = await callImageIntake(supabaseUrl, serviceRoleKey, {
      action: 'confirm_upload',
      batch_id,
      results: urls.map((u) => ({ index: u.index, success: true })),
    });

    if (confirmResult.success && confirmResult.summary?.image_ids) {
      allImageIds.push(...confirmResult.summary.image_ids);
    }
  }

  return { uploaded: totalUploaded, skipped: totalSkipped, errors: totalErrors, imageIds: allImageIds };
}

export { hashFile, hashBuffer };
