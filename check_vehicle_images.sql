-- Check if vehicle has images
SELECT 
  vi.id,
  vi.image_url,
  vi.is_primary,
  vi.created_at,
  vi.is_document
FROM vehicle_images vi
WHERE vi.vehicle_id = 'c1b04f00-7abf-4e1c-afd2-43fba17a6a1b'
ORDER BY vi.is_primary DESC, vi.created_at DESC
LIMIT 10;
