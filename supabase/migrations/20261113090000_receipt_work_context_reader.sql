-- The consumer of receipt-to-work reconciliation: one authenticated, permission-checked, read-only reader.
--
-- get_vehicle_receipt_work_context(p_vehicle_id, p_page_date default null) returns, for a vehicle the caller may view,
-- the CURRENT receipt_work_correlation evidence per receipt line (garage_derivation_evidence, active rows only) with:
--   conclusion, confidence, status 'proposed' and what it does not assert (corroboration, installation, payment, owner Sign);
--   frames      the cited frames the caller may see now: receipt_work_frame_eligible (vision gate approved, so privacy-hold
--               and personal frames never; not sensitive, not redacted, not duplicate or superseded) on this vehicle;
--               frames_hidden counts the cited frames withheld;
--   lineage     receipt, source document (table, id), line, item, link; page is null with the reason
--               'line-to-page mapping unresolved';
--   printed     what the document prints (date, hours, performer), attributed to the document, never to an account;
--   withdrawn   active retractions (source_withdrawn) listed apart from current lines, never as current;
--   judgment    the open or answered question for the line (pending | claimed | answered), its answer when answered.
-- Four people-ish fields are kept apart and labelled: photographer (per frame, from the photo record), printed_performer
-- (document testimony), custodian (the account the document was filed under: custody only) and holder (the worker holding
-- an open judgment). None of them says who owns the car, who paid, or who did the work.
-- Viewers tied to the vehicle (owner, uploader, granted access) also see account ids and the line amount; other viewers
-- of a public vehicle see them masked. Anonymous callers get nothing. No table is created or written.
--
-- Revert: supabase/sql/revert_20261113090000_receipt_work_context_reader.sql.
-- Contract: supabase/sql/test_receipt_work_context_reader.sql.

SET lock_timeout = '5s';
SET statement_timeout = '120s';

