-- Prepared only. No cron, payment writer, completion writer or source backfill.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS public.work_money_ingest_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id),
  source text NOT NULL CHECK (source IN ('gmail','imessage','sms')),
  mode text NOT NULL CHECK (mode IN ('poll','backfill')),
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL CHECK (window_end > window_start),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','failed')),
  scanned integer NOT NULL DEFAULT 0 CHECK (scanned >= 0),
  staged integer NOT NULL DEFAULT 0 CHECK (staged >= 0),
  last_message_at timestamptz,
  error_code text,
  UNIQUE(id,owner_id,source)
);
CREATE INDEX IF NOT EXISTS work_money_runs_owner_source ON public.work_money_ingest_runs(owner_id,source,started_at DESC);
CREATE TABLE IF NOT EXISTS public.work_money_staging (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id),
  source text NOT NULL CHECK (source IN ('gmail','imessage','sms')),
  source_message_id text NOT NULL CHECK (length(source_message_id) BETWEEN 1 AND 256),
  thread_id text,
  rfc_message_id text,
  sender text NOT NULL,
  received_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  subject text NOT NULL,
  excerpt text NOT NULL CHECK (length(excerpt) <= 4000),
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(attachments)='array'),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  classifier_version text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('payment_received','deposit','invoice','bat_payout','bat_sale_notice','books_open_question')),
  direction text NOT NULL CHECK (direction IN ('inbound_claim','outbound','unknown')),
  amount_cents bigint CHECK (amount_cents >= 0),
  currency text CHECK (currency ~ '^[A-Z]{3}$'),
  candidate_counterparty text,
  candidate_vehicle text,
  confidence numeric NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  reasons jsonb NOT NULL CHECK (jsonb_typeof(reasons)='array'),
  proposals jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(proposals)='array'),
  status text NOT NULL DEFAULT 'pending_confirmation' CHECK (status='pending_confirmation'),
  run_id uuid NOT NULL,
  FOREIGN KEY(run_id,owner_id,source) REFERENCES public.work_money_ingest_runs(id,owner_id,source),
  UNIQUE(owner_id,source,source_message_id,classifier_version)
);
CREATE INDEX IF NOT EXISTS work_money_staging_owner_date ON public.work_money_staging(owner_id,received_at DESC);
COMMENT ON TABLE public.work_money_staging IS 'Private immutable source interpretations, not payments or completion. Writer: stage_work_money_email. Pending proposals require a later explicit owner Sign through canonical work writers.';
COMMENT ON TABLE public.work_money_ingest_runs IS 'Private source liveness and bounded scan receipts. Running/failed scans never advance successful coverage. Writer: work_money_run_start / work_money_run_finish.';
ALTER TABLE public.work_money_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_money_ingest_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS work_money_owner_read ON public.work_money_staging;
CREATE POLICY work_money_owner_read ON public.work_money_staging FOR SELECT TO authenticated USING (owner_id=(SELECT auth.uid()));
DROP POLICY IF EXISTS work_money_runs_owner_read ON public.work_money_ingest_runs;
CREATE POLICY work_money_runs_owner_read ON public.work_money_ingest_runs FOR SELECT TO authenticated USING (owner_id=(SELECT auth.uid()));
REVOKE ALL ON public.work_money_staging,public.work_money_ingest_runs FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.work_money_staging,public.work_money_ingest_runs TO authenticated,service_role;

