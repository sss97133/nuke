-- Add RLS policies for tables that have RLS enabled but no policies defined
-- This addresses the security vulnerability where tables have RLS enabled but no policies,
-- effectively blocking all access or allowing only service_role access.

-- ============================================================================
-- 1. bat_seller_monitors
-- ============================================================================
-- Allow organization members to view/manage monitors for their organization
CREATE POLICY IF NOT EXISTS "Organization members can view monitors" ON bat_seller_monitors
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM business_user_roles bur
      WHERE bur.business_id = bat_seller_monitors.organization_id
        AND bur.user_id = auth.uid()
    )
    OR auth.role() = 'service_role'
  );

CREATE POLICY IF NOT EXISTS "Organization members can manage monitors" ON bat_seller_monitors
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM business_user_roles bur
      WHERE bur.business_id = bat_seller_monitors.organization_id
        AND bur.user_id = auth.uid()
        AND bur.role IN ('owner', 'admin', 'manager')
    )
    OR auth.role() = 'service_role'
  );

-- ============================================================================
-- 2. catalog_diagrams
-- ============================================================================
-- Public read access (like catalog_parts and catalog_pages)
CREATE POLICY IF NOT EXISTS "Public can view catalog diagrams" ON catalog_diagrams
  FOR SELECT USING (true);

-- Admin/system write access
CREATE POLICY IF NOT EXISTS "Service role can manage catalog diagrams" ON catalog_diagrams
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- 3. dealer_sales_transactions
-- ============================================================================
-- Note: This table already has policies in the migration, but ensuring they exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'dealer_sales_transactions' 
    AND policyname = 'Public can view sales transactions'
  ) THEN
    CREATE POLICY "Public can view sales transactions" ON dealer_sales_transactions
      FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'dealer_sales_transactions' 
    AND policyname = 'Dealer members can manage transactions'
  ) THEN
    CREATE POLICY "Dealer members can manage transactions" ON dealer_sales_transactions
      FOR ALL USING (
        EXISTS (
          SELECT 1 FROM business_user_roles
          WHERE business_id = dealer_sales_transactions.dealer_id
            AND user_id = auth.uid()
        )
        OR auth.role() = 'service_role'
      );
  END IF;
END $$;

-- ============================================================================
-- 4. document_access_logs
-- ============================================================================
-- Only document owners (via vehicle owner) can view access logs
CREATE POLICY IF NOT EXISTS "Document owners can view access logs" ON document_access_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM vehicle_documents vd
      JOIN vehicles v ON v.id = vd.vehicle_id
      WHERE vd.id = document_access_logs.document_id
        AND (
          v.user_id = auth.uid()
          OR v.uploaded_by = auth.uid()
          OR EXISTS (
            SELECT 1 FROM vehicle_user_permissions vup
            WHERE vup.vehicle_id = v.id
              AND vup.user_id = auth.uid()
              AND COALESCE(vup.is_active, true) = true
              AND vup.role IN ('owner', 'co_owner', 'moderator')
          )
        )
    )
    OR auth.role() = 'service_role'
  );

-- System can insert access logs
CREATE POLICY IF NOT EXISTS "Service role can insert access logs" ON document_access_logs
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- ============================================================================
-- 5. document_sensitive_data
-- ============================================================================
-- Note: This table already has a policy, but ensuring it exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'document_sensitive_data' 
    AND policyname = 'Only owner can access sensitive data'
  ) THEN
    CREATE POLICY "Only owner can access sensitive data" ON document_sensitive_data
      FOR ALL USING (
        EXISTS (
          SELECT 1 FROM vehicle_documents vd
          JOIN vehicles v ON v.id = vd.vehicle_id
          WHERE vd.id = document_sensitive_data.document_id
            AND (v.user_id = auth.uid() OR v.uploaded_by = auth.uid())
        )
        OR auth.role() = 'service_role'
      );
  END IF;
END $$;

-- ============================================================================
-- 6. duplicate_detections
-- ============================================================================
-- Vehicle owners can view duplicates involving their vehicles
CREATE POLICY IF NOT EXISTS "Vehicle owners can view duplicate detections" ON duplicate_detections
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM vehicles v
      WHERE (v.id = duplicate_detections.original_vehicle_id 
             OR v.id = duplicate_detections.duplicate_vehicle_id)
        AND (
          v.user_id = auth.uid()
          OR v.uploaded_by = auth.uid()
          OR EXISTS (
            SELECT 1 FROM vehicle_user_permissions vup
            WHERE vup.vehicle_id = v.id
              AND vup.user_id = auth.uid()
              AND COALESCE(vup.is_active, true) = true
              AND vup.role IN ('owner', 'co_owner', 'moderator')
          )
        )
    )
    OR auth.role() = 'service_role'
  );

