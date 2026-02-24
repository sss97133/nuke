-- Update verification code prefix from NZERO- to NUKE-
CREATE OR REPLACE FUNCTION generate_verification_code()
RETURNS TEXT
LANGUAGE sql
AS $$
  SELECT 'NUKE-' || upper(substring(md5(random()::text) from 1 for 8));
$$;
