-- Vehicle Profile Access Policies
-- Expands RLS so verified owners, collaborators, and contributors can load vehicle
-- data and related build/holding records without tripping 400/403 errors.

DO $$
BEGIN
  CREATE OR REPLACE FUNCTION vehicle_user_has_access(p_vehicle_id UUID, p_user_id UUID)
  RETURNS BOOLEAN
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $$
  DECLARE
    has_perm BOOLEAN := false;
  BEGIN
    IF p_user_id IS NULL THEN
      RETURN false;
    END IF;

    SELECT true INTO has_perm
    FROM vehicle_user_permissions vup
    WHERE vup.vehicle_id = p_vehicle_id
      AND vup.user_id = p_user_id
      AND COALESCE(vup.is_active, true) = true
      AND vup.role = ANY (ARRAY['owner','co_owner','mechanic','appraiser','moderator','contributor','photographer','dealer_rep','sales_agent','restorer','consigner','board_member']::text[])
    LIMIT 1;

    IF has_perm THEN
      RETURN true;
    END IF;

    SELECT true INTO has_perm
    FROM ownership_verifications ov
    WHERE ov.vehicle_id = p_vehicle_id
      AND ov.user_id = p_user_id
      AND ov.status = 'approved'
    LIMIT 1;

    RETURN COALESCE(has_perm, false);
  END;
  $$;

  GRANT EXECUTE ON FUNCTION vehicle_user_has_access(UUID, UUID) TO anon, authenticated, service_role;

  -- ========================================================================
  -- Vehicles: allow collaborators to view non-public profiles they can access
  -- ========================================================================
  DROP POLICY IF EXISTS vehicles_public_select ON vehicles;
  CREATE POLICY vehicles_public_select
    ON vehicles
    FOR SELECT
    USING (is_public = true OR auth.role() = 'service_role');

  DROP POLICY IF EXISTS vehicles_private_select ON vehicles;
  CREATE POLICY vehicles_private_select
    ON vehicles
    FOR SELECT
    USING (
      auth.uid() IS NOT NULL AND (
        auth.uid() = user_id
        OR auth.uid() = owner_id
        OR auth.uid() = uploaded_by
        OR vehicle_user_has_access(id, auth.uid())
      )
    );

  -- ========================================================================
  -- Vehicle offerings / share holdings visibility
  -- ========================================================================
  DROP POLICY IF EXISTS "Offerings are viewable to all authenticated users" ON vehicle_offerings;
  CREATE POLICY "Offerings are viewable to all authenticated users"
    ON vehicle_offerings
    FOR SELECT
    USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

  DROP POLICY IF EXISTS "Vehicle collaborators can view holdings" ON share_holdings;
  CREATE POLICY "Vehicle collaborators can view holdings"
    ON share_holdings
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1
        FROM vehicle_offerings vo
        JOIN vehicles v ON v.id = vo.vehicle_id
        LEFT JOIN vehicle_user_permissions vup
          ON vup.vehicle_id = v.id
         AND vup.user_id = auth.uid()
         AND COALESCE(vup.is_active, true) = true
         AND vup.role = ANY (ARRAY['owner','co_owner','mechanic','appraiser','moderator','contributor','photographer','dealer_rep','sales_agent','restorer','consigner','board_member']::text[])
        WHERE vo.id = share_holdings.offering_id
          AND (
            v.is_public = true OR
            auth.uid() = v.user_id OR
            auth.uid() = v.owner_id OR
            auth.uid() = v.uploaded_by OR
            vup.user_id IS NOT NULL
          )
      )
    );

  -- ========================================================================
  -- Vehicle transactions: owners/collaborators can read history
  -- ========================================================================
  DROP POLICY IF EXISTS "Vehicle collaborators can view transactions" ON vehicle_transactions;
  CREATE POLICY "Vehicle collaborators can view transactions"
    ON vehicle_transactions
    FOR SELECT
    TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM vehicles v
        LEFT JOIN vehicle_user_permissions vup
          ON vup.vehicle_id = v.id
         AND vup.user_id = auth.uid()
         AND COALESCE(vup.is_active, true) = true
         AND vup.role = ANY (ARRAY['owner','co_owner','mechanic','appraiser','moderator','contributor','photographer','dealer_rep','sales_agent','restorer','consigner','board_member']::text[])
        WHERE v.id = vehicle_transactions.vehicle_id
          AND (
            v.is_public = true OR
            auth.uid() = v.user_id OR
            auth.uid() = v.owner_id OR
            auth.uid() = v.uploaded_by OR
            vup.user_id IS NOT NULL
          )
      )
    );

  -- ========================================================================
  -- Vehicle builds & related tables
  -- ========================================================================
  DROP POLICY IF EXISTS builds_policy ON vehicle_builds;
  CREATE POLICY builds_policy
    ON vehicle_builds
    USING (
      EXISTS (
        SELECT 1
        FROM vehicles v
        LEFT JOIN vehicle_user_permissions vup
          ON vup.vehicle_id = v.id
         AND vup.user_id = auth.uid()
         AND COALESCE(vup.is_active, true) = true
         AND vup.role = ANY (ARRAY['owner','co_owner','mechanic','appraiser','moderator','contributor','photographer','dealer_rep','sales_agent','restorer','consigner','board_member']::text[])
        WHERE v.id = vehicle_builds.vehicle_id
          AND (
            auth.uid() = v.user_id OR
            auth.uid() = v.owner_id OR
            auth.uid() = v.uploaded_by OR
            v.is_public = true OR
            vup.user_id IS NOT NULL
          )
      )
    );

  DROP POLICY IF EXISTS phases_policy ON build_phases;
  CREATE POLICY phases_policy
    ON build_phases
    USING (
      EXISTS (
        SELECT 1
        FROM vehicle_builds vb
        JOIN vehicles v ON v.id = vb.vehicle_id
        LEFT JOIN vehicle_user_permissions vup
          ON vup.vehicle_id = v.id
         AND vup.user_id = auth.uid()
         AND COALESCE(vup.is_active, true) = true
         AND vup.role = ANY (ARRAY['owner','co_owner','mechanic','appraiser','moderator','contributor','photographer','dealer_rep','sales_agent','restorer','consigner','board_member']::text[])
        WHERE vb.id = build_phases.build_id
          AND (
            auth.uid() = v.user_id OR
            auth.uid() = v.owner_id OR
            auth.uid() = v.uploaded_by OR
            v.is_public = true OR
            vup.user_id IS NOT NULL
          )
      )
    );

  DROP POLICY IF EXISTS items_policy ON build_line_items;
  CREATE POLICY items_policy
    ON build_line_items
    USING (
      EXISTS (
        SELECT 1
        FROM vehicle_builds vb
        JOIN vehicles v ON v.id = vb.vehicle_id
        LEFT JOIN vehicle_user_permissions vup
          ON vup.vehicle_id = v.id
         AND vup.user_id = auth.uid()
         AND COALESCE(vup.is_active, true) = true
         AND vup.role = ANY (ARRAY['owner','co_owner','mechanic','appraiser','moderator','contributor','photographer','dealer_rep','sales_agent','restorer','consigner','board_member']::text[])
        WHERE vb.id = build_line_items.build_id
          AND (
            auth.uid() = v.user_id OR
            auth.uid() = v.owner_id OR
            auth.uid() = v.uploaded_by OR
            v.is_public = true OR
            vup.user_id IS NOT NULL
          )
      )
    );

  DROP POLICY IF EXISTS documents_policy ON build_documents;
  CREATE POLICY documents_policy
    ON build_documents
    USING (
      EXISTS (
        SELECT 1
        FROM vehicle_builds vb
        JOIN vehicles v ON v.id = vb.vehicle_id
        LEFT JOIN vehicle_user_permissions vup
          ON vup.vehicle_id = v.id
         AND vup.user_id = auth.uid()
         AND COALESCE(vup.is_active, true) = true
         AND vup.role = ANY (ARRAY['owner','co_owner','mechanic','appraiser','moderator','contributor','photographer','dealer_rep','sales_agent','restorer','consigner','board_member']::text[])
        WHERE vb.id = build_documents.build_id
          AND (
            auth.uid() = v.user_id OR
            auth.uid() = v.owner_id OR
            auth.uid() = v.uploaded_by OR
            v.is_public = true OR
            vup.user_id IS NOT NULL
          )
      )
    );

  DROP POLICY IF EXISTS images_policy ON build_images;
  CREATE POLICY images_policy
    ON build_images
    USING (
      EXISTS (
        SELECT 1
        FROM vehicle_builds vb
        JOIN vehicles v ON v.id = vb.vehicle_id
        LEFT JOIN vehicle_user_permissions vup
          ON vup.vehicle_id = v.id
         AND vup.user_id = auth.uid()
         AND COALESCE(vup.is_active, true) = true
         AND vup.role = ANY (ARRAY['owner','co_owner','mechanic','appraiser','moderator','contributor','photographer','dealer_rep','sales_agent','restorer','consigner','board_member']::text[])
        WHERE vb.id = build_images.build_id
          AND (
            auth.uid() = v.user_id OR
            auth.uid() = v.owner_id OR
            auth.uid() = v.uploaded_by OR
            v.is_public = true OR
            vup.user_id IS NOT NULL
          )
      )
    );

  DROP POLICY IF EXISTS benchmarks_policy ON build_benchmarks;
  CREATE POLICY benchmarks_policy
    ON build_benchmarks
    USING (
      EXISTS (
        SELECT 1
        FROM vehicle_builds vb
        JOIN vehicles v ON v.id = vb.vehicle_id
        LEFT JOIN vehicle_user_permissions vup
          ON vup.vehicle_id = v.id
         AND vup.user_id = auth.uid()
         AND COALESCE(vup.is_active, true) = true
         AND vup.role = ANY (ARRAY['owner','co_owner','mechanic','appraiser','moderator','contributor','photographer','dealer_rep','sales_agent','restorer','consigner','board_member']::text[])
        WHERE vb.id = build_benchmarks.build_id
          AND (
            auth.uid() = v.user_id OR
            auth.uid() = v.owner_id OR
            auth.uid() = v.uploaded_by OR
            v.is_public = true OR
            vup.user_id IS NOT NULL
          )
      )
    );

  DROP POLICY IF EXISTS tags_policy ON build_tags;
  CREATE POLICY tags_policy
    ON build_tags
    USING (
      EXISTS (
        SELECT 1
        FROM vehicle_builds vb
        JOIN vehicles v ON v.id = vb.vehicle_id
        LEFT JOIN vehicle_user_permissions vup
          ON vup.vehicle_id = v.id
         AND vup.user_id = auth.uid()
         AND COALESCE(vup.is_active, true) = true
         AND vup.role = ANY (ARRAY['owner','co_owner','mechanic','appraiser','moderator','contributor','photographer','dealer_rep','sales_agent','restorer','consigner','board_member']::text[])
        WHERE vb.id = build_tags.build_id
          AND (
            auth.uid() = v.user_id OR
            auth.uid() = v.owner_id OR
            auth.uid() = v.uploaded_by OR
            v.is_public = true OR
            vup.user_id IS NOT NULL
          )
      )
    );
END $$;

DO $$
BEGIN
  RAISE NOTICE '✅ Vehicle collaborator policies updated';
END $$;

