import { beforeEach, describe, expect, it, vi } from 'vitest';

// A recorder in place of the client: which bucket and path the bytes go to, and the row that lands after them.
const calls = vi.hoisted(() => ({ uploads: [] as Array<{ bucket: string; path: string }>, rows: [] as any[], uploadError: null as any, existing: null as any, insertError: null as any, ors: [] as string[], ins: [] as string[][] }));
const uid = '11111111-1111-4111-8111-111111111111';

vi.mock('../lib/supabase', () => {
  const chain = (result: any): any => new Proxy({}, {
    get: (_t, key) => key === 'then' ? (resolve: any) => resolve(result)
      : key === 'maybeSingle' || key === 'single' ? async () => result
      : key === 'or' ? (arg: string) => { calls.ors.push(arg); return chain(result); }
      : key === 'in' ? (_col: string, vals: string[]) => { calls.ins.push(vals); return chain(result); }
      : () => chain(result),
  });
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: uid } }, error: null }) },
      storage: {
        from: (bucket: string) => ({
          upload: async (path: string) => { calls.uploads.push({ bucket, path }); return { data: calls.uploadError ? null : { path }, error: calls.uploadError }; },
          getPublicUrl: (path: string) => ({ data: { publicUrl: `https://example.test/storage/v1/object/public/${bucket}/${path}` } }),
          remove: async () => ({ error: null }),
          createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://example.test/storage/v1/object/sign/${bucket}/${path}?token=signed` }, error: null }),
        }),
      },
      from: (_table: string) => ({
        select: (cols?: string) => chain(String(cols).includes('image_url') ? { data: calls.existing, error: null } : { data: null, error: null, count: 0 }),
        insert: (row: any) => { calls.rows.push(row); return chain(calls.insertError ? { data: null, error: calls.insertError } : { data: { id: 'row-1' }, error: null }); },
      }),
      functions: { invoke: async () => ({ error: null }) },
    },
  };
});
vi.mock('../utils/imageMetadata', () => ({ extractImageMetadata: async () => ({}) }));
vi.mock('./timelineEventService', () => ({ TimelineEventService: {} }));
vi.mock('./imageDuplicateLinker', () => ({ ImageDuplicateLinker: { checkAndLinkDuplicate: async () => ({ isDuplicate: false }) } }));
vi.mock('./documentTypeDetector', () => ({ DocumentTypeDetector: { detectFromFile: (f: File) => ({ type: f.name.includes('title') ? 'title' : 'vehicle_photo', confidence: 1, reasoning: 'test' }) } }));

import { ImageUploadService } from './imageUploadService';
import { privateStoragePath } from '../lib/privateStorage';

const photo = () => new File([new Uint8Array([1, 2, 3, 4])], 'IMG 0001.jpg', { type: 'image/jpeg' });

describe('web upload lands where iOS lands', () => {
  beforeEach(() => { calls.uploads = []; calls.rows = []; calls.uploadError = null; calls.existing = null; calls.insertError = null; calls.ors = []; calls.ins = []; });

  it('puts a photo in vehicle-photos under the caller\'s own folder, original only, then lands the row', async () => {
    const result = await ImageUploadService.uploadImage('vehicle-1', photo(), 'general');
    expect(result.success).toBe(true);
    expect(calls.uploads).toHaveLength(1);
    const [{ bucket, path }] = calls.uploads;
    expect(bucket).toBe('vehicle-photos');
    expect(path).toMatch(new RegExp(`^users/${uid}/capture-relay/[0-9a-f]{64}/IMG_0001\\.jpg$`));
    const row = calls.rows[0];
    expect(row.storage_path).toBe(path);
    expect(row.file_hash).toBe(path.split('/')[3]);
    expect(row.image_url).toBe(`https://example.test/storage/v1/object/public/vehicle-photos/${path}`);
    expect(row.vehicle_id).toBe('vehicle-1');
    expect(row.user_id).toBe(uid);
    expect(row.ai_processing_status).toBe('pending');
    expect(row.source).toBe('user_upload_web');
    expect(row.documented_by_user_id).toBe(uid);
    expect(row.exif_data.filing).toMatchObject({ basis: 'uploader_pick_at_upload', by_user_id: uid });
    expect(result.outcome).toBe('landed');
  });

  it('puts a paper in the private bucket with no public URL, held from the photo pipeline', async () => {
    const result = await ImageUploadService.uploadImage('vehicle-1', new File([new Uint8Array([9])], 'title.jpg', { type: 'image/jpeg' }), 'general');
    expect(result.success).toBe(true);
    expect(calls.uploads[0].bucket).toBe('user-documents');
    expect(calls.uploads[0].path.startsWith(`${uid}/vehicle-papers/`)).toBe(true);
    // The row names the private object; readers sign it (lib/privateStorage), the uploader gets a signed URL back.
    expect(privateStoragePath(calls.rows[0].image_url)).toEqual({ bucket: 'user-documents', path: calls.uploads[0].path });
    expect(calls.rows[0].variants).toBeNull();
    expect(calls.rows[0].is_document).toBe(true);
    expect(calls.rows[0].ai_processing_status).toBe('skipped');
    expect(result.imageUrl).toMatch(/\/object\/sign\/user-documents\/.+\?token=signed$/);
  });

  it('lands the row when the bytes are stored but no row names them (an upload cut off before its row)', async () => {
    calls.uploadError = { message: 'The resource already exists', statusCode: '409' };
    const result = await ImageUploadService.uploadImage('vehicle-1', photo(), 'general');
    expect(result.outcome).toBe('landed');
    expect(calls.rows).toHaveLength(1);
  });

  it('reports a duplicate and writes nothing when the same bytes already have a row on another car or unfiled', async () => {
    for (const existing of [{ id: 'old-1', image_url: 'u', vehicle_id: 'vehicle-2' }, { id: 'old-2', image_url: '', vehicle_id: null }]) {
      calls.existing = existing; calls.uploads = []; calls.rows = []; calls.ors = [];
      const result = await ImageUploadService.uploadImage('vehicle-1', photo(), 'general');
      expect(result).toMatchObject({ success: true, outcome: 'duplicate', imageId: existing.id, duplicateOf: existing.id });
      expect(calls.uploads).toHaveLength(0);
      expect(calls.rows).toHaveLength(0);
      expect(calls.ors[0]).toBe(`user_id.eq.${uid},vehicle_id.eq.vehicle-1`);
      expect(calls.ins[0]).toHaveLength(1); // uncompressed: the stored bytes are the original, one hash
    }
  });

  it('reports a duplicate when the picked car already holds these bytes (unique per car and hash)', async () => {
    calls.insertError = { code: '23505', message: 'duplicate key value violates unique constraint "idx_unique_vehicle_file_hash"' };
    const result = await ImageUploadService.uploadImage('vehicle-1', photo(), 'general');
    expect(result).toMatchObject({ success: true, outcome: 'duplicate' });
  });

  it('says why storage refused, and lands no row', async () => {
    calls.uploadError = { message: 'new row violates row-level security policy', statusCode: '403' };
    const result = await ImageUploadService.uploadImage('vehicle-1', photo(), 'general');
    expect(result).toEqual({ success: false, outcome: 'refused', error: 'Upload refused by storage: new row violates row-level security policy' });
    expect(calls.rows).toHaveLength(0);
  });
});
