-- Insert the missing vehicle_images record for the uploaded image
INSERT INTO vehicle_images (
  id,
  vehicle_id,
  image_url,
  storage_path,
  user_id,
  is_primary,
  category,
  position
) 
SELECT 
  '53a092f0-57b8-4147-acf3-6337c6c02f1a'::uuid,
  '7b07531f-e73a-4adb-b52c-d45922063edf'::uuid,
  'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/7b07531f-e73a-4adb-b52c-d45922063edf/53a092f0-57b8-4147-acf3-6337c6c02f1a.jpeg',
  'vehicle-images/7b07531f-e73a-4adb-b52c-d45922063edf/53a092f0-57b8-4147-acf3-6337c6c02f1a.jpeg',
  v.user_id,
  true,
  'general',
  0
FROM vehicles v
WHERE v.id = '7b07531f-e73a-4adb-b52c-d45922063edf'
AND NOT EXISTS (
  SELECT 1 FROM vehicle_images 
  WHERE id = '53a092f0-57b8-4147-acf3-6337c6c02f1a'
);
