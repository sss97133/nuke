-- Profile overhaul (synthesis fix #13): missing vehicles.owner_id index.
--
-- The garage/workspace VehicleCollection resolves a user's vehicles with a
-- 3-way OR (user_id / uploaded_by / owner_id). user_id and uploaded_by are
-- indexed; owner_id is NOT, so the OR degrades to a sequential scan over
-- ~909K vehicles rows and the equivalent raw SQL exceeds the 15s statement
-- timeout -> the component errors into its empty state for a user with 211
-- vehicles. owner_id is the only unindexed leg.
--
-- Partial (owner_id IS NOT NULL): only 189 of 909,383 rows carry owner_id,
-- so the index is tiny and the NULL majority never bloats it.

CREATE INDEX IF NOT EXISTS idx_vehicles_owner_id
  ON vehicles(owner_id)
  WHERE owner_id IS NOT NULL;
