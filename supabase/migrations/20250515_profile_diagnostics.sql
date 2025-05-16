-- Create a function to get table columns for diagnostic purposes
CREATE OR REPLACE FUNCTION public.get_table_columns(table_name text)
RETURNS TABLE (
    column_name text,
    data_type text,
    is_nullable boolean
) LANGUAGE sql SECURITY DEFINER
AS $$
    SELECT 
        column_name::text,
        data_type::text,
        (is_nullable = 'YES')::boolean as is_nullable
    FROM 
        information_schema.columns
    WHERE 
        table_schema = 'public'
        AND table_name = $1
    ORDER BY 
        ordinal_position;
$$;

-- Grant access to the function
GRANT EXECUTE ON FUNCTION public.get_table_columns TO anon, authenticated, service_role;

-- Function to check and fix missing profile for a user
CREATE OR REPLACE FUNCTION public.ensure_user_profile(user_uuid uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    profile_exists boolean;
    profile_record jsonb;
BEGIN
    -- Check if profile exists
    SELECT EXISTS(
        SELECT 1 FROM public.profiles 
        WHERE id = user_uuid
    ) INTO profile_exists;
    
    -- If profile doesn't exist, create one
    IF NOT profile_exists THEN
        INSERT INTO public.profiles (
            id,
            username,
            onboarding_completed,
            onboarding_step,
            created_at,
            updated_at
        ) VALUES (
            user_uuid,
            'user_' || floor(random() * 10000)::text,
            false,
            0,
            now(),
            now()
        )
        RETURNING to_jsonb(profiles.*) INTO profile_record;
        
        RETURN jsonb_build_object(
            'created', true,
            'profile', profile_record
        );
    ELSE
        -- Profile exists, return it
        SELECT to_jsonb(profiles.*) FROM public.profiles 
        WHERE id = user_uuid INTO profile_record;
        
        RETURN jsonb_build_object(
            'created', false,
            'profile', profile_record
        );
    END IF;
END;
$$;

-- Grant access to the function
GRANT EXECUTE ON FUNCTION public.ensure_user_profile TO authenticated, service_role;

-- Create a function to force redirect state for debugging
CREATE OR REPLACE FUNCTION public.debug_force_redirect_to(user_uuid uuid, destination text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    result jsonb;
BEGIN
    -- Simple function to help with debugging navigation issues
    -- Can be called from the client to force a redirection state
    
    RETURN jsonb_build_object(
        'success', true,
        'redirect_to', destination,
        'user_id', user_uuid,
        'timestamp', now()
    );
END;
$$;

-- Grant access to the function
GRANT EXECUTE ON FUNCTION public.debug_force_redirect_to TO authenticated, service_role;
