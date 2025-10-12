-- Debug script to discover tables - run these queries one by one in Supabase SQL editor

-- 1. Check if we can access information_schema at all
SELECT COUNT(*) as total_tables 
FROM information_schema.tables 
WHERE table_schema = 'public';

-- 2. List all schemas to see what's available
SELECT DISTINCT table_schema 
FROM information_schema.tables 
WHERE table_schema NOT IN ('information_schema', 'pg_catalog');

-- 3. Try a simpler approach - just list table names
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- 4. Check if we can access pg_tables directly
SELECT tablename 
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY tablename;

-- 5. Check current user and permissions
SELECT current_user, current_database();

-- 6. Try to list tables with more details
SELECT 
  schemaname,
  tablename,
  tableowner
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY tablename;

-- 7. Check if there are any RLS policies that might be blocking
SELECT 
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY tablename; 