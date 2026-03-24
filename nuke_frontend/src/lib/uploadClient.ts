/**
 * uploadClient.ts — Presigned URL upload client for browser
 *
 * Client-direct upload: bytes go straight from device to storage.
 * Server only issues permission and records metadata.
 *
 * Usage:
 *   import { presignedUpload } from '@/lib/uploadClient';
 *   const result = await presignedUpload({
 *     files: fileList,
 *     supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
 *     authToken: session.access_token,
 *     source: 'browser',
 *     concurrency: 50,
 *     onProgress: ({uploaded, total, pct}) => setProgress(pct),
 *   });
 */

const PREPARE_BATCH_SIZE = 500;
const DEFAULT_CONCURRENCY = 50;

interface UploadFile {
  file: File;
  vehicleId?: string;
  vehicleHint?: Record<string, unknown>;
}

interface UploadProgress {
  uploaded: number;
  total: number;
  skipped: number;
  errors: number;
  pct: number;
  rate: number; // per hour
}

interface UploadResult {
  uploaded: number;
  skipped: number;
  errors: number;
  total: number;
  imageIds: string[];
  elapsed: number;
  rate: number;
}

interface UploadOptions {
  files: UploadFile[];
  supabaseUrl: string;
  authToken: string;
  source?: string;
  concurrency?: number;
  onProgress?: (progress: UploadProgress) => void;
  skipHash?: boolean;
}

/**
 * Compute SHA-256 hash of a File using Web Crypto
 */
async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Call image-intake edge function
 */
async function callImageIntake(
  supabaseUrl: string,
  authToken: string,
  body: Record<string, unknown>,
): Promise<any> {
  const resp = await fetch(`${supabaseUrl}/functions/v1/image-intake`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${authToken}`,
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
 * Run async tasks with concurrency limit
 */
async function pooledMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

/**
 * Get MIME type from file extension
 */
function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    heic: 'image/heic',
    heif: 'image/heif',
  };
  return map[ext] || 'image/jpeg';
}

/**
 * Main presigned upload function for browser
 */
export async function presignedUpload(opts: UploadOptions): Promise<UploadResult> {
  const {
    files,
    supabaseUrl,
    authToken,
    source = 'browser',
    concurrency = DEFAULT_CONCURRENCY,
    onProgress,
    skipHash = false,
  } = opts;

  const startTime = Date.now();
  let totalUploaded = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  const allImageIds: string[] = [];

  // Process in batches of PREPARE_BATCH_SIZE
  for (let batchStart = 0; batchStart < files.length; batchStart += PREPARE_BATCH_SIZE) {
    const batchFiles = files.slice(batchStart, batchStart + PREPARE_BATCH_SIZE);

    // 1. Hash files in parallel (Web Crypto is async)
    const images = await Promise.all(
      batchFiles.map(async (f) => {
        let hash: string | null = null;
        if (!skipHash) {
          try {
            hash = await hashFile(f.file);
          } catch {
            // Hash failure is non-fatal
          }
        }
        return {
          filename: f.file.name,
          hash,
          size: f.file.size,
          vehicle_id: f.vehicleId || null,
          vehicle_hint: f.vehicleHint || null,
        };
      }),
    );

    // 2. Get presigned URLs
    const prepareResult = await callImageIntake(supabaseUrl, authToken, {
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
    const uploadItems = urls.map((u: any) => ({
      ...u,
      uploadFile: batchFiles[u.index],
    }));

    const uploadResults: boolean[] = [];

    await pooledMap(
      uploadItems,
      async (item: any) => {
        const file = item.uploadFile.file as File;
        const mimeType = getMimeType(file.name);

        try {
          const resp = await fetch(item.upload_url, {
            method: 'PUT',
            headers: { 'Content-Type': mimeType },
            body: file,
          });

          if (resp.ok) {
            totalUploaded++;
            uploadResults.push(true);
          } else {
            totalErrors++;
            uploadResults.push(false);
          }
        } catch {
          totalErrors++;
          uploadResults.push(false);
        }

        // Progress callback
        if (onProgress) {
          const elapsed = (Date.now() - startTime) / 1000;
          const processed = totalUploaded + totalErrors + totalSkipped;
          onProgress({
            uploaded: totalUploaded,
            total: files.length,
            skipped: totalSkipped,
            errors: totalErrors,
            pct: Math.round((processed / files.length) * 100),
            rate: elapsed > 0 ? Math.round((totalUploaded / elapsed) * 3600) : 0,
          });
        }
      },
      concurrency,
    );

    // 4. Confirm uploads
    const confirmResults = urls.map((u: any, i: number) => ({
      index: u.index,
      success: uploadResults[i] ?? false,
    }));

    const confirmResult = await callImageIntake(supabaseUrl, authToken, {
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
    rate: elapsed > 0 ? Math.round((totalUploaded / elapsed) * 3600) : 0,
  };
}
