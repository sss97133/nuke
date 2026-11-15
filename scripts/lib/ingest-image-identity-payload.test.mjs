import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIdentityFirstPayload, personalLibraryStoragePath, ingestReviewedRenditions } from './ingest-image-identity-payload.mjs';
import { createHash } from 'node:crypto';

function base(overrides = {}) {
  return buildIdentityFirstPayload({
    contentSha256: 'abc123',
    publicUrl: 'https://example.test/img.jpg',
    storagePath: 'users/u1/iphoto-intake/f.jpg',
    filename: 'f.jpg',
    mimeType: 'image/jpeg',
    fileSize: 99,
    userId: 'user-1',
    syncedBy: 'iphoto-intake',
    meta: {
      uuid: 'photos-uuid',
      latitude: 35.97,
      longitude: -114.85,
      taken_at: '2026-05-26T03:41:17Z',
      original_filename: 'IMG_0850.HEIC',
      exif_data: { camera_make: 'Apple', camera_model: 'iPhone' },
    },
    albumName: '1979 Chevrolet C10',
    suggestedVehicleId: '4470c7b9-bbbc-4627-b908-3fc0567a68e7',
    ...overrides,
  });
}

test('album context is recorded as a suggestion, never as vehicle_id', () => {
  const p = base();
  assert.equal(Object.prototype.hasOwnProperty.call(p, 'vehicle_id'), false);
  assert.equal(p.vehicle_id, undefined);
  assert.equal(p.source, 'iphoto');
  assert.equal(p.source_type, 'local_filesystem');
  assert.equal(p.owner_verified, true);
  assert.equal(p.user_id, 'user-1');
  assert.equal(p.content_sha256, 'abc123');
  assert.equal(p.exif_data.synced_by, 'iphoto-intake');
  assert.equal(p.exif_data.album_name, '1979 Chevrolet C10');
  assert.equal(p.exif_data.suggested_vehicle_id, '4470c7b9-bbbc-4627-b908-3fc0567a68e7');
  assert.equal(p.exif_data.uuid, 'photos-uuid');
  assert.equal(p.gps_latitude, 35.97);
  assert.equal(p.taken_at, '2026-05-26T03:41:17Z');
  assert.equal(p.source_identifier, 'photos-uuid');
});

test('payload omits vehicle_id even when a suggested vehicle is absent', () => {
  const p = base({ albumName: null, suggestedVehicleId: null });
  assert.equal(Object.prototype.hasOwnProperty.call(p, 'vehicle_id'), false);
  assert.equal(p.exif_data.suggested_vehicle_id, undefined);
  assert.equal(p.exif_data.album_name, undefined);
});

