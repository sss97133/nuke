defmodule NukeApi.Repo.Migrations.FixRlsPoliciesForSecurity do
  use Ecto.Migration

  def up do
    # Complete the RLS policy fixes that failed in the comprehensive security migration
    execute """
    DO $$
    BEGIN
        -- Drop existing overly permissive policies if they exist
        BEGIN
            DROP POLICY IF EXISTS "Public read access" ON vehicles;
        EXCEPTION WHEN undefined_object THEN
            NULL; -- Policy doesn't exist, continue
        END;

        BEGIN
            DROP POLICY IF EXISTS "anon_select" ON vehicles;
        EXCEPTION WHEN undefined_object THEN
            NULL; -- Policy doesn't exist, continue
        END;

        -- Only allow authenticated users to read vehicles
        BEGIN
            CREATE POLICY "authenticated_read_vehicles" ON vehicles
                FOR SELECT
                USING (auth.role() = 'authenticated');
        EXCEPTION WHEN duplicate_object THEN
            NULL; -- Policy already exists, continue
        END;

        -- Fix document access policies
        BEGIN
            DROP POLICY IF EXISTS "Public read access" ON vehicle_documents;
        EXCEPTION WHEN undefined_object THEN
            NULL;
        END;

        BEGIN
            DROP POLICY IF EXISTS "anon_select" ON vehicle_documents;
        EXCEPTION WHEN undefined_object THEN
            NULL;
        END;

        BEGIN
            CREATE POLICY "authenticated_read_documents" ON vehicle_documents
                FOR SELECT
                USING (auth.role() = 'authenticated');
        EXCEPTION WHEN duplicate_object THEN
            NULL; -- Policy already exists, continue
        END;

        -- Create secure policy for ownership_verifications
        BEGIN
            DROP POLICY IF EXISTS "Public read access" ON ownership_verifications;
        EXCEPTION WHEN undefined_object THEN
            NULL;
        END;

        BEGIN
            CREATE POLICY "owner_access_ownership_verifications" ON ownership_verifications
                FOR ALL
                USING (auth.uid()::text = user_id);
        EXCEPTION WHEN duplicate_object THEN
            NULL;
        END;

        -- Create secure policy for security_audit_log (admin only)
        BEGIN
            CREATE POLICY "admin_only_security_audit" ON security_audit_log
                FOR ALL
                USING (auth.role() = 'service_role');
        EXCEPTION WHEN duplicate_object THEN
            NULL;
        END;

    END $$;
    """

    # Log successful completion
    execute """
    INSERT INTO security_audit_log (event_type, details, created_at)
    VALUES ('rls_policy_fix', '{"policies_fixed": ["vehicles", "vehicle_documents", "ownership_verifications", "security_audit_log"]}', NOW());
    """
  end

  def down do
    # Remove restrictive policies (not recommended for security)
    execute """
    DO $$
    BEGIN
        BEGIN
            DROP POLICY IF EXISTS "authenticated_read_vehicles" ON vehicles;
        EXCEPTION WHEN undefined_object THEN
            NULL;
        END;

        BEGIN
            DROP POLICY IF EXISTS "authenticated_read_documents" ON vehicle_documents;
        EXCEPTION WHEN undefined_object THEN
            NULL;
        END;

        BEGIN
            DROP POLICY IF EXISTS "owner_access_ownership_verifications" ON ownership_verifications;
        EXCEPTION WHEN undefined_object THEN
            NULL;
        END;

        BEGIN
            DROP POLICY IF EXISTS "admin_only_security_audit" ON security_audit_log;
        EXCEPTION WHEN undefined_object THEN
            NULL;
        END;

    END $$;
    """

    execute """
    INSERT INTO security_audit_log (event_type, details, created_at)
    VALUES ('rls_policy_rollback', '{"action": "removed_restrictive_policies"}', NOW());
    """
  end
end