-- Reuse canonical party scope; never match against the entire service-visible fleet.
CREATE OR REPLACE FUNCTION public.work_money_candidate_jobs(p_owner uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM (
    SELECT w.id,w.vehicle_id,w.title,w.customer_name,w.customer_email,w.estimated_total,w.currency,w.created_at,w.status,
      concat_ws(' ',v.year,v.make,v.model) AS vehicle_label
    FROM public.work_order_viewer_slots(p_owner,NULL,NULL) s
    JOIN public.work_orders w ON w.id=s.work_order_id
    LEFT JOIN public.vehicles v ON v.id=w.vehicle_id
    WHERE public.job_reader_is_party(s.slots) AND w.status NOT IN ('completed','paid','cancelled')
    ORDER BY w.id LIMIT 501
  ) x;
$$;
CREATE OR REPLACE FUNCTION public.work_money_run_start(p_owner uuid,p_source text,p_mode text,p_after timestamptz,p_before timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result uuid;
BEGIN
  IF p_before > now()+interval '1 minute' OR p_before-p_after > interval '31 days' THEN RAISE EXCEPTION 'invalid scan window'; END IF;
  INSERT INTO public.work_money_ingest_runs(owner_id,source,mode,window_start,window_end)
  VALUES(p_owner,p_source,p_mode,p_after,p_before) RETURNING id INTO result;
  RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.stage_work_money_email(p_run uuid,p_email jsonb,p_signal jsonb,p_proposals jsonb,p_sha text,p_version text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.work_money_ingest_runs; result uuid; candidate jsonb;
BEGIN
  SELECT * INTO STRICT r FROM public.work_money_ingest_runs WHERE id=p_run FOR UPDATE;
  IF r.status<>'running' THEN RAISE EXCEPTION 'run closed'; END IF;
  IF (p_email->>'receivedAt')::timestamptz < r.window_start OR (p_email->>'receivedAt')::timestamptz >= r.window_end THEN RAISE EXCEPTION 'message outside scan window'; END IF;
  IF jsonb_typeof(p_proposals)<>'array' OR jsonb_array_length(p_proposals)>500 THEN RAISE EXCEPTION 'invalid proposals'; END IF;
  FOR candidate IN SELECT value FROM jsonb_array_elements(p_proposals) LOOP
    IF candidate->>'status' IS DISTINCT FROM 'pending_confirmation'
      OR p_signal->>'direction' IS DISTINCT FROM 'inbound_claim'
      OR NOT EXISTS (
        SELECT 1 FROM public.work_order_viewer_slots(r.owner_id,(candidate->>'work_order_id')::uuid,NULL) s
        JOIN public.work_orders w ON w.id=s.work_order_id
        WHERE public.job_reader_is_party(s.slots) AND w.status NOT IN ('completed','paid','cancelled')
          AND w.vehicle_id IS NOT DISTINCT FROM (candidate->>'vehicle_id')::uuid
      ) THEN RAISE EXCEPTION 'invalid or out of scope proposal'; END IF;
  END LOOP;
  INSERT INTO public.work_money_staging(owner_id,source,source_message_id,thread_id,rfc_message_id,sender,received_at,subject,excerpt,attachments,
    source_sha256,classifier_version,kind,direction,amount_cents,currency,candidate_counterparty,candidate_vehicle,confidence,reasons,proposals,run_id)
  VALUES(r.owner_id,r.source,p_email->>'id',p_email->>'threadId',p_email->>'messageId',p_email->>'sender',(p_email->>'receivedAt')::timestamptz,
    p_email->>'subject',left(p_email->>'text',4000),coalesce(p_email->'attachments','[]'),p_sha,p_version,p_signal->>'kind',p_signal->>'direction',
    (p_signal->>'amountCents')::bigint,p_signal->>'currency',p_signal->>'candidateCounterparty',p_signal->>'candidateVehicle',
    (p_signal->>'confidence')::numeric,p_signal->'reasons',p_proposals,r.id)
  ON CONFLICT(owner_id,source,source_message_id,classifier_version) DO NOTHING RETURNING id INTO result;
  -- Existing interpretation is never overwritten; a version change retains both.
  RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.work_money_run_finish(p_run uuid,p_success boolean,p_scanned integer,p_staged integer,p_last_message timestamptz,p_error text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_staged>p_scanned OR length(p_error)>80 THEN RAISE EXCEPTION 'invalid run receipt'; END IF;
  UPDATE public.work_money_ingest_runs SET finished_at=now(),status=CASE WHEN p_success THEN 'success' ELSE 'failed' END,
    scanned=p_scanned,staged=p_staged,last_message_at=p_last_message,error_code=p_error
    WHERE id=p_run AND status='running';
  IF NOT FOUND THEN RAISE EXCEPTION 'run closed or missing'; END IF;
END $$;
CREATE OR REPLACE VIEW public.work_money_source_health WITH (security_invoker=true) AS
SELECT owner_id,source,max(started_at) AS last_attempt_at,
  max(finished_at) FILTER(WHERE status='success') AS last_success_at,
  max(window_end) FILTER(WHERE status='success' AND mode='poll') AS covered_through,
  max(last_message_at) FILTER(WHERE status='success') AS last_message_at,
  (array_agg(status ORDER BY started_at DESC,id DESC))[1] AS latest_status,
  (array_agg(error_code ORDER BY started_at DESC,id DESC))[1] AS latest_error_code
FROM public.work_money_ingest_runs GROUP BY owner_id,source;
CREATE OR REPLACE VIEW public.work_money_pending_confirmations WITH (security_invoker=true) AS
SELECT * FROM public.work_money_staging WHERE status='pending_confirmation';
REVOKE ALL ON public.work_money_source_health,public.work_money_pending_confirmations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.work_money_source_health,public.work_money_pending_confirmations TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.work_money_candidate_jobs(uuid),public.work_money_run_start(uuid,text,text,timestamptz,timestamptz),
 public.stage_work_money_email(uuid,jsonb,jsonb,jsonb,text,text),public.work_money_run_finish(uuid,boolean,integer,integer,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.work_money_candidate_jobs(uuid),public.work_money_run_start(uuid,text,text,timestamptz,timestamptz),
 public.stage_work_money_email(uuid,jsonb,jsonb,jsonb,text,text),public.work_money_run_finish(uuid,boolean,integer,integer,timestamptz,text) TO service_role;
COMMIT;
