import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UPLOADER_PICK_BASIS, WEB_IMAGE_SOURCE, webImageRow, type WebImageRowInput } from './webImageRow';

// The iOS row is the definition: VehicleImageRow in the capture app. This test reads its stored properties and fails
// when the web row and the iOS row diverge in columns. A difference is allowed only when it is listed here.
const swift = readFileSync(resolve(__dirname, '../../../apps/nuke-capture-ios/Sources/NukeCapture/SupabaseService.swift'), 'utf8');

function swiftFields(structName: string): string[] {
  const start = swift.indexOf(`struct ${structName}`);
  if (start < 0) throw new Error(`struct ${structName} not found in SupabaseService.swift`);
  const body = swift.slice(swift.indexOf('{', start) + 1);
  const fields: string[] = [];
  let depth = 0;
  for (const line of body.split('\n')) {
    if (depth === 0) {
      const m = line.match(/^\s*(?:let|var)\s+([a-z_]+)\s*:/);
      if (m) fields.push(m[1]);
    }
    depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
    if (depth < 0) break;
  }
  return fields;
}

/** iOS columns the web does not write, with why: the browser cannot witness them. */
const IOS_ONLY = { apple_ml_labels: 'on-device Apple Vision labels; a browser has no Vision model' };
/** Columns only the web form writes. */
const WEB_ONLY = [
  'vehicle_id', 'filename', 'category', 'perceptual_hash', 'dhash', 'duplicate_of', 'is_duplicate', 'is_primary',
  'is_sensitive', 'variants', 'is_document', 'document_category', 'document_classification', 'organization_status',
];
/** exif_data keys iOS writes that a browser cannot witness. */
const IOS_ONLY_EXIF = { uuid: 'PHAsset identifier', source_type: 'PHAsset source type', owner_verified: 'read from the iPhone camera make' };

const input = (over: Partial<WebImageRowInput> = {}): WebImageRowInput => ({
  userId: 'u1', vehicleId: null, publicUrl: 'https://x/p.jpg', storagePath: 'users/u1/capture-relay/abc/p.jpg',
  fileName: 'p.jpg', originalFilename: 'p.jpg', fileSize: 10, mimeType: 'image/jpeg', fileHash: 'abc',
  latitude: null, longitude: null, takenAt: null, exif: {}, cameraMake: null, cameraModel: null, isPaper: false,
  aiProcessingStatus: 'pending', nowIso: '2026-11-25T12:00:00.000Z',
  web: { category: 'general', perceptualHash: null, dhash: null, duplicateOf: null, isPrimary: false, isDocument: false, documentCategory: null, documentClassification: null },
  ...over,
});

describe('web upload row = iOS capture row', () => {
  it('has every iOS column except the listed ones, and no unlisted column of its own', () => {
    const ios = swiftFields('VehicleImageRow');
    expect(ios).toContain('documented_by_user_id');
    const web = Object.keys(webImageRow(input()));
    const missing = ios.filter((c) => !web.includes(c) && !(c in IOS_ONLY));
    const extra = web.filter((c) => !ios.includes(c) && !WEB_ONLY.includes(c));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    for (const c of Object.keys(IOS_ONLY)) expect(ios).toContain(c); // a stale exception fails too
  });

  it('carries the iOS exif_data keys a browser can witness', () => {
    const iosExif = swiftFields('ExifData');
    const exif = webImageRow(input()).exif_data as Record<string, unknown>;
    const missing = iosExif.filter((k) => !(k in exif) && !(k in IOS_ONLY_EXIF));
    expect(missing).toEqual([]);
    for (const k of Object.keys(IOS_ONLY_EXIF)) expect(iosExif).toContain(k);
  });

  it('marks the source, the documenter, and how a picked car was filed', () => {
    const unfiled = webImageRow(input());
    expect(unfiled).toMatchObject({ source: WEB_IMAGE_SOURCE, documented_by_user_id: 'u1', is_external: false, vehicle_id: null, organization_status: 'unorganized' });
    expect((unfiled.exif_data as Record<string, unknown>).filing).toBeUndefined();
    const picked = webImageRow(input({ vehicleId: 'v1' }));
    expect(picked.vehicle_id).toBe('v1');
    expect((picked.exif_data as Record<string, unknown>).filing).toEqual({ basis: UPLOADER_PICK_BASIS, by_user_id: 'u1', at: '2026-11-25T12:00:00.000Z' });
    expect(webImageRow(input({ isPaper: true, publicUrl: '' })).variants).toBeNull();
  });
});
