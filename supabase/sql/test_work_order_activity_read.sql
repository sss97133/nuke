-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations.
-- work_order_activity_read over the golden-path job (offer, cosign, quote, change order, evidence, start, completion,
-- invoice, payment witnesses and a test-mode processor payment), plus one retained message.
\ir test_work_order_invoice_stripe_payments.sql
-- Live tables the chain does not create (subset of columns read by the feed).
CREATE TABLE IF NOT EXISTS public.work_order_retained_testimony(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), work_order_id uuid, line_item_id uuid,
  lifecycle_stage text, speaker_label text, speaker_side text, basis_observation_id uuid, basis_excerpt text, recorded_at timestamptz DEFAULT now());
ALTER TABLE public.vehicle_images ADD COLUMN IF NOT EXISTS thumbnail_url text, ADD COLUMN IF NOT EXISTS medium_url text;
ALTER TABLE public.work_order_status_history ADD COLUMN IF NOT EXISTS old_status text, ADD COLUMN IF NOT EXISTS new_status text,
  ADD COLUMN IF NOT EXISTS changed_by uuid, ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,observed_at,extraction_method,structured_data)
SELECT 'e7a00000-0000-0000-0000-000000000001','e7300000-0000-0000-0000-000000000001','work_record',(SELECT id FROM observation_sources ORDER BY id LIMIT 1),
  '2026-10-01T15:00:00Z','retained_message_v1','{}'::jsonb;
INSERT INTO work_order_retained_testimony(work_order_id,lifecycle_stage,speaker_label,speaker_side,basis_observation_id,basis_excerpt) VALUES
 ('e7400000-0000-0000-0000-000000000001','operation_completed','Shop','provider','e7a00000-0000-0000-0000-000000000001','SECRET EXCERPT exhaust is done'),
 ('e7400000-0000-0000-0000-000000000001','invoice_issued','Shop','provider','e7a00000-0000-0000-0000-000000000001','SECRET EXCERPT invoice attached');
INSERT INTO work_order_status_history(work_order_id,old_status,new_status,changed_by) VALUES
 ('e7400000-0000-0000-0000-000000000001','quoted','in_progress','e7000000-0000-0000-0000-0000000000a1');
\ir ../migrations/20261020111500_work_order_activity_read.sql

UPDATE vehicles SET is_public = true WHERE id = 'e7300000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT t_as('e7000000-0000-0000-0000-0000000000c1');
SELECT work_order_activity_read('e7400000-0000-0000-0000-000000000001') AS fc \gset
SELECT work_order_activity_read('e7400000-0000-0000-0000-000000000001', now() + interval '1 hour') AS fnone \gset
SELECT work_order_activity_read('e7400000-0000-0000-0000-000000000001', NULL, 3) AS f3 \gset
SELECT t_as('e7000000-0000-0000-0000-000000000099');
SELECT work_order_activity_read('e7400000-0000-0000-0000-000000000001') AS fs \gset
RESET ROLE;
SET ROLE anon;
SELECT t_as(NULL);
SELECT work_order_activity_read('e7400000-0000-0000-0000-000000000001') AS fa \gset
RESET ROLE;

SELECT t_assert((SELECT array_agg(DISTINCT x->>'kind' ORDER BY x->>'kind') FROM jsonb_array_elements((:'fc'::jsonb)->'events') x)
  @> ARRAY['completion_accepted','completion_attested','evidence','invoice_issued','message','offer','paid','payment_witnessed','provider_booked',
           'quote','quote_accepted','requested','status_changed','work_started'],
  'customer: every kind of event on the golden-path job is in the feed');
