# Photo keys from stored readings

Mechanism for migration `20261123121500_project_photo_keys_from_readings.sql`.

A photo reading is finished when it is a `vehicle_observations` row admitted
through `ingest-observation` / `ingest-observation-batch` with a registered
`property_key` (`observation_properties`) or `descriptor_key` (`condition_taxonomy`),
and an `observation_witnesses` row that names the photo. Stored descriptions and
`photo_extracted_fields` remain retained input.

This change does two things:

1. **New automatic readings.** `platform_config.image_reading_tiers.automatic.admits`
   now includes the registered rust list (`none`, `surface`, `pitting`, `perforation`)
   and paint list (`bare_metal`, `primer`, `sealer`, `base`, `clear`, `aged`). The
   existing thin reader and the one-photo `keyed_values` path then post and project
   those values when both passes agree. Completeness stays unpublished on the
   automatic thin parent (measured 2026-11-20; see `thinVerdict` in
   `scripts/photo-pipeline/deep-stage.mjs`). Changing admits changes the method
   fingerprint, so a photo read under the narrower set can be read again.

2. **Backfill of stored readings.** `project_photo_keys_v1` is a signed, dry-by-default
   planner (cap 50 photos) that names the registered rust, paint, and assembly keys
   already present on current `image_deep_byok` readings. Unmapped findings stay on
   the source observation. Apply is `scripts/photo-pipeline/project-photo-keys.mjs`
   through `ingest-observation-batch` mode `cached_image_property_projection_v1`,
   then `record_project_photo_keys_v1`. `revert_project_photo_keys_v1` supersedes
   the observations recorded for that `run_id` and does not delete them.

Eligibility: the photo is already filed (`vehicle_id` present), has a non-empty
URL, and is not sensitive, superseded, duplicate, a document, rejected, or the
hold-out prefix `9cf5b7a4`. The source reading must carry provenance (model,
method, ingested_at, score in `[0.6, 1]`). Intent-only clarification may be
released the same way the one-photo keyed-values route already does. A
picture-of-a-picture narrative is not keyed. GPS is not copied onto a claim.
Automatic readings keep `agent_tier = 'subscription automatic'` and therefore
stay out of `vehicle_canonical`. The planner does not land photos, assert
ownership, or invent keys.
