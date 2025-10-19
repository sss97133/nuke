-- Database Audit Script
-- Run this in Supabase SQL Editor to see what tables/functions actually exist

-- 1. List all tables
SELECT 
  schemaname as schema,
  tablename as table_name,
  rowsecurity as rls_enabled
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY tablename;

-- 2. List all functions
SELECT 
  n.nspname as schema,
  p.proname as function_name,
  pg_get_function_result(p.oid) as return_type
FROM pg_proc p
LEFT JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
ORDER BY p.proname;

-- 3. List all RLS policies
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 4. List all triggers
SELECT 
  event_object_table as table_name,
  trigger_name,
  event_manipulation as event,
  action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;

-- 5. Check for missing critical tables
SELECT 
  table_name,
  CASE 
    WHEN EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = table_name) 
    THEN 'EXISTS' 
    ELSE 'MISSING' 
  END as status
FROM (VALUES 
  ('vehicles'),
  ('profiles'),
  ('vehicle_images'),
  ('timeline_events'),
  ('user_credits'),
  ('credit_transactions'),
  ('vehicle_support'),
  ('builder_payouts'),
  ('work_sessions'),
  ('receipts'),
  ('user_tools'),
  ('shops'),
  ('shop_members')
) AS t(table_name);