test('personal library storage path is not namespaced under a vehicle id', () => {
  const path = personalLibraryStoragePath('0b9f107a-d124-49de-9ded-94698f63c1c4', 'iphoto-intake', 'IMG_0850.jpg');
  assert.equal(path, 'users/0b9f107a-d124-49de-9ded-94698f63c1c4/iphoto-intake/IMG_0850.jpg');
  assert.equal(path.includes('iphoto-intake'), true);
  assert.doesNotMatch(path, /^[0-9a-f-]{36}\//);
  assert.throws(() => personalLibraryStoragePath('u', 'iphoto/../x', 'f.jpg'));
});

function reviewedFixture() {
  const userId = '10000000-0000-4000-8000-000000000001';
  const asset = '20000000-0000-4000-8000-000000000001';
  const bytes = Buffer.from('synthetic rendition bytes');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const path = `users/${userId}/iphoto/previews/${asset}/${hash}.jpeg`;
  const p = { user_id: userId, source: 'iphoto', source_type: 'local_filesystem',
    processing_mode: 'subscription_review', owner_verified: false, source_identifier: asset,
    source_path: '/synthetic/preview.jpeg', mime_type: 'image/jpeg', content_sha256: hash,
    file_size_bytes: bytes.length, image_url: `https://example.test/${path}`, storage_path: path,
    taken_at: '2026-04-27T17:31:07.519123Z', source_provenance: { contract: 'photos_cached_preview_v1',
      rendition_kind: 'cached_preview', photos_asset_uuid: asset, rendition_sha256: hash,
      captured_at: '2026-04-27T17:31:07.519123Z' } };
  const plan = { records: [{ payload: { p_payload: p }, local_cached_preview: p.source_path,
    storage_bucket: 'vehicle-photos', storage_upsert: false, storage_path: path,
    privacy_review: { disposition: 'publishable_work_evidence', source_sha256: hash,
      reviewer: 'synthetic-test', reviewed_at: '2026-11-15T12:00:00Z' } }] };
  const state = { rows: [], uploads: 0, admissions: 0, stored: null, deployed: true,
    lostAdmissionResponse: false, lostUploadResponse: false };
  const bucket = { getPublicUrl: value => ({ data: { publicUrl: `https://example.test/${value}` } }),
    upload: async (_path, value) => { state.uploads++; state.stored = value;
      return { error: state.lostUploadResponse ? { message: 'timeout' } : null }; },
    download: async () => ({ data: new Blob([state.stored]), error: null }) };
  const sb = { storage: { from: () => bucket }, from: () => {
    const query = { select: () => query, eq: () => query, limit: async () => ({ data: structuredClone(state.rows), error: null }) };
    return query;
  }, rpc: async name => {
    if (name === 'attribute_testimony') return { error: { message: state.deployed ? 'invalid_reviewed_filing_proof' : 'function not found' } };
    state.admissions++;
    const row = { id: '30000000-0000-4000-8000-000000000001', image_url: p.image_url,
      storage_path: path, taken_at: p.taken_at, exif_data: { source_rendition: p.source_provenance },
      ai_scan_metadata: { processing_policy: { mode: 'subscription_review' } },
      is_superseded: false, superseded_by: null, is_sensitive: false };
    state.rows = [structuredClone(row)];
    return state.lostAdmissionResponse ? { error: { message: 'timeout' } } : { data: { image_id: row.id } };
  } };
  return { sb, plan, p, state, options: { userId, readBytes: async () => bytes, apply: true } };
}

test('reviewed intake reconciles an admitted source on replay without another upload or admission', async () => {
  const f = reviewedFixture();
  const first = await ingestReviewedRenditions(f.sb, f.plan, f.options);
  const second = await ingestReviewedRenditions(f.sb, f.plan, f.options);
  assert.equal(first.results[0].image_id, second.results[0].image_id);
  assert.equal(f.state.uploads, 1); assert.equal(f.state.admissions, 1);
  assert.equal(first.results[0].consumer_verified, false);
});

test('reviewed intake reconciles transport failures after committed storage and admission', async () => {
  const f = reviewedFixture(); f.state.lostUploadResponse = true; f.state.lostAdmissionResponse = true;
  const result = await ingestReviewedRenditions(f.sb, f.plan, f.options);
  assert.equal(result.results[0].phase, 'source_verified');
  assert.equal(f.state.uploads, 1); assert.equal(f.state.admissions, 1);
});

test('reviewed intake refuses absent deployment, changed local bytes and unreviewed privacy before upload', async () => {
  for (const mutate of [f => { f.state.deployed = false; },
    f => { f.options.readBytes = async () => Buffer.from('changed'); },
    f => { f.plan.records[0].privacy_review.disposition = 'private'; }]) {
    const f = reviewedFixture(); mutate(f);
    await assert.rejects(ingestReviewedRenditions(f.sb, f.plan, f.options));
    assert.equal(f.state.uploads, 0); assert.equal(f.state.admissions, 0);
  }
});

test('reviewed intake rejects a superseded row and microsecond clock drift on replay', async () => {
  for (const mutate of [row => { row.superseded_by = '40000000-0000-4000-8000-000000000001'; },
    row => { row.taken_at = '2026-04-27T17:31:07.519124Z'; }]) {
    const f = reviewedFixture(); await ingestReviewedRenditions(f.sb, f.plan, f.options);
    mutate(f.state.rows[0]);
    await assert.rejects(ingestReviewedRenditions(f.sb, f.plan, f.options), /existing_rendition_conflict/);
    assert.equal(f.state.admissions, 1);
  }
});

test('reviewed dry-run validates bytes but writes nothing', async () => {
  const f = reviewedFixture();
  const result = await ingestReviewedRenditions(f.sb, f.plan, { ...f.options, apply: false });
  assert.equal(result.mode, 'dry_run'); assert.equal(f.state.uploads, 0); assert.equal(f.state.admissions, 0);
});
