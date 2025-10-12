defmodule NukeApi.Repo.Migrations.ConsolidateRoleSystem do
  use Ecto.Migration

  def up do
    # Add missing roles to existing vehicle_contributors table instead of creating redundant tables
    # Split into separate execute statements to avoid PostgreSQL prepared statement limitations
    execute "ALTER TABLE vehicle_contributors DROP CONSTRAINT IF EXISTS vehicle_contributors_role_check;"

    execute """
    ALTER TABLE vehicle_contributors ADD CONSTRAINT vehicle_contributors_role_check
    CHECK (role IN (
      -- Existing ownership-related roles
      'owner', 'previous_owner', 'restorer', 'contributor', 'mechanic',

      -- New roles requested by user
      'consigner', 'enthusiast', 'historian', 'curator', 'moderator', 'collector',

      -- Professional service roles
      'appraiser', 'detailer', 'inspector', 'photographer', 'sales_agent',
      'transport_driver', 'buyer', 'seller', 'witness',

      -- Extended contributor types
      'public_contributor', 'verified_contributor', 'specialist', 'expert'
    ));
    """

    # Add role application system - extends existing ownership verification workflow
    execute """
    -- Create role applications table that extends the existing ownership verification system
    -- This reuses the proven verification workflow instead of creating a new one
    CREATE TABLE IF NOT EXISTS role_applications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

      -- Role being applied for (references vehicle_contributors.role enum)
      requested_role TEXT NOT NULL,

      -- Application workflow - reuses ownership verification statuses
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'documents_uploaded', 'under_review',
        'approved', 'rejected', 'expired'
      )),

      -- Evidence and justification
      justification TEXT NOT NULL, -- Why they deserve this role
      supporting_documents JSONB DEFAULT '[]', -- URLs to evidence documents
      experience_summary TEXT, -- Relevant experience

      -- Approval workflow - reuses existing verification_reviewers table
      assigned_reviewer_id UUID REFERENCES profiles(id),
      reviewer_notes TEXT,
      approval_level_required TEXT DEFAULT 'standard' CHECK (approval_level_required IN ('standard', 'elevated', 'admin')),

      -- Timestamps
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ,
      approved_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),

      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),

      -- Constraints
      UNIQUE(vehicle_id, user_id, requested_role) -- One application per user-vehicle-role combo
    );
    """

    # Create indexes for performance
    create index(:role_applications, [:vehicle_id])
    create index(:role_applications, [:user_id])
    create index(:role_applications, [:status])
    create index(:role_applications, [:requested_role])

    # Add role-specific verification requirements
    execute """
    -- Create role requirements table to define what evidence is needed for each role
    -- This allows flexible, extensible role verification without hardcoded logic
    CREATE TABLE IF NOT EXISTS role_requirements (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      role_name TEXT NOT NULL UNIQUE,

      -- Evidence requirements
      requires_documents BOOLEAN DEFAULT false,
      required_document_types TEXT[] DEFAULT '{}', -- ['title', 'receipt', 'certification']
      requires_experience_proof BOOLEAN DEFAULT false,
      requires_professional_reference BOOLEAN DEFAULT false,
      requires_owner_approval BOOLEAN DEFAULT true, -- Does vehicle owner need to approve?

      -- Approval level needed
      approval_level TEXT DEFAULT 'standard' CHECK (approval_level IN ('standard', 'elevated', 'admin')),

      -- Role description and permissions
      description TEXT NOT NULL,
      permissions JSONB DEFAULT '{}', -- Flexible permissions object

      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    """

    # Pre-populate role requirements for the roles mentioned by the user
    execute """
    INSERT INTO role_requirements (role_name, requires_documents, requires_owner_approval, approval_level, description, permissions) VALUES
    ('previous_owner', true, false, 'standard', 'Someone who previously owned this vehicle', '{"can_edit": true, "can_add_timeline": true}'),
    ('consigner', true, true, 'elevated', 'Professional consigner handling vehicle sale', '{"can_edit": true, "can_manage_sale": true}'),
    ('enthusiast', false, true, 'standard', 'Enthusiast with deep knowledge of this vehicle type', '{"can_contribute": true, "can_comment": true}'),
    ('historian', false, false, 'standard', 'Researcher documenting vehicle history', '{"can_contribute": true, "can_research": true}'),
    ('curator', false, true, 'elevated', 'Museum or collection curator', '{"can_edit": true, "can_verify_facts": true}'),
    ('moderator', false, false, 'admin', 'Platform moderator with administrative access', '{"can_moderate": true, "can_edit": true, "can_verify": true}'),
    ('collector', false, true, 'standard', 'Collector with expertise in this vehicle type', '{"can_contribute": true, "can_appraise": true}'),
    ('appraiser', true, true, 'elevated', 'Professional vehicle appraiser', '{"can_appraise": true, "can_verify_value": true}'),
    ('restorer', false, true, 'standard', 'Professional or skilled restorer', '{"can_edit": true, "can_document_work": true}'),
    ('mechanic', false, true, 'standard', 'Professional mechanic who worked on vehicle', '{"can_edit": true, "can_document_service": true}')
    ON CONFLICT (role_name) DO NOTHING;
    """

    # Create function to process role applications (extends existing approval workflow)
    execute """
    -- Function to approve role applications - reuses existing verification patterns
    CREATE OR REPLACE FUNCTION approve_role_application(
      application_id UUID,
      reviewer_id UUID,
      reviewer_notes TEXT DEFAULT NULL
    ) RETURNS BOOLEAN AS $$
    DECLARE
      app_record role_applications%ROWTYPE;
    BEGIN
      -- Get application record
      SELECT * INTO app_record FROM role_applications WHERE id = application_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Role application not found';
      END IF;

      -- Update application status
      UPDATE role_applications SET
        status = 'approved',
        assigned_reviewer_id = reviewer_id,
        reviewer_notes = reviewer_notes,
        reviewed_at = NOW(),
        approved_at = NOW(),
        updated_at = NOW()
      WHERE id = application_id;

      -- Create the actual role assignment in vehicle_contributors
      INSERT INTO vehicle_contributors (
        vehicle_id, user_id, role, status, verified, verified_at, verified_by, metadata
      ) VALUES (
        app_record.vehicle_id,
        app_record.user_id,
        app_record.requested_role,
        'active',
        true,
        NOW(),
        reviewer_id,
        jsonb_build_object('application_id', application_id, 'approval_notes', reviewer_notes)
      ) ON CONFLICT (vehicle_id, user_id, role) DO UPDATE SET
        status = 'active',
        verified = true,
        verified_at = NOW(),
        verified_by = reviewer_id,
        metadata = EXCLUDED.metadata;

      RETURN true;
    END;
    $$ LANGUAGE plpgsql;
    """

    # Add RLS policies for the new tables (split into separate statements)
    execute "ALTER TABLE role_applications ENABLE ROW LEVEL SECURITY;"

    execute """
    CREATE POLICY "Users can view own role applications" ON role_applications
      FOR SELECT USING (user_id = auth.uid());
    """

    execute """
    CREATE POLICY "Users can create role applications" ON role_applications
      FOR INSERT WITH CHECK (user_id = auth.uid());
    """

    execute """
    CREATE POLICY "Vehicle owners can view applications" ON role_applications
      FOR SELECT USING (
        vehicle_id IN (
          SELECT id FROM vehicles WHERE uploaded_by = auth.uid()
        )
      );
    """

    execute "ALTER TABLE role_requirements ENABLE ROW LEVEL SECURITY;"

    execute """
    CREATE POLICY "Role requirements are publicly readable" ON role_requirements
      FOR SELECT USING (true);
    """
  end

  def down do
    # Remove the new tables and functions
    execute "DROP FUNCTION IF EXISTS approve_role_application(UUID, UUID, TEXT);"
    execute "DROP TABLE IF EXISTS role_requirements;"
    execute "DROP TABLE IF EXISTS role_applications;"

    # Revert vehicle_contributors role constraint to original (split statements)
    execute "ALTER TABLE vehicle_contributors DROP CONSTRAINT IF EXISTS vehicle_contributors_role_check;"
    execute """
    ALTER TABLE vehicle_contributors ADD CONSTRAINT vehicle_contributors_role_check
    CHECK (role IN ('owner', 'previous_owner', 'restorer', 'contributor', 'mechanic'));
    """
  end
end