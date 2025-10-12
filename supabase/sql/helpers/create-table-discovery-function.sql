-- Create a function to get all tables in the database
-- Run this in your Supabase SQL editor

CREATE OR REPLACE FUNCTION get_all_tables()
RETURNS TABLE (
  table_name text,
  table_type text,
  row_count bigint,
  column_count integer
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.table_name::text,
    t.table_type::text,
    COALESCE(c.reltuples::bigint, 0) as row_count,
    COALESCE(col.column_count, 0) as column_count
  FROM information_schema.tables t
  LEFT JOIN pg_class c ON c.relname = t.table_name
  LEFT JOIN (
    SELECT 
      table_name,
      COUNT(*) as column_count
    FROM information_schema.columns 
    WHERE table_schema = 'public'
    GROUP BY table_name
  ) col ON col.table_name = t.table_name
  WHERE t.table_schema = 'public'
  AND t.table_type = 'BASE TABLE'
  ORDER BY t.table_name;
END;
$$;

-- Create a function to get detailed table information
CREATE OR REPLACE FUNCTION get_table_details(p_table_name text DEFAULT NULL)
RETURNS TABLE (
  table_name text,
  column_name text,
  data_type text,
  is_nullable text,
  column_default text,
  character_maximum_length integer
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.table_name::text,
    c.column_name::text,
    c.data_type::text,
    c.is_nullable::text,
    c.column_default::text,
    c.character_maximum_length
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
  AND (p_table_name IS NULL OR c.table_name = p_table_name)
  ORDER BY c.table_name, c.ordinal_position;
END;
$$;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION get_all_tables() TO authenticated;
GRANT EXECUTE ON FUNCTION get_table_details(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_all_tables() TO anon;
GRANT EXECUTE ON FUNCTION get_table_details(text) TO anon;

-- Test the functions
-- SELECT * FROM get_all_tables();
-- SELECT * FROM get_table_details('profiles'); 