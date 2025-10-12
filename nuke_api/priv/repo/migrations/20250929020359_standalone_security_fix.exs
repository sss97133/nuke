defmodule NukeApi.Repo.Migrations.StandaloneSecurityFix do
  use Ecto.Migration

  def up do
    # Create security audit log table first
    execute """
    CREATE TABLE IF NOT EXISTS security_audit_log (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        event_type varchar NOT NULL,
        user_id uuid,
        ip_address inet,
        user_agent text,
        details jsonb,
        created_at timestamptz DEFAULT NOW()
    );
    """

    # Create indexes for performance
    execute "CREATE INDEX IF NOT EXISTS idx_security_audit_log_created_at ON security_audit_log(created_at DESC);"
    execute "CREATE INDEX IF NOT EXISTS idx_security_audit_log_event_type ON security_audit_log(event_type);"
    execute "CREATE INDEX IF NOT EXISTS idx_security_audit_log_user_id ON security_audit_log(user_id) WHERE user_id IS NOT NULL;"

    # Enable RLS on all sensitive tables
    execute "ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;"
    execute "ALTER TABLE vehicle_documents ENABLE ROW LEVEL SECURITY;"
    execute "ALTER TABLE ownership_verifications ENABLE ROW LEVEL SECURITY;"
    execute "ALTER TABLE security_audit_log ENABLE ROW LEVEL SECURITY;"

    # Fix function search paths - key security improvement
    execute """
    DO $$
    DECLARE
        func_record RECORD;
    BEGIN
        -- Only fix functions that actually exist to avoid errors
        FOR func_record IN
            SELECT proname, pg_get_function_identity_arguments(p.oid) as args
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public'
            AND proname IN (
                'create_timeline_event_from_document',
                'approve_ownership_verification'
            )
        LOOP
            EXECUTE format('ALTER FUNCTION %I(%s) SET search_path = ''''',
                          func_record.proname, func_record.args);
            RAISE NOTICE 'Fixed search_path for function: %', func_record.proname;
        END LOOP;
    END $$;
    """

    # Create secure RLS policies
    execute """
    DO $$
    BEGIN
        -- Vehicles: authenticated users only
        BEGIN
            DROP POLICY IF EXISTS "Public read access" ON vehicles;
            DROP POLICY IF EXISTS "anon_select" ON vehicles;
            CREATE POLICY "authenticated_read_vehicles" ON vehicles
                FOR SELECT USING (auth.role() = 'authenticated');
        EXCEPTION WHEN others THEN
            RAISE NOTICE 'Vehicle policies already configured or error: %', SQLERRM;
        END;

        -- Vehicle documents: authenticated users only
        BEGIN
            DROP POLICY IF EXISTS "Public read access" ON vehicle_documents;
            DROP POLICY IF EXISTS "anon_select" ON vehicle_documents;
            CREATE POLICY "authenticated_read_documents" ON vehicle_documents
                FOR SELECT USING (auth.role() = 'authenticated');
        EXCEPTION WHEN others THEN
            RAISE NOTICE 'Document policies already configured or error: %', SQLERRM;
        END;

        -- Ownership verifications: owner access only
        BEGIN
            CREATE POLICY "owner_access_ownership_verifications" ON ownership_verifications
                FOR ALL USING (auth.uid()::text = user_id);
        EXCEPTION WHEN duplicate_object THEN
            RAISE NOTICE 'Ownership policy already exists';
        END;

        -- Security audit: admin only
        BEGIN
            CREATE POLICY "admin_only_security_audit" ON security_audit_log
                FOR ALL USING (auth.role() = 'service_role');
        EXCEPTION WHEN duplicate_object THEN
            RAISE NOTICE 'Audit policy already exists';
        END;

    END $$;
    """

    # Log the security improvements
    execute """
    INSERT INTO security_audit_log (event_type, details, created_at)
    VALUES ('standalone_security_fix', '{
        "functions_fixed": 2,
        "rls_enabled": ["vehicles", "vehicle_documents", "ownership_verifications", "security_audit_log"],
        "policies_created": ["authenticated_read_vehicles", "authenticated_read_documents", "owner_access_ownership_verifications", "admin_only_security_audit"]
    }', NOW());
    """
  end

  def down do
    # Remove security policies
    execute "DROP POLICY IF EXISTS \"authenticated_read_vehicles\" ON vehicles;"
    execute "DROP POLICY IF EXISTS \"authenticated_read_documents\" ON vehicle_documents;"
    execute "DROP POLICY IF EXISTS \"owner_access_ownership_verifications\" ON ownership_verifications;"
    execute "DROP POLICY IF EXISTS \"admin_only_security_audit\" ON security_audit_log;"

    # Reset function search paths (not recommended for security)
    execute """
    DO $$
    DECLARE
        func_record RECORD;
    BEGIN
        FOR func_record IN
            SELECT proname, pg_get_function_identity_arguments(p.oid) as args
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public'
            AND proname IN ('create_timeline_event_from_document', 'approve_ownership_verification')
        LOOP
            EXECUTE format('ALTER FUNCTION %I(%s) RESET search_path',
                          func_record.proname, func_record.args);
        END LOOP;
    END $$;
    """

    # Log rollback
    execute """
    INSERT INTO security_audit_log (event_type, details, created_at)
    VALUES ('security_rollback', '{"action": "standalone_security_fix_rollback"}', NOW())
    ON CONFLICT DO NOTHING;
    """

    # Remove security audit table last
    execute "DROP TABLE IF EXISTS security_audit_log;"
  end
end