-- System can manage duplicate detections
CREATE POLICY IF NOT EXISTS "Service role can manage duplicate detections" ON duplicate_detections
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- 7. event_parts_used
-- ============================================================================
-- Allow event creators and vehicle owners to view parts used
CREATE POLICY IF NOT EXISTS "Event participants can view parts used" ON event_parts_used
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM timeline_events te
      JOIN vehicles v ON v.id = te.vehicle_id
      WHERE te.id = event_parts_used.event_id
        AND (
          te.created_by = auth.uid()
          OR v.user_id = auth.uid()
          OR v.uploaded_by = auth.uid()
          OR EXISTS (
            SELECT 1 FROM vehicle_user_permissions vup
            WHERE vup.vehicle_id = v.id
              AND vup.user_id = auth.uid()
              AND COALESCE(vup.is_active, true) = true
          )
        )
    )
    OR auth.role() = 'service_role'
  );

-- Event creators and vehicle owners can manage parts
CREATE POLICY IF NOT EXISTS "Event participants can manage parts used" ON event_parts_used
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM timeline_events te
      JOIN vehicles v ON v.id = te.vehicle_id
      WHERE te.id = event_parts_used.event_id
        AND (
          te.created_by = auth.uid()
          OR v.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM vehicle_user_permissions vup
            WHERE vup.vehicle_id = v.id
              AND vup.user_id = auth.uid()
              AND COALESCE(vup.is_active, true) = true
              AND vup.role IN ('owner', 'co_owner', 'contributor', 'mechanic', 'restorer')
          )
        )
    )
    OR auth.role() = 'service_role'
  );

-- ============================================================================
-- 8. event_tools_used
-- ============================================================================
-- Allow event creators and vehicle owners to view tools used
CREATE POLICY IF NOT EXISTS "Event participants can view tools used" ON event_tools_used
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM timeline_events te
      JOIN vehicles v ON v.id = te.vehicle_id
      WHERE te.id = event_tools_used.event_id
        AND (
          te.created_by = auth.uid()
          OR v.user_id = auth.uid()
          OR v.uploaded_by = auth.uid()
          OR EXISTS (
            SELECT 1 FROM vehicle_user_permissions vup
            WHERE vup.vehicle_id = v.id
              AND vup.user_id = auth.uid()
              AND COALESCE(vup.is_active, true) = true
          )
        )
    )
    OR auth.role() = 'service_role'
  );

-- Event creators and vehicle owners can manage tools
CREATE POLICY IF NOT EXISTS "Event participants can manage tools used" ON event_tools_used
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM timeline_events te
      JOIN vehicles v ON v.id = te.vehicle_id
      WHERE te.id = event_tools_used.event_id
        AND (
          te.created_by = auth.uid()
          OR v.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM vehicle_user_permissions vup
            WHERE vup.vehicle_id = v.id
              AND vup.user_id = auth.uid()
              AND COALESCE(vup.is_active, true) = true
              AND vup.role IN ('owner', 'co_owner', 'contributor', 'mechanic', 'restorer')
          )
        )
    )
    OR auth.role() = 'service_role'
  );

-- ============================================================================
-- 9. image_forensics
-- ============================================================================
-- Vehicle owners can view forensics for their vehicle images
CREATE POLICY IF NOT EXISTS "Vehicle owners can view image forensics" ON image_forensics
  FOR SELECT USING (
    vehicle_id IS NULL  -- Allow viewing forensics without vehicle_id (system-level)
    OR EXISTS (
      SELECT 1 FROM vehicles v
      WHERE v.id = image_forensics.vehicle_id
        AND (
          v.user_id = auth.uid()
          OR v.uploaded_by = auth.uid()
          OR EXISTS (
            SELECT 1 FROM vehicle_user_permissions vup
            WHERE vup.vehicle_id = v.id
              AND vup.user_id = auth.uid()
              AND COALESCE(vup.is_active, true) = true
          )
        )
    )
    OR auth.role() = 'service_role'
  );

-- System can manage image forensics
CREATE POLICY IF NOT EXISTS "Service role can manage image forensics" ON image_forensics
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- 10. import_queue
-- ============================================================================
-- Only service role and admins can view/manage import queue
CREATE POLICY IF NOT EXISTS "Service role can manage import queue" ON import_queue
  FOR ALL USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.user_type IN ('admin', 'moderator')
    )
  );

-- ============================================================================
-- 11. mailbox_access_keys
-- ============================================================================
-- Users can view access keys for mailboxes they have access to
CREATE POLICY IF NOT EXISTS "Users can view mailbox access keys" ON mailbox_access_keys
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM vehicle_mailboxes vm
      JOIN mailbox_access_keys mak2 ON mak2.mailbox_id = vm.id
      WHERE mak2.mailbox_id = mailbox_access_keys.mailbox_id
        AND mak2.user_id = auth.uid()
        AND mak2.permission_level IN ('read_write', 'read_only')
        AND (mak2.expires_at IS NULL OR mak2.expires_at > now())
    )
    OR auth.role() = 'service_role'
  );

