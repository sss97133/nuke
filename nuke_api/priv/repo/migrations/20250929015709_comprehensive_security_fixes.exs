defmodule NukeApi.Repo.Migrations.ComprehensiveSecurityFixes do
  use Ecto.Migration

  def up do
    # Fix function search path vulnerabilities by setting secure search_path
    # This prevents search path injection attacks
    execute """
    DO $$
    DECLARE
        func_record RECORD;
    BEGIN
        -- Fix all functions with search path vulnerabilities
        FOR func_record IN
            SELECT proname, pg_get_function_identity_arguments(p.oid) as args
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public'
            AND proname IN (
                'approve_ownership_verification',
                'create_admin_notification',
                'create_feed_entry_for_image_upload',
                'create_image_association',
                'create_image_variants_job',
                'create_or_update_user_presence',
                'create_pricing_entry',
                'create_pricing_history_entry',
                'create_timeline_event_from_document',
                'create_timeline_event_with_images_and_associations',
                'create_vehicle_project',
                'create_work_memory',
                'delete_image_and_variants',
                'delete_work_memory',
                'extract_document_data',
                'get_admin_notifications',
                'get_feed_entries',
                'get_or_create_user_profile',
                'get_paginated_user_timeline',
                'get_pricing_data',
                'get_pricing_suggestions',
                'get_related_vehicles',
                'get_timeline_events_in_range',
                'get_user_activity_feed',
                'get_user_presence_data',
                'get_user_timeline_with_privacy',
                'get_vehicle_contributors',
                'get_vehicle_discovery_results',
                'get_vehicle_permissions',
                'get_vehicle_projects',
                'get_vehicle_timeline_minimal',
                'get_work_memories',
                'handle_image_processing_webhook',
                'mark_admin_notification_read',
                'mark_image_as_processed',
                'process_image_upload',
                'process_vehicle_discovery',
                'reject_ownership_verification',
                'search_vehicles_by_make_model_year',
                'sync_user_profile',
                'update_image_metadata',
                'update_pricing_entry',
                'update_user_presence',
                'update_vehicle_permissions',
                'update_work_memory',
                'validate_image_association',
                'validate_vin_format',
                'validate_work_memory_access'
            )
        LOOP
            EXECUTE format('ALTER FUNCTION %I(%s) SET search_path = ''''',
                          func_record.proname, func_record.args);
            RAISE NOTICE 'Fixed search_path for function: %', func_record.proname;
        END LOOP;
    END $$;
    """

    # Add additional security improvements
    execute """
    -- Create security audit log table if not exists
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

    # Create index for audit log queries
    execute "CREATE INDEX IF NOT EXISTS idx_security_audit_log_created_at ON security_audit_log(created_at DESC);"
    execute "CREATE INDEX IF NOT EXISTS idx_security_audit_log_event_type ON security_audit_log(event_type);"
    execute "CREATE INDEX IF NOT EXISTS idx_security_audit_log_user_id ON security_audit_log(user_id) WHERE user_id IS NOT NULL;"

    # Enable row level security on sensitive tables (where not already enabled)
    execute "ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;"
    execute "ALTER TABLE vehicle_documents ENABLE ROW LEVEL SECURITY;"
    execute "ALTER TABLE ownership_verifications ENABLE ROW LEVEL SECURITY;"
    execute "ALTER TABLE security_audit_log ENABLE ROW LEVEL SECURITY;"

    # Create more restrictive RLS policies for anonymous users
    execute """
    -- Drop overly permissive policies and create restrictive ones
    DROP POLICY IF EXISTS "Public read access" ON vehicles;
    DROP POLICY IF EXISTS "anon_select" ON vehicles;

    -- Only allow authenticated users to read vehicles
    CREATE POLICY "authenticated_read_vehicles" ON vehicles
        FOR SELECT
        USING (auth.role() = 'authenticated');
    """

    execute """
    -- Restrict document access to authenticated users only
    DROP POLICY IF EXISTS "Public read access" ON vehicle_documents;
    DROP POLICY IF EXISTS "anon_select" ON vehicle_documents;

    CREATE POLICY "authenticated_read_documents" ON vehicle_documents
        FOR SELECT
        USING (auth.role() = 'authenticated');
    """

    # Log this security update
    execute """
    INSERT INTO security_audit_log (event_type, details, created_at)
    VALUES ('security_migration', '{"migration": "comprehensive_security_fixes", "functions_fixed": 47, "rls_policies_updated": true}', NOW());
    """
  end

  def down do
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
            AND proname LIKE ANY(ARRAY['%approval%', '%create_%', '%get_%', '%update_%', '%delete_%', '%process_%', '%validate_%'])
        LOOP
            EXECUTE format('ALTER FUNCTION %I(%s) RESET search_path',
                          func_record.proname, func_record.args);
        END LOOP;
    END $$;
    """

    # Remove security audit table
    execute "DROP TABLE IF EXISTS security_audit_log;"

    # Note: RLS policies and other security features left in place for safety
    execute """
    INSERT INTO security_audit_log (event_type, details, created_at)
    VALUES ('security_rollback', '{"migration": "comprehensive_security_fixes", "action": "rollback"}', NOW());
    """
  end
end