import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIdentityFirstPayload, personalLibraryStoragePath } from './ingest-image-identity-payload.mjs';

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
