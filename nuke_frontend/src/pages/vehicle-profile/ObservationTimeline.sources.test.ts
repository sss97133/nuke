import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ from: vi.fn(), source: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { from: mocks.from } }));
vi.mock('../../lib/vehicleImageColumns', () => ({ vehicleImageGallerySource: mocks.source }));
vi.mock('./VehicleProfileContext', () => ({ useVehicleProfile: vi.fn() }));
import { withCurrentImageSources } from './ObservationTimeline';

const attached = '00000000-0000-4000-8000-000000000001';
const unfiled = '00000000-0000-4000-8000-000000000002';
const moved = '00000000-0000-4000-8000-000000000003';
const hidden = '00000000-0000-4000-8000-000000000004';
const rows = [
  { id: 'retained-photo-description', structured_data: { image_id: attached } },
  { id: 'unfiled-photo-description', structured_data: { image_id: unfiled } },
  { id: 'moved-photo-description', structured_data: { image_id: moved } },
  { id: 'private-photo-description', structured_data: { image_id: hidden } },
  { id: 'receipt-work', structured_data: { receipt_id: 'receipt' } },
  { id: 'listing', structured_data: null },
];

function reader(error: unknown = null) {
  const sourceRows = [
    { id: attached, vehicle_id: 'vehicle', vehicle_image_gallery_eligible: true },
    { id: unfiled, vehicle_id: null, vehicle_image_gallery_eligible: true },
    { id: moved, vehicle_id: 'other-vehicle', vehicle_image_gallery_eligible: true },
    { id: hidden, vehicle_id: 'vehicle', vehicle_image_gallery_eligible: false },
  ];
  let filtered = sourceRows;
  const query: any = {
    select: vi.fn(() => query),
    eq: vi.fn((key, value) => { filtered = filtered.filter(row => (row as any)[key] === value); return query; }),
    in: vi.fn((key, values) => { filtered = filtered.filter(row => values.includes((row as any)[key])); return query; }),
    then: (resolve: any) => resolve({ data: error ? null : filtered.map(({ id }) => ({ id })), error }),
  };
  mocks.from.mockReturnValue(query);
  return query;
}

beforeEach(() => { vi.clearAllMocks(); mocks.source.mockResolvedValue('vehicle_images_public'); });

describe('observation image source withdrawal', () => {
  it('retains attached evidence and non-image records, withholding unfiled, moved and ineligible sources', async () => {
    const query = reader();
    const result = await withCurrentImageSources('vehicle', rows);
    expect(result.map(row => row.id)).toEqual(['retained-photo-description', 'receipt-work', 'listing']);
    expect(mocks.from).toHaveBeenCalledWith('vehicle_images_public');
    expect(query.select).toHaveBeenCalledWith('id');
    expect(query.in).toHaveBeenCalledWith('id', [attached, unfiled, moved, hidden]);
    expect(rows).toHaveLength(6); // Testimony is not mutated by the reader.
  });

  it('uses the same eligibility check for a signed-in viewer', async () => {
    mocks.source.mockResolvedValue('vehicle_images');
    reader();
    expect((await withCurrentImageSources('vehicle', rows)).map(row => row.id))
      .toEqual(['retained-photo-description', 'receipt-work', 'listing']);
    expect(mocks.from).toHaveBeenCalledWith('vehicle_images');
  });

  it('does not equate inaccessible sources with an attribution to another vehicle', async () => {
    const query = reader();
    query.then = (resolve: any) => resolve({ data: [], error: null });
    expect(await withCurrentImageSources('vehicle', rows)).toEqual(rows.slice(4));
  });

  it('keeps receipt and listing records when image qualification fails', async () => {
    reader({ message: 'source read unavailable' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await withCurrentImageSources('vehicle', rows)).toEqual(rows.slice(4));
    warn.mockRestore();
  });

  it('does not query images for records without image citations', async () => {
    expect(await withCurrentImageSources('vehicle', rows.slice(4))).toEqual(rows.slice(4));
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('does not send malformed references to the image query', async () => {
    const malformed = [{ id: 'bad', structured_data: { image_id: '../../elsewhere' } }];
    expect(await withCurrentImageSources('vehicle', malformed)).toEqual([]);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