-- Users can manage their own access keys, or if they have master access
CREATE POLICY IF NOT EXISTS "Users can manage mailbox access keys" ON mailbox_access_keys
  FOR ALL USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM vehicle_mailboxes vm
      JOIN mailbox_access_keys mak2 ON mak2.mailbox_id = vm.id
      WHERE mak2.mailbox_id = mailbox_access_keys.mailbox_id
        AND mak2.user_id = auth.uid()
        AND mak2.key_type = 'master'
        AND mak2.permission_level = 'read_write'
        AND (mak2.expires_at IS NULL OR mak2.expires_at > now())
    )
    OR auth.role() = 'service_role'
  );

-- ============================================================================
-- 12. organizations (businesses table)
-- ============================================================================
-- Public can view organizations (businesses)
CREATE POLICY IF NOT EXISTS "Public can view businesses" ON businesses
  FOR SELECT USING (true);

-- Organization members and admins can manage
CREATE POLICY IF NOT EXISTS "Organization members can manage businesses" ON businesses
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM business_user_roles bur
      WHERE bur.business_id = businesses.id
        AND bur.user_id = auth.uid()
        AND bur.role IN ('owner', 'admin', 'manager')
    )
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.user_type IN ('admin', 'moderator')
    )
    OR auth.role() = 'service_role'
  );

-- Users can create businesses
CREATE POLICY IF NOT EXISTS "Authenticated users can create businesses" ON businesses
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      discovered_by = auth.uid()
      OR uploaded_by = auth.uid()
    )
  );

-- ============================================================================
-- 13. receipt_links
-- ============================================================================
-- Follow receipt permissions
CREATE POLICY IF NOT EXISTS "Receipt owners can view receipt links" ON receipt_links
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM receipts r
      WHERE r.id = receipt_links.receipt_id
        AND (
          r.created_by = auth.uid()
          OR (
            r.scope_type = 'vehicle' AND EXISTS (
              SELECT 1 FROM vehicles v
              WHERE v.id = r.scope_id::uuid
                AND (v.user_id = auth.uid() OR v.uploaded_by = auth.uid())
            )
          )
          OR (
            r.scope_type = 'org' AND EXISTS (
              SELECT 1 FROM business_user_roles bur
              WHERE bur.business_id = r.scope_id::uuid
                AND bur.user_id = auth.uid()
                AND bur.role IN ('owner', 'admin')
            )
          )
        )
    )
    OR auth.role() = 'service_role'
  );

-- Receipt owners can manage links
CREATE POLICY IF NOT EXISTS "Receipt owners can manage receipt links" ON receipt_links
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM receipts r
      WHERE r.id = receipt_links.receipt_id
        AND r.created_by = auth.uid()
    )
    OR auth.role() = 'service_role'
  );

-- ============================================================================
-- 14. scrape_runs and scrape_sources
-- ============================================================================
-- Note: These tables may not exist, but if they do, restrict to service role only
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'scrape_runs') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE tablename = 'scrape_runs' 
      AND policyname = 'Service role can manage scrape runs'
    ) THEN
      EXECUTE 'CREATE POLICY "Service role can manage scrape runs" ON scrape_runs FOR ALL USING (auth.role() = ''service_role'')';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'scrape_sources') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE tablename = 'scrape_sources' 
      AND policyname = 'Service role can manage scrape sources'
    ) THEN
      EXECUTE 'CREATE POLICY "Service role can manage scrape sources" ON scrape_sources FOR ALL USING (auth.role() = ''service_role'')';
    END IF;
  END IF;
END $$;

-- ============================================================================
-- 15. shop_capabilities
-- ============================================================================
-- Public can view shop capabilities
CREATE POLICY IF NOT EXISTS "Public can view shop capabilities" ON shop_capabilities
  FOR SELECT USING (true);

-- Shop members can manage capabilities
CREATE POLICY IF NOT EXISTS "Shop members can manage capabilities" ON shop_capabilities
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM shop_members sm
      WHERE sm.shop_id = shop_capabilities.shop_id
        AND sm.user_id = auth.uid()
        AND sm.role IN ('owner', 'admin', 'manager')
    )
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.user_type IN ('admin', 'moderator')
    )
    OR auth.role() = 'service_role'
  );

-- ============================================================================
-- Comments
-- ============================================================================
COMMENT ON POLICY "Organization members can view monitors" ON bat_seller_monitors IS 'Allow organization members to view BAT seller monitoring settings';
COMMENT ON POLICY "Public can view catalog diagrams" ON catalog_diagrams IS 'Allow public read access to catalog diagrams (like catalog_parts)';
COMMENT ON POLICY "Vehicle owners can view duplicate detections" ON duplicate_detections IS 'Allow vehicle owners to view duplicate detection results for their vehicles';
COMMENT ON POLICY "Service role can manage import queue" ON import_queue IS 'Restrict import queue to service role and admins only';
COMMENT ON POLICY "Public can view businesses" ON businesses IS 'Allow public read access to organization/business profiles';

