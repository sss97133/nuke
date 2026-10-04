-- C17: describe the existing observation log's clocks and replay identity.
-- Metadata only: no testimony, defaults, constraints, permissions or jobs change.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

COMMENT ON COLUMN public.vehicle_observations.observed_at IS
  'Writer-supplied observation time of this one sourced claim; timestamptz instant. Its source and extraction_method define the intended clock basis; historical rows may mix source event, review and recorded/ingest clocks, so that basis requires verification. cached_byok_property_projection_v1 uses the immutable parent testimony ingested_at as its recorded-time basis, retains source_observed_at, and leaves unverified photograph capture/analysis clocks unknown. Do not assume this column is photo capture time or that the claim was available to Nuke at this instant.';

COMMENT ON COLUMN public.vehicle_observations.ingested_at IS
  'Database knowledge/recording time of this one observation row; timestamptz instant. Canonical ingest-observation and cached-image batch intake omit this field, so the existing default now() records transaction start, not commit time or source capture/analysis time. Nullable historical or explicitly NULL values mean unknown. A newly projected claim has its own ingest clock, distinct from its parent testimony. Point-in-time consumers must check both the relevant source/event clock and this knowledge clock; this comment does not enforce those checks.';

COMMENT ON COLUMN public.vehicle_observations.source_identifier IS
  'Source/method-scoped text key for the event or result represented by this one observation; supplied by the canonical writer, NULL means unknown, and the value is not globally unique. The existing unique_observation index enforces uniqueness of the complete non-NULL (source_id, source_identifier, kind, content_hash) tuple. Cached image property keys bind immutable parent/result identity, projection version and property; exact replay retains the same key and payload. This column alone neither enforces idempotency nor authenticates a source.';

COMMIT;
