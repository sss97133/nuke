-- Reverts 001_ask_close_comps.sql. The reader writes nothing, so dropping it loses no data.
SET statement_timeout = '30s';
SET lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.ask_close_comps(uuid[]);