CREATE OR REPLACE FUNCTION public.get_vehicle_receipt_work_context(p_vehicle_id uuid, p_page_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH me AS MATERIALIZED (
    SELECT auth.uid() AS uid, auth.role() AS role
  ),
  gate AS MATERIALIZED (
    -- the vehicle, only if this signed-in caller may see it; tied = may see account ids and amounts
    SELECT v.id,
           (me.role = 'service_role'
            OR (me.uid IS NOT NULL AND (v.user_id = me.uid OR v.owner_id = me.uid OR v.uploaded_by = me.uid
                                        OR vehicle_user_has_access(v.id, me.uid)))) AS tied
      FROM vehicles v CROSS JOIN me
     WHERE v.id = p_vehicle_id
       AND (me.uid IS NOT NULL OR me.role = 'service_role')
       AND (me.role = 'service_role'
            OR (v.is_public IS TRUE AND v.deleted_at IS NULL)
            OR v.user_id = me.uid OR v.owner_id = me.uid OR v.uploaded_by = me.uid
            OR vehicle_user_has_access(v.id, me.uid))
  ),
  ev AS (
    SELECT e.*, (e.evidence ->> 'link_id')::uuid AS link_id, (e.evidence ->> 'item_id')::uuid AS item_id,
           (e.evidence ->> 'receipt_id')::uuid AS receipt_id
      FROM garage_derivation_evidence e
     WHERE EXISTS (SELECT 1 FROM gate)
       AND e.kind = 'receipt_work_correlation' AND e.vehicle_id = p_vehicle_id AND e.superseded_at IS NULL
       AND (p_page_date IS NULL OR EXISTS (
             SELECT 1 FROM receipt_vehicle_links l
              WHERE l.id = (e.evidence ->> 'link_id')::uuid AND l.vehicle_id = p_vehicle_id AND l.page_date = p_page_date))
  ),
  frames AS (
    SELECT e.id AS evidence_id,
           coalesce(jsonb_agg(jsonb_build_object(
             'image_id', vi.id, 'taken_at', vi.taken_at, 'image_url', vi.image_url, 'thumbnail_url', vi.thumbnail_url,
             'photographer', jsonb_build_object(
               'label', 'photographer (from the photo record)',
               'attribution', vi.photographer_attribution,
               'documented_by_user_id', CASE WHEN g.tied THEN vi.documented_by_user_id END))
             ORDER BY vi.taken_at, vi.id) FILTER (WHERE vi.id IS NOT NULL), '[]'::jsonb) AS shown,
           count(*) FILTER (WHERE x.id IS NOT NULL AND vi.id IS NULL) AS hidden
      FROM ev e CROSS JOIN gate g
      LEFT JOIN LATERAL unnest(coalesce(e.image_ids, '{}'::uuid[])) x(id) ON true
      LEFT JOIN vehicle_images vi
        ON vi.id = x.id AND vi.vehicle_id = p_vehicle_id AND receipt_work_frame_eligible(vi)
     GROUP BY e.id
  ),
  judgment AS (
    SELECT DISTINCT ON (j.subject_id) j.*
      FROM evidence_judgment_requests j
     WHERE EXISTS (SELECT 1 FROM gate)
       AND j.vehicle_id = p_vehicle_id AND j.status IN ('pending', 'claimed', 'answered')
       AND j.subject_id IN (SELECT item_id FROM ev WHERE item_id IS NOT NULL)
     ORDER BY j.subject_id, (j.status = 'answered') DESC, j.created_at DESC
  ),
  cur AS (
    SELECT jsonb_build_object(
      'evidence_id', e.id,
      'receipt_id', e.receipt_id,
      'item_id', e.item_id,
      'line_number', (e.evidence ->> 'line_number')::int,
      'description', e.evidence ->> 'description',
      'part_number', e.evidence ->> 'part_number',
      'amount', CASE WHEN g.tied THEN (e.evidence ->> 'total_price')::numeric END,
      'vendor_name', e.evidence ->> 'vendor_name',
      'conclusion', e.conclusion,
      'confidence', e.confidence,
      'status', 'proposed',
      'kind', 'receipt_time_context',
      'not_asserted', coalesce(e.evidence #> '{relationship,not_asserted}',
                               '["independent_corroboration","installation_proof","payment_proof","owner_sign"]'::jsonb),
      'rationale', e.rationale,
      'anchor_date', e.conclusion_detail ->> 'anchor_date',
      'anchor_source', e.conclusion_detail ->> 'anchor_source',
      'zone', e.conclusion_detail ->> 'zone',
      'days_to_first_photo', (e.conclusion_detail ->> 'days_to_first_photo')::int,
      'zone_photos_in_window', (e.evidence ->> 'zone_photos_in_window')::int,
      'frames', coalesce(f.shown, '[]'::jsonb),
      'frames_hidden', coalesce(f.hidden, 0),
      'lineage', jsonb_build_object(
        'receipt_id', e.receipt_id,
        'source_document_table', e.evidence #>> '{lineage,source_document_table}',
        'source_document_id', e.evidence #>> '{lineage,source_document_id}',
        'line_number', (e.evidence ->> 'line_number')::int,
        'item_id', e.item_id,
        'link_id', e.link_id,
        'link_basis', e.evidence ->> 'link_basis',
        'link_confidence', (e.evidence ->> 'link_confidence')::numeric,
        'page', NULL,
        'page_reason', 'line-to-page mapping unresolved'),
      'printed', jsonb_build_object(
        'attributed_to', 'document',
        'line_date', e.evidence #>> '{printed_claims,line_date}',
        'hours', (e.evidence #>> '{printed_claims,hours}')::numeric,
        'performer', e.evidence #>> '{printed_claims,performer}'),
      'printed_performer', jsonb_build_object(
        'label', 'performer as printed on the document (document testimony)',
        'value', e.evidence #>> '{printed_claims,performer}'),
      'custodian', jsonb_build_object(
        'label', 'account the document is filed under (custody only, not ownership or payment)',
        'user_id', CASE WHEN g.tied THEN (e.evidence #>> '{source_custody,custodian_user_id}')::uuid END,
        'masked', NOT g.tied),
      'judgment', CASE WHEN j.id IS NULL THEN NULL ELSE jsonb_build_object(
        'question_id', j.id,
        'status', j.status,
        'question', j.question_kind,
        'asked_at', j.created_at,
        'holder', CASE WHEN j.status = 'claimed' THEN jsonb_build_object(
                    'label', 'worker holding this question (not a person on the document)',
                    'claimed_by', j.claimed_by, 'claimed_at', j.claimed_at) END,
        'answer', CASE WHEN j.status = 'answered' THEN jsonb_build_object(
                    'visible', j.answer ->> 'visible',
                    'installed', j.answer ->> 'installed',
                    'confidence', (j.answer ->> 'confidence')::numeric,
                    'image_id', CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(f.shown) s
                                                   WHERE s ->> 'image_id' = j.answer ->> 'image_id')
                                     THEN j.answer ->> 'image_id' END,
                    'quote', j.answer ->> 'quote',
                    'answered_at', j.answered_at,
                    'answer_agent', j.answer_agent,
                    'answer_model', j.answer_model,
                    'reading', 'a model''s reading of a proposed context, not an owner Sign or proof') END) END
    ) AS row,
    e.receipt_id, (e.evidence ->> 'line_number')::int AS line_number, e.id
      FROM ev e CROSS JOIN gate g
      LEFT JOIN frames f ON f.evidence_id = e.id
      LEFT JOIN judgment j ON j.subject_id = e.item_id
     WHERE e.conclusion <> 'source_withdrawn'
  ),
  gone AS (
    SELECT jsonb_build_object(
      'evidence_id', e.id,
      'receipt_id', e.receipt_id,
      'item_id', e.item_id,
      'line_number', (p.evidence ->> 'line_number')::int,
      'description', p.evidence ->> 'description',
      'status', 'withdrawn',
      'reason', coalesce(e.evidence #>> '{withdrawn,reason}', e.conclusion_detail ->> 'reason'),
      'prior_evidence_id', coalesce(e.evidence #>> '{withdrawn,prior_evidence_id}', e.conclusion_detail ->> 'prior_evidence_id'),
      'prior_conclusion', p.conclusion,
      'withdrawn_at', e.created_at
    ) AS row, e.receipt_id, (p.evidence ->> 'line_number')::int AS line_number, e.id
      FROM ev e
      LEFT JOIN garage_derivation_evidence p
        ON p.id = coalesce(e.evidence #>> '{withdrawn,prior_evidence_id}', e.conclusion_detail ->> 'prior_evidence_id')::uuid
       AND p.vehicle_id = p_vehicle_id
     WHERE e.conclusion = 'source_withdrawn'
  )
  SELECT jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'page_date', p_page_date,
    'visible', EXISTS (SELECT 1 FROM gate),
    'tied', coalesce((SELECT tied FROM gate), false),
    'relationship', 'proposed context: a receipt line and photos share a time window; not proof of installation, payment, ownership or who did the work',
    'lines', coalesce((SELECT jsonb_agg(row ORDER BY receipt_id, line_number NULLS FIRST, id) FROM cur), '[]'::jsonb),
    'withdrawn', coalesce((SELECT jsonb_agg(row ORDER BY receipt_id, line_number NULLS FIRST, id) FROM gone), '[]'::jsonb))
$$;

COMMENT ON FUNCTION public.get_vehicle_receipt_work_context(uuid, date) IS
  'Read-only consumer of receipt_work_correlation: current proposed receipt-line/photo context for a vehicle the signed-in caller may view, with visible frames only, lineage (page unresolved), document-attributed printed claims, withdrawals apart, and the line''s judgment state. Photographer, printed performer, custodian and holder are separate labelled fields; none asserts ownership, payment, installation or who did the work.';

REVOKE ALL ON FUNCTION public.get_vehicle_receipt_work_context(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_vehicle_receipt_work_context(uuid, date) TO authenticated, service_role;
