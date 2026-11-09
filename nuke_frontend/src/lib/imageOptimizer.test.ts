import { describe, expect, it } from 'vitest';
import { getLightboxImageUrl } from './imageOptimizer';

describe('lightbox capture display', () => {
  it.each(['HEIC', 'heif'])('renders a public %s capture without cropping either dimension', extension => {
    const source = `https://synthetic.supabase.co/storage/v1/object/public/photos/a%20b.${extension}?download=original`;
    const result = new URL(getLightboxImageUrl(source));
    expect(result.pathname).toBe(`/storage/v1/render/image/public/photos/a%20b.${extension}`);
    expect(Object.fromEntries(result.searchParams)).toEqual({ download: 'original', width: '1800', height: '1800', quality: '90', resize: 'contain', format: 'origin' });
    expect(source).toContain('/object/public/');
  });
  it.each([
    'https://synthetic.supabase.co/storage/v1/object/public/photos/photo.jpg',
    'https://synthetic.supabase.co/storage/v1/object/sign/photos/photo.HEIC?token=synthetic',
    'https://synthetic.supabase.co/storage/v1/render/image/public/photos/photo.HEIC?width=900&resize=contain',
    'https://images.test/photo.HEIC',
    'https://synthetic.supabase.co.untrusted.test/storage/v1/object/public/photos/photo.HEIC',
    'data:image/jpeg;base64,synthetic',
    '/photos/photo.HEIC',
  ])('preserves already displayable, private and external source %s', source => {
    expect(getLightboxImageUrl(source)).toBe(source);
  });
});
