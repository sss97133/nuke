-- Schema Safety Utilities
-- This file contains helper functions to make database migrations safer
-- and prevent issues like those encountered with the team_members.status column

-- Function to check if a column exists in a table
CREATE OR REPLACE FUNCTION column_exists(
  schema_name TEXT,
  table_name TEXT,
  column_name TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
  exists_check BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = schema_name
    AND table_name = table_name
    AND column_name = column_name
  ) INTO exists_check;
  
  RETURN exists_check;
END;
$$;

-- Function to safely add a column (only if it doesn't exist)
CREATE OR REPLACE FUNCTION safely_add_column(
  schema_name TEXT,
  table_name TEXT,
  column_name TEXT,
  column_type TEXT,
  default_value TEXT DEFAULT NULL,
  nullable BOOLEAN DEFAULT TRUE
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  column_exists BOOLEAN;
  sql_statement TEXT;
BEGIN
  -- Check if column already exists
  SELECT column_exists(schema_name, table_name, column_name) INTO column_exists;
  
  -- If the column doesn't exist, add it
  IF NOT column_exists THEN
    sql_statement := format('ALTER TABLE %I.%I ADD COLUMN %I %s', 
                           schema_name, table_name, column_name, column_type);
    
    -- Add default value if provided
    IF default_value IS NOT NULL THEN
      sql_statement := sql_statement || format(' DEFAULT %s', default_value);
    END IF;
    
    -- Add NOT NULL constraint if not nullable
    IF NOT nullable THEN
      sql_statement := sql_statement || ' NOT NULL';
    END IF;
    
    -- Execute the SQL
    EXECUTE sql_statement;
    
    -- Log the action
    RAISE NOTICE 'Added column %.%.% of type %', 
                 schema_name, table_name, column_name, column_type;
  ELSE
    RAISE NOTICE 'Column %.%.% already exists, skipping', 
                schema_name, table_name, column_name;
  END IF;
END;
$$;

-- Function to safely update values in a column based on a condition
CREATE OR REPLACE FUNCTION safely_update_column_values(
  schema_name TEXT,
  table_name TEXT,
  column_name TEXT,
  new_value TEXT,
  condition TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  column_exists BOOLEAN;
  sql_statement TEXT;
  affected_rows INTEGER;
BEGIN
  -- Check if column exists
  SELECT column_exists(schema_name, table_name, column_name) INTO column_exists;
  
  -- Only proceed if the column exists
  IF column_exists THEN
    sql_statement := format('UPDATE %I.%I SET %I = %s', 
                           schema_name, table_name, column_name, new_value);
    
    -- Add condition if provided
    IF condition IS NOT NULL THEN
      sql_statement := sql_statement || format(' WHERE %s', condition);
    END IF;
    
    -- Execute the SQL and get affected rows
    EXECUTE sql_statement;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    
    -- Log the action
    RAISE NOTICE 'Updated % rows in %.%.%', 
                 affected_rows, schema_name, table_name, column_name;
  ELSE
    RAISE NOTICE 'Column %.%.% does not exist, skipping update', 
                schema_name, table_name, column_name;
  END IF;
END;
$$;

-- Function to safely add an enum type if it doesn't exist
CREATE OR REPLACE FUNCTION safely_create_enum_type(
  type_name TEXT,
  enum_values TEXT[]
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  type_exists BOOLEAN;
  enum_values_str TEXT;
BEGIN
  -- Check if type already exists
  SELECT EXISTS (
    SELECT 1 
    FROM pg_type 
    WHERE typname = type_name
  ) INTO type_exists;
  
  -- If the type doesn't exist, create it
  IF NOT type_exists THEN
    -- Convert array to comma-separated string
    SELECT array_to_string(
      array(
        SELECT quote_literal(v)
        FROM unnest(enum_values) AS v
      ), 
      ', '
    ) INTO enum_values_str;
    
    -- Create the enum type
    EXECUTE format('CREATE TYPE %I AS ENUM (%s)', type_name, enum_values_str);
    
    RAISE NOTICE 'Created enum type % with values: %', type_name, enum_values_str;
  ELSE
    RAISE NOTICE 'Enum type % already exists, skipping', type_name;
  END IF;
END;
$$;

-- Example usage:
-- SELECT safely_add_column('public', 'team_members', 'status', 'TEXT', '''active''');
-- SELECT safely_update_column_values('public', 'team_members', 'status', '''active''', 'status IS NULL');
-- SELECT safely_create_enum_type('member_status', ARRAY['active', 'inactive', 'pending']);
