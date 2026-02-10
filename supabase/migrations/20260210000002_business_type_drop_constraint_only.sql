-- Allow any business_type value by dropping the check constraint.
-- Run 20260210000001 later to re-add the expanded list, or leave unconstrained.
ALTER TABLE businesses DROP CONSTRAINT IF EXISTS businesses_business_type_check;
