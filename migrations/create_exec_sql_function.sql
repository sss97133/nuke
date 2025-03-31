-- Create a stored procedure that only authenticated users with proper permissions can run
-- This enables running SQL statements from the client without exposing full DB access

CREATE OR REPLACE FUNCTION exec_sql(sql_query TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER -- Runs with the permissions of the function creator (you)
AS $$
BEGIN
  -- Only allow this to run in authenticated context
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be authenticated to run SQL';
  END IF;
  
  -- Check if the user has admin rights (you'll need to determine how to identify admins)
  -- For example, check if they're in an admin table or have a specific role
  IF NOT EXISTS (
    SELECT 1 FROM auth.users 
    WHERE id = auth.uid() 
    AND email IN ('your-admin-email@example.com') -- Replace with your actual admin email
  ) THEN
    RAISE EXCEPTION 'Only admins can execute migrations';
  END IF;
  
  -- Execute the SQL (since all checks passed)
  EXECUTE sql_query;
END;
$$;
