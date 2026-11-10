-- Revert of 20261113170000_photo_reading_status.sql: drops the two readers it added. That migration created nothing
-- else and changed no existing object, so nothing else is restored. A phone or web build that calls
-- photo_reading_status after this gets "function not found" and must show nothing rather than an error.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DROP FUNCTION IF EXISTS public.photo_reading_status(text);
DROP FUNCTION IF EXISTS public.photo_reading_status_for(uuid, text);
COMMIT;
