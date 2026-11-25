import { beforeEach, describe, expect, it, vi } from 'vitest';

// A recorder in place of the client: which bucket and path the bytes go to, and the row that lands after them.
const calls = vi.hoisted(() => ({ uploads: [] as Array<{ bucket: string; path: string }>, rows: [] as any[], uploadError: null as any }));
const uid = '11111111-1111-4111-8111-111111111111';

vi.mock('../lib/supabase', () => {
  const chain = (result: any): any => new Proxy({}, {
    get: (_t, key) => key === 'then' ? (resolve: any) => resolve(result)
      : key === 'maybeSingle' || key === 'single' ? async () => result
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
        }),
      },
      from: (_table: string) => ({
        select: () => chain({ data: null, error: null, count: 0 }),
        insert: (row: any) => { calls.rows.push(row); return chain({ data: { id: 'row-1' }, error: null }); },
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

const photo = () => new File([new Uint8Array([1, 2, 3, 4])], 'IMG 0001.jpg', { type: 'image/jpeg' });

describe('web upload lands where iOS lands', () => {
  beforeEach(() => { calls.uploads = []; calls.rows = []; calls.uploadError = null; });

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
  });

  it('puts a paper in the private bucket with no public URL, held from the photo pipeline', async () => {
    const result = await ImageUploadService.uploadImage('vehicle-1', new File([new Uint8Array([9])], 'title.jpg', { type: 'image/jpeg' }), 'general');
    expect(result.success).toBe(true);
    expect(calls.uploads[0].bucket).toBe('user-documents');
    expect(calls.uploads[0].path.startsWith(`${uid}/vehicle-papers/`)).toBe(true);
    expect(calls.rows[0].image_url).toBe('');
    expect(calls.rows[0].is_document).toBe(true);
    expect(calls.rows[0].ai_processing_status).toBe('skipped');
    expect(result.imageUrl).toBeUndefined();
  });

  it('treats the same bytes already stored as landed, and lands the row', async () => {
    calls.uploadError = { message: 'The resource already exists', statusCode: '409' };
    const result = await ImageUploadService.uploadImage('vehicle-1', photo(), 'general');
    expect(result.success).toBe(true);
    expect(calls.rows).toHaveLength(1);
  });

  it('says why storage refused, and lands no row', async () => {
    calls.uploadError = { message: 'new row violates row-level security policy', statusCode: '403' };
    const result = await ImageUploadService.uploadImage('vehicle-1', photo(), 'general');
    expect(result).toEqual({ success: false, error: 'Upload refused by storage: new row violates row-level security policy' });
    expect(calls.rows).toHaveLength(0);
  });
});
