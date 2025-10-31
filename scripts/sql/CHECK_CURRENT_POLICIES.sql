-- Check what policies currently exist on vehicles table
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual as using_expression,
  with_check as with_check_expression
FROM pg_policies 
WHERE tablename = 'vehicles'
ORDER BY policyname;

-- Also check if there are any policies on vehicle_contributors that might cause issues
SELECT 
  schemaname,
  tablename,
  policyname,
  cmd,
  qual
FROM pg_policies 
WHERE tablename = 'vehicle_contributors'
ORDER BY policyname;

