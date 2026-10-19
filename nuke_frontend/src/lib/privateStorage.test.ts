import { describe, expect, it, vi } from 'vitest';

const createSignedUrl = vi.fn();
vi.mock('./supabase', () => ({ supabase: { storage: { from: () => ({ createSignedUrl }) } } }));

import { privateStoragePath, signPrivateStorageUrl } from './privateStorage';

const base = 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object';

describe('privateStoragePath', () => {
  it('finds the bucket and path of a stored public URL to a private document bucket', () => {
    expect(privateStoragePath(`${base}/public/deal-documents/documents/2026/a%20b.jpg`))
      .toEqual({ bucket: 'deal-documents', path: 'documents/2026/a b.jpg' });
    expect(privateStoragePath(`${base}/sign/user-documents/u1/title.jpg?token=x`))
      .toEqual({ bucket: 'user-documents', path: 'u1/title.jpg' });
  });
  it('leaves public buckets and other hosts alone', () => {
    expect(privateStoragePath(`${base}/public/vehicle-images/v1/1.jpg`)).toBeNull();
    expect(privateStoragePath('https://example.invalid/doc.pdf')).toBeNull();
  });
});

describe('signPrivateStorageUrl', () => {
  it('returns a signed URL for a private document and the URL unchanged otherwise', async () => {
    createSignedUrl.mockResolvedValueOnce({ data: { signedUrl: 'https://signed.invalid/1' }, error: null });
    await expect(signPrivateStorageUrl(`${base}/public/deal-documents/d/1.jpg`)).resolves.toBe('https://signed.invalid/1');
    expect(createSignedUrl).toHaveBeenCalledWith('d/1.jpg', 3600);
    await expect(signPrivateStorageUrl(`${base}/public/vehicle-images/v/1.jpg`)).resolves.toBe(`${base}/public/vehicle-images/v/1.jpg`);
  });
  it('keeps the stored URL when signing is refused', async () => {
    createSignedUrl.mockResolvedValueOnce({ data: null, error: { message: 'not allowed' } });
    await expect(signPrivateStorageUrl(`${base}/public/user-documents/u/1.jpg`)).resolves.toBe(`${base}/public/user-documents/u/1.jpg`);
  });
});
