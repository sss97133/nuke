import { describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: session.current } }) } },
}));

import { vehicleImageColumnsForViewer, vehicleImageGallerySource } from './vehicleImageColumns';

describe('signed-out image reads', () => {
  it('drops withheld columns, including aliased JSON projections of them', async () => {
    session.current = null;
    const out = await vehicleImageColumnsForViewer(
      'id, image_url, exif_data, latitude, exif_camera:exif_data->camera, exif_location:exif_data->location, ai_tier1:ai_scan_metadata->tier_1_analysis, taken_at',
    );
    expect(out).toBe('id, image_url, ai_tier1:ai_scan_metadata->tier_1_analysis, taken_at');
  });

  it('reads the view signed out and the table signed in; signed-in keeps every column', async () => {
    session.current = null;
    expect(await vehicleImageGallerySource()).toBe('vehicle_images_public');
    session.current = { user: { id: 'u' } };
    expect(await vehicleImageGallerySource()).toBe('vehicle_images');
    expect(await vehicleImageColumnsForViewer('id, exif_data')).toBe('id, exif_data');
  });
});
