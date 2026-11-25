-- private_row_probes_tag_views_v1: the exposure watch probes the two owner-run views over image_tags.
--
-- WHY. tag_analysis_view and enhanced_tag_context are postgres-owned views without security_invoker, and anon can
-- SELECT both, so they read image_tags past its policies (#3917 tightens the table, not the views). Live 2026-11-25,
-- read-only as anon: 50 of 50 sampled tags on private or deleted cars come back through each view (sampling 0.5-0.7 s,
-- anon count 0.5-0.6 s). These rows make the hourly watch name both views until they read 0.
--
-- enhanced_tag_context has no vehicle column (its id is the image_tags id), so its row is subject_kind 'user' on id
-- (always true) with a sample_filter that keeps the tags whose car is not public; private rows are chosen by the filter.
--
-- REVERT. DELETE FROM public.private_row_probes WHERE relation IN ('tag_analysis_view', 'enhanced_tag_context');
SET lock_timeout = '5s';
SET statement_timeout = '30s';

INSERT INTO public.private_row_probes (rank, relation, row_key, subject_kind, subject_column, sample_filter, owner_lane, note,
                                       audiences, active) VALUES
  (24, 'tag_analysis_view', 'id', 'vehicle', 'vehicle_id', NULL, 'ta-policies',
   'owner-run view over image_tags (no security_invoker), anon can select; 2026-11-25: 50/50 private-car tags readable', '{anon}', true),
  (25, 'enhanced_tag_context', 'id', 'user', 'id',
   'x.id IN (SELECT t.id FROM public.image_tags t WHERE NOT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = t.vehicle_id AND v.is_public AND v.deleted_at IS NULL))',
   'ta-policies',
   'owner-run view over image_tags with receipt and note columns, anon can select; private = tag on a non-public car (sample_filter); 2026-11-25: 50/50 readable',
   '{anon}', true)
ON CONFLICT (relation, subject_kind, subject_column, reader) DO NOTHING;
