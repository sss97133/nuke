-- Fix search_path vulnerabilities for all SECURITY DEFINER functions
-- This migration sets search_path = '' for all SECURITY DEFINER functions
-- to prevent search path injection attacks (CWE-470)

-- Fix all SECURITY DEFINER functions that don't have search_path = '' set
DO $$
DECLARE
    func_record RECORD;
    func_signature TEXT;
    has_secure_search_path BOOLEAN;
BEGIN
    -- Loop through all SECURITY DEFINER functions in public schema
    FOR func_record IN
        SELECT 
            p.oid,
            p.proname as function_name,
            pg_get_function_identity_arguments(p.oid) as arguments,
            n.nspname as schema_name,
            p.proconfig as config
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
          AND p.prosecdef = true  -- Only SECURITY DEFINER functions
    LOOP
        -- Check if search_path='' is already set
        has_secure_search_path := false;
        
        IF func_record.config IS NOT NULL THEN
            -- Check if any config entry is 'search_path='
            FOR func_signature IN SELECT unnest(func_record.config) LOOP
                IF func_signature = 'search_path=' THEN
                    has_secure_search_path := true;
                    EXIT;
                END IF;
            END LOOP;
        END IF;
        
        -- If search_path='' is not set, set it
        IF NOT has_secure_search_path THEN
            BEGIN
                EXECUTE format(
                    'ALTER FUNCTION %I.%I(%s) SET search_path = ''''',
                    func_record.schema_name,
                    func_record.function_name,
                    func_record.arguments
                );
                RAISE NOTICE 'Fixed search_path for function: %.%(%)', 
                    func_record.schema_name,
                    func_record.function_name,
                    func_record.arguments;
            EXCEPTION WHEN others THEN
                -- Log but don't fail the migration for functions that might not exist or have issues
                RAISE WARNING 'Could not fix search_path for function: %.%(%) - %', 
                    func_record.schema_name,
                    func_record.function_name,
                    func_record.arguments,
                    SQLERRM;
            END;
        END IF;
    END LOOP;
END $$;

-- Also fix any functions that have search_path=public (which is still vulnerable)
-- by explicitly resetting and setting to empty
DO $$
DECLARE
    func_record RECORD;
BEGIN
    FOR func_record IN
        SELECT 
            p.proname as function_name,
            pg_get_function_identity_arguments(p.oid) as arguments,
            n.nspname as schema_name
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
          AND p.prosecdef = true
          AND p.proconfig @> ARRAY['search_path=public']::text[]
    LOOP
        BEGIN
            -- Reset the search_path first, then set to empty
            EXECUTE format(
                'ALTER FUNCTION %I.%I(%s) SET search_path = ''''',
                func_record.schema_name,
                func_record.function_name,
                func_record.arguments
            );
            RAISE NOTICE 'Fixed search_path from public to empty for function: %.%(%)', 
                func_record.schema_name,
                func_record.function_name,
                func_record.arguments;
        EXCEPTION WHEN others THEN
            RAISE WARNING 'Could not fix search_path for function: %.%(%) - %', 
                func_record.schema_name,
                func_record.function_name,
                func_record.arguments,
                SQLERRM;
        END;
    END LOOP;
END $$;

