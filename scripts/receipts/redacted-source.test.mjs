import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { prepareDerivative, rasterOnlyPng } from './redacted-source.mjs';

test('burns masks into RGB pixels, removes metadata, preserves original and requires independent review', async () => {
  const original = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#ffffff' } })
    .withMetadata({ exif: { IFD0: { Artist: 'Synthetic private identity' } } }).png().toBuffer();
  const saved = Buffer.from(original);
  const source_sha256 = createHash('sha256').update(original).digest('hex');
  const plan = { source_sha256, width: 8, height: 6, coordinate_space: 'exif_oriented_pixels', masks: [{ x: 1, y: 2, width: 3, height: 2 }] };
  const { derivative, manifest } = await prepareDerivative(original, plan);
  assert.deepEqual(original, saved);
  assert.equal(manifest.verification.visual_reviewed, false);
  assert.deepEqual(rasterOnlyPng(derivative), derivative);
  assert.equal((await sharp(derivative).metadata()).exif, undefined);
  assert.equal(derivative.includes(Buffer.from('Synthetic private identity')), false);
  const pixels = await sharp(derivative).raw().toBuffer();
  for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) {
    assert.equal(pixels[(y * 8 + x) * 3], y >= 2 && y < 4 && x >= 1 && x < 4 ? 0 : 255);
  }
  await assert.rejects(prepareDerivative(original, { ...plan, source_sha256: '0'.repeat(64) }), /hash/);
  await assert.rejects(prepareDerivative(original, { ...plan, width: 7 }), /dimensions/);
  await assert.rejects(prepareDerivative(original, { ...plan, masks: [{ x: 7, y: 0, width: 2, height: 1 }] }), /bounds/);
});
