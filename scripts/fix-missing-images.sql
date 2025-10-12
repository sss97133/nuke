-- Fix missing vehicle images in database
-- These images exist in storage but are missing database records

INSERT INTO vehicle_images (
  vehicle_id, 
  image_url, 
  user_id, 
  category, 
  file_name, 
  file_size, 
  mime_type, 
  storage_path,
  caption
) VALUES 
(
  'e7ed3e29-456a-43ea-843d-2dc0468ea4ca',
  'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/e7ed3e29-456a-43ea-843d-2dc0468ea4ca/562e3e9e-1cdf-4081-bc98-4b9ce473284a.jpeg',
  '0b9f107a-d124-49de-9ded-94698f63c1c4',
  'exterior',
  '562e3e9e-1cdf-4081-bc98-4b9ce473284a.jpeg',
  2882447,
  'image/jpeg',
  'e7ed3e29-456a-43ea-843d-2dc0468ea4ca/562e3e9e-1cdf-4081-bc98-4b9ce473284a.jpeg',
  'Retroactively added image 1'
),
(
  'e7ed3e29-456a-43ea-843d-2dc0468ea4ca',
  'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/e7ed3e29-456a-43ea-843d-2dc0468ea4ca/7c71578a-a349-42a1-804e-9c67cc2d512e.jpeg',
  '0b9f107a-d124-49de-9ded-94698f63c1c4',
  'exterior',
  '7c71578a-a349-42a1-804e-9c67cc2d512e.jpeg',
  3011155,
  'image/jpeg',
  'e7ed3e29-456a-43ea-843d-2dc0468ea4ca/7c71578a-a349-42a1-804e-9c67cc2d512e.jpeg',
  'Retroactively added image 2'
),
(
  'e7ed3e29-456a-43ea-843d-2dc0468ea4ca',
  'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/e7ed3e29-456a-43ea-843d-2dc0468ea4ca/caa2b755-0b31-4b87-a0b5-e2d96de191ae.jpeg',
  '0b9f107a-d124-49de-9ded-94698f63c1c4',
  'exterior',
  'caa2b755-0b31-4b87-a0b5-e2d96de191ae.jpeg',
  3182816,
  'image/jpeg',
  'e7ed3e29-456a-43ea-843d-2dc0468ea4ca/caa2b755-0b31-4b87-a0b5-e2d96de191ae.jpeg',
  'Retroactively added image 3'
),
(
  'e7ed3e29-456a-43ea-843d-2dc0468ea4ca',
  'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/e7ed3e29-456a-43ea-843d-2dc0468ea4ca/fb9c4882-b7ff-49fa-b564-0810e2a93fec.jpeg',
  '0b9f107a-d124-49de-9ded-94698f63c1c4',
  'exterior',
  'fb9c4882-b7ff-49fa-b564-0810e2a93fec.jpeg',
  2826167,
  'image/jpeg',
  'e7ed3e29-456a-43ea-843d-2dc0468ea4ca/fb9c4882-b7ff-49fa-b564-0810e2a93fec.jpeg',
  'Retroactively added image 4'
);

-- Verify the inserts worked
SELECT 
  id, 
  file_name, 
  category, 
  created_at 
FROM vehicle_images 
WHERE vehicle_id = 'e7ed3e29-456a-43ea-843d-2dc0468ea4ca';
