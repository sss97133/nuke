-- Allow users to update draft agreements through signature completion
-- and keep status transitions within the expected flow.

DROP POLICY IF EXISTS "Users can update their own draft agreements"
  ON buyer_agency_agreements;

CREATE POLICY "Users can update their own pending agreements"
  ON buyer_agency_agreements
  FOR UPDATE
  USING (auth.uid() = user_id AND status IN ('draft', 'pending_signature'))
  WITH CHECK (auth.uid() = user_id AND status IN ('draft', 'pending_signature', 'active'));
