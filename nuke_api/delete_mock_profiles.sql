-- Delete mock profiles and all associated data
-- This script will cascade delete all related records

-- Delete from vehicles table (will cascade to images, timeline, documents, financial data)
DELETE FROM vehicles WHERE user_id IN (
  '08a86180-e28b-4704-97d5-a74caf16d7a2',
  '57faaf75-142a-4f9d-88d6-2b66b1902143',
  '20078313-3113-4653-8483-f370c6afa5eb',
  'ca825301-750d-42d1-88b0-744ac18404bf',
  'ad4ca0c5-2e69-4de8-8e4a-4640af0672d3',
  '3ab28f07-9932-4967-b211-b207cbd1b7da'
);

-- Delete from profiles table (if it exists)
DELETE FROM profiles WHERE id IN (
  '08a86180-e28b-4704-97d5-a74caf16d7a2',
  '57faaf75-142a-4f9d-88d6-2b66b1902143',
  '20078313-3113-4653-8483-f370c6afa5eb',
  'ca825301-750d-42d1-88b0-744ac18404bf',
  'ad4ca0c5-2e69-4de8-8e4a-4640af0672d3',
  '3ab28f07-9932-4967-b211-b207cbd1b7da'
);

-- Clean up any orphaned timeline events
DELETE FROM vehicle_timeline WHERE creator_id IN (
  '08a86180-e28b-4704-97d5-a74caf16d7a2',
  '57faaf75-142a-4f9d-88d6-2b66b1902143',
  '20078313-3113-4653-8483-f370c6afa5eb',
  'ca825301-750d-42d1-88b0-744ac18404bf',
  'ad4ca0c5-2e69-4de8-8e4a-4640af0672d3',
  '3ab28f07-9932-4967-b211-b207cbd1b7da'
);

-- Clean up any financial records created by these users
DELETE FROM vehicle_financial_transactions WHERE recorded_by IN (
  '08a86180-e28b-4704-97d5-a74caf16d7a2',
  '57faaf75-142a-4f9d-88d6-2b66b1902143',
  '20078313-3113-4653-8483-f370c6afa5eb',
  'ca825301-750d-42d1-88b0-744ac18404bf',
  'ad4ca0c5-2e69-4de8-8e4a-4640af0672d3',
  '3ab28f07-9932-4967-b211-b207cbd1b7da'
);

-- Clean up any cost basis records created by these users
DELETE FROM vehicle_cost_basis WHERE recorded_by IN (
  '08a86180-e28b-4704-97d5-a74caf16d7a2',
  '57faaf75-142a-4f9d-88d6-2b66b1902143',
  '20078313-3113-4653-8483-f370c6afa5eb',
  'ca825301-750d-42d1-88b0-744ac18404bf',
  'ad4ca0c5-2e69-4de8-8e4a-4640af0672d3',
  '3ab28f07-9932-4967-b211-b207cbd1b7da'
);

-- Clean up any valuation records created by these users
DELETE FROM vehicle_valuations WHERE recorded_by IN (
  '08a86180-e28b-4704-97d5-a74caf16d7a2',
  '57faaf75-142a-4f9d-88d6-2b66b1902143',
  '20078313-3113-4653-8483-f370c6afa5eb',
  'ca825301-750d-42d1-88b0-744ac18404bf',
  'ad4ca0c5-2e69-4de8-8e4a-4640af0672d3',
  '3ab28f07-9932-4967-b211-b207cbd1b7da'
);