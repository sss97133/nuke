#!/usr/bin/env node
// Local-only preparation. No upload and no inferred mask coordinates.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// Keep only the raster. EXIF, XMP, text, profiles, thumbnails and trailing bytes
// cannot accompany a derivative, even if a future encoder starts preserving them.
export function rasterOnlyPng(bytes) {
  if (!bytes.subarray(0, 8).equals(signature)) throw new Error('PNG required');
  const chunks = [signature];
  let offset = 8;
  while (offset < bytes.length) {
    const size = bytes.readUInt32BE(offset);
    if (offset + size + 12 > bytes.length) throw new Error('Truncated PNG');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (['IHDR', 'IDAT', 'IEND'].includes(type)) chunks.push(bytes.subarray(offset, offset + size + 12));
    offset += size + 12;
    if (type === 'IEND') return Buffer.concat(chunks);
  }
  throw new Error('Missing PNG end');
}

export async function prepareDerivative(original, plan) {
  if (digest(original) !== plan.source_sha256) throw new Error('Original hash differs from reviewed mask plan');
  if (plan.coordinate_space !== 'exif_oriented_pixels' || !Array.isArray(plan.masks)) throw new Error('Explicit oriented pixel masks required');
  // Decode to a fresh RGB buffer; no hidden text layer, alpha or source metadata.
  const { data, info } = await sharp(original, { limitInputPixels: 80_000_000 }).rotate().removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (plan.width !== width || plan.height !== height || channels !== 3) throw new Error('Mask coordinate dimensions differ from decoded source');
  for (const mask of plan.masks) {
    const { x, y, width: w, height: h } = mask;
    if (![x, y, w, h].every(Number.isSafeInteger) || x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > width || y + h > height) throw new Error('Invalid mask bounds');
    for (let row = y; row < y + h; row++) data.fill(0, (row * width + x) * 3, (row * width + x + w) * 3);
  }
  const derivative = rasterOnlyPng(await sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer());
  const decoded = await sharp(derivative).raw().toBuffer();
  if (!decoded.equals(data)) throw new Error('Derivative pixel verification failed');
  return { derivative, manifest: {
    contract: 'financial_redacted_source_v1', source_sha256: plan.source_sha256,
    derivative_sha256: digest(derivative), mime_type: 'image/png', width, height,
    policy_version: 'financial-private-v1', geometry_status: 'not_available',
    verification: { pixel_masks: true, metadata_removed: true, embedded_text_removed: true,
      visual_reviewed: false, reviewer: null, reviewed_at: null },
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [source, planPath, output] = process.argv.slice(2);
  if (!source || !planPath || !output) throw new Error('Usage: redacted-source.mjs ORIGINAL MASK_PLAN.json OUTPUT.png');
  const original = await readFile(source);
  const { derivative, manifest } = await prepareDerivative(original, JSON.parse(await readFile(planPath, 'utf8')));
  // Exclusive creation protects both the immutable original and previous derivatives.
  await writeFile(output, derivative, { flag: 'wx', mode: 0o600 });
  await writeFile(`${output}.json`, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  if (digest(await readFile(source)) !== manifest.source_sha256) throw new Error('Original changed during preparation');
  console.log('Private derivative prepared. Independent visual review of all exposed pixels is required before admission.');
}