SELECT t_assert((:'fc'::jsonb)->'events' @> '[{"kind":"quote","title":"Quote v1 issued","basis":"authenticated_sign"}]'
  AND (:'fc'::jsonb)->'events' @> '[{"kind":"paid","title":"Test card payment recorded","basis":"processor_record"}]'
  AND (:'fc'::jsonb)->'events' @> '[{"kind":"message","basis":"message_testimony","role":"provider","title":"Message from the shop: invoice sent, work finished","at":"2026-10-01T15:00:00+00:00"}]'
  AND (:'fc'::jsonb)->'events' @> '[{"kind":"status_changed","basis":"record","title":"Status recorded as in progress"}]',
  'titles and bases: Signs, processor record, one message event at the message clock, recorded status');
SELECT t_assert((SELECT bool_and((a->>'at')::timestamptz >= (b->>'at')::timestamptz)
  FROM jsonb_array_elements((:'fc'::jsonb)->'events') WITH ORDINALITY x(a, i)
  JOIN jsonb_array_elements((:'fc'::jsonb)->'events') WITH ORDINALITY y(b, j) ON j = i + 1),'events newest first');
SELECT t_assert(NOT :'fc' ~ '(e7000000-0000-0000-0000-0000000000(c1|a1|ad|b0|e1|f1)|1100\.25|SECRET EXCERPT|goldie|Clientname)','no user ids, amounts, message text or names');
SELECT t_assert((:'fc'::jsonb)#>'{live}' @> '{"phase":"settled","poll_after_seconds":300}'
  AND ((:'fc'::jsonb)#>>'{live,events_total}')::int = jsonb_array_length((:'fc'::jsonb)->'events')
  AND length((:'fc'::jsonb)#>>'{live,version}') = 32,'live block: settled phase, total, version');
SELECT t_assert(jsonb_array_length((:'fnone'::jsonb)->'events') = 0 AND (:'fnone'::jsonb)#>>'{live,version}' = (:'fc'::jsonb)#>>'{live,version}'
  AND jsonb_array_length((:'f3'::jsonb)->'events') = 3,'since filters by recorded clock; limit applies; version is stable without new events');
SELECT t_assert((:'fs'::jsonb)#>'{viewer,party}' = 'false'::jsonb AND (:'fa'::jsonb)#>'{viewer,party}' = 'false'::jsonb
  AND (:'fa'::jsonb)#>>'{live,version}' = (:'fc'::jsonb)#>>'{live,version}'
  AND NOT :'fa' ~ '(e7000000-0000-0000-0000-0000000000|1100\.25|SECRET EXCERPT)','visitor and stranger on a public vehicle: same feed, no ids or amounts');
SELECT t_assert((SELECT bool_and((x#>>'{media,withheld}')::int + jsonb_array_length(x#>'{media,thumbnails}') >= 1)
  FROM jsonb_array_elements((:'fc'::jsonb)->'events') x WHERE x->>'kind' = 'evidence'),'evidence events carry thumbnails or a withheld count');

INSERT INTO work_order_status_history(work_order_id,old_status,new_status) VALUES ('e7400000-0000-0000-0000-000000000001','in_progress','completed');
SET ROLE authenticated;
SELECT t_as('e7000000-0000-0000-0000-0000000000c1');
SELECT work_order_activity_read('e7400000-0000-0000-0000-000000000001', ((:'fc'::jsonb)#>>'{live,latest_recorded_at}')::timestamptz - interval '1 microsecond') AS fnew \gset
RESET ROLE;
SELECT t_assert((:'fnew'::jsonb)#>>'{live,version}' <> (:'fc'::jsonb)#>>'{live,version}'
  AND (:'fnew'::jsonb)->'events' @> '[{"kind":"status_changed","title":"Status recorded as completed"}]','a new event changes the version and appears since the last clock');

UPDATE vehicles SET is_public = false WHERE id = 'e7300000-0000-0000-0000-000000000001';
SET ROLE anon;
SELECT t_as(NULL);
SELECT t_assert(t_refused($q$SELECT work_order_activity_read('e7400000-0000-0000-0000-000000000001')$q$),'anon on a private vehicle: unavailable');
RESET ROLE;
SELECT t_assert(has_function_privilege('anon','work_order_activity_read(uuid,timestamptz,integer)','EXECUTE'),'reader open behind its gate');
