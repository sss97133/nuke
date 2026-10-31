BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

-- A typed projection of the existing book's attributed use cells, not another money ledger.
-- Grain: one allocation in one immutable source extraction. A book expense is not a cash
-- payment, and a customer receipt is not a vehicle sale. The original cells own testimony.
CREATE TABLE public.financial_use_statements (
  source_extraction_id uuid PRIMARY KEY REFERENCES public.financial_document_extractions(id),
  owner_id uuid NOT NULL REFERENCES auth.users(id),
  claim_document_id uuid NOT NULL REFERENCES public.financial_documents(id),
  document_id uuid NOT NULL REFERENCES public.financial_documents(id),
  record_line_id uuid NOT NULL REFERENCES public.financial_document_lines(id),
  record_source_key text NOT NULL CHECK (record_source_key ~ '^[a-f0-9]{64}$'),
  phase text NOT NULL CHECK (phase IN ('book_expense','customer_receipt','customer_refund')),
  source_amount numeric NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  bank_line_id uuid REFERENCES public.financial_document_lines(id),
  bank_document_id uuid REFERENCES public.financial_documents(id),
  bank_source_key text CHECK (bank_source_key ~ '^[a-f0-9]{64}$'),
  CHECK ((bank_line_id IS NULL) = (bank_document_id IS NULL)),
  CHECK ((bank_line_id IS NULL) = (bank_source_key IS NULL)),
  CHECK (phase='book_expense' OR bank_line_id IS NOT NULL)
);
CREATE TABLE public.financial_vehicle_uses (
  source_extraction_id uuid NOT NULL REFERENCES public.financial_use_statements(source_extraction_id),
  allocation_index integer NOT NULL CHECK (allocation_index BETWEEN 1 AND 50),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  work_order_id uuid REFERENCES public.work_orders(id),
  allocated_amount numeric,
  invoice_document_id uuid REFERENCES public.financial_documents(id),
  invoice_reference text CHECK (length(invoice_reference) <= 160),
  receipt_id uuid REFERENCES public.receipts(id),
  receipt_item_id uuid REFERENCES public.receipt_items(id),
  work_session_id uuid REFERENCES public.work_sessions(id),
  basis text CHECK (basis IS NULL OR length(basis) BETWEEN 1 AND 2000),
  PRIMARY KEY (source_extraction_id,allocation_index),
  CHECK (receipt_item_id IS NULL OR receipt_id IS NOT NULL)
);
-- Citations carry no money. Multiple originals/work photos cannot multiply an allocation.
CREATE TABLE public.financial_use_witnesses (
  source_extraction_id uuid NOT NULL,
  allocation_index integer NOT NULL,
  witness_index integer NOT NULL CHECK (witness_index BETWEEN 1 AND 20),
  document_id uuid REFERENCES public.financial_documents(id),
  receipt_id uuid REFERENCES public.receipts(id),
  observation_id uuid REFERENCES public.vehicle_observations(id),
  image_id uuid REFERENCES public.vehicle_images(id),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 300),
  PRIMARY KEY(source_extraction_id,allocation_index,witness_index),
  FOREIGN KEY(source_extraction_id,allocation_index)
    REFERENCES public.financial_vehicle_uses(source_extraction_id,allocation_index),
  CHECK (num_nonnulls(document_id,receipt_id,observation_id,image_id)=1)
);
ALTER TABLE public.financial_use_witnesses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.financial_use_witnesses FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE public.financial_use_witnesses IS
 'Derived nonmonetary source/work/photo citations on one allocation, retained with the original attributed use cell. A citation is neither another cost nor proof of installation or payment. An unfiled receipt may be cited without changing its scope.';
ALTER TABLE public.financial_vehicle_uses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_use_statements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.financial_vehicle_uses FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.financial_use_statements FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX financial_vehicle_uses_subject ON public.financial_vehicle_uses(vehicle_id);
CREATE INDEX financial_use_statements_record ON public.financial_use_statements(owner_id,document_id,record_source_key);
CREATE INDEX financial_use_statements_bank ON public.financial_use_statements(owner_id,bank_source_key) WHERE bank_source_key IS NOT NULL;
CREATE INDEX financial_use_current_cells ON public.financial_document_extractions(document_id,owner_id)
  WHERE NOT is_superseded AND (field_key LIKE 'expense\_use\_%' OR field_key LIKE 'financial\_use\_%');
COMMENT ON TABLE public.financial_vehicle_uses IS
 'Derived state: one vehicle/job/item allocation in a financial-use statement. The source statement owns money phase and witnesses; allocation lines conserve its supported amount.';
COMMENT ON TABLE public.financial_use_statements IS
 'Derived state: one immutable attributed use statement, FK-linked to its claim extraction and book/bank witness rows. Complete allocation vectors may be empty to explicitly withdraw vehicle use. Testimony remains in financial_document_extractions.';

CREATE FUNCTION public.project_financial_vehicle_uses(p_document_id uuid,p_from_intake boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  d public.financial_documents%ROWTYPE; e record; line public.financial_document_lines%ROWTYPE;
  bank public.financial_document_lines%ROWTYPE; v jsonb; a jsonb; rec jsonb; bank_rec jsonb;
  allocations jsonb; v_phase text; source_amount numeric; assigned numeric; total numeric;
  currency text; bank_amount numeric; idx integer; inserted integer:=0; n integer; legacy boolean;
  vehicle uuid; job uuid; invoice uuid; receipt uuid; item uuid; session_id uuid;
  w jsonb; wi integer; wd uuid; wr uuid; wo uuid; wp uuid;
BEGIN
  SELECT * INTO d FROM public.financial_documents WHERE id=p_document_id;
  IF d.id IS NULL OR d.attributes->>'intake_mode' IS DISTINCT FROM 'financial_evidence_v1' THEN RETURN 0; END IF;
  -- The final document update in the sanctioned intake happens after its source cells and
  -- accounting lines exist. Only current cells enter today's state; old projected edges remain.
  FOR e IN SELECT f.* FROM public.financial_document_extractions f
    WHERE f.document_id=d.id AND f.owner_id=d.owner_id AND NOT f.is_superseded
      AND (f.field_key LIKE 'expense\_use\_%' OR f.field_key LIKE 'financial\_use\_%')
    ORDER BY f.value_normalized->'value'->>'bank_source_key' NULLS FIRST,f.field_key
  LOOP
    v:=e.value_normalized->'value'; legacy:=e.field_key LIKE 'expense\_use\_%';
    IF legacy AND (v->>'use_type' IS DISTINCT FROM 'vehicle' OR coalesce(v->>'vehicle_id','') !~* '^[a-f0-9]{8}-([a-f0-9]{4}-){3}[a-f0-9]{12}$') THEN CONTINUE; END IF;
    IF NOT legacy AND v ? 'record_line_id' THEN
      SELECT l.* INTO line FROM public.financial_document_lines l
        WHERE l.id=(v->>'record_line_id')::uuid AND l.owner_id=d.owner_id
          AND l.attributes->>'intake_mode'='financial_evidence_v1'
          AND l.document_id=(v->>'record_document_id')::uuid
          AND l.attributes->'accounting_record'->>'source_key'=v->>'source_key';
    ELSE
      SELECT l.* INTO line FROM public.financial_document_lines l
        WHERE l.owner_id=d.owner_id AND l.document_id=d.id
          AND l.attributes->>'intake_mode'='financial_evidence_v1'
          AND l.attributes->>'extraction_run_id'=e.extraction_run_id::text
          AND l.attributes->'accounting_record'->>'source_key'=v->>'source_key' LIMIT 1;
    END IF;
    IF line.id IS NULL THEN
      IF legacy THEN CONTINUE; ELSE RAISE EXCEPTION 'financial use requires an addressed record in the same book'; END IF;
    END IF;
    rec:=line.attributes->'accounting_record';
    v_phase:=CASE WHEN legacy THEN 'book_expense' ELSE v->>'phase' END;
    -- A narrow editor must not silently overwrite a current complete vector. Book
    -- corrections carrying the unchanged old cell remain valid; actual assignment
    -- changes must revise the complete statement through its own original.
    IF p_from_intake AND legacy AND EXISTS(
      SELECT 1 FROM public.financial_use_statements s JOIN public.financial_document_extractions sf
        ON sf.id=s.source_extraction_id AND NOT sf.is_superseded
      WHERE s.owner_id=d.owner_id AND s.document_id=line.document_id AND s.record_source_key=rec->>'source_key'
        AND s.phase='book_expense' AND sf.field_key LIKE 'financial\_use\_%'
    ) AND NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(d.attributes->'runs') run
      JOIN public.financial_document_extractions prior ON prior.document_id=d.id
        AND prior.extraction_run_id::text=run->>'supersedes_run_id' AND prior.field_key=e.field_key
      WHERE run->>'run_id'=e.extraction_run_id::text
        AND prior.value_normalized->'value'=v
        AND prior.value_normalized->'evidence'=e.value_normalized->'evidence'
    ) THEN RAISE EXCEPTION 'revise the current complete allocation statement instead of the narrow expense use'; END IF;
    currency:=v->>'currency';
    IF coalesce(v->>'book_amount','') !~ '^-?[0-9]{1,12}(\.[0-9]{1,6})?$'
      OR coalesce(currency,'') !~ '^[A-Z]{3}$'
      OR coalesce(v_phase,'') NOT IN ('book_expense','customer_receipt','customer_refund')
    THEN IF legacy THEN CONTINUE; ELSE RAISE EXCEPTION 'invalid financial use phase, currency or source amount'; END IF; END IF;
    source_amount:=(v->>'book_amount')::numeric;
    IF NOT legacy AND (rec->>'record_kind' IS DISTINCT FROM 'retained_ledger_decision'
      OR rec->>'currency' IS DISTINCT FROM currency
      OR coalesce(rec->>'amount','') !~ '^-?[0-9]{1,12}(\.[0-9]{1,6})?$'
      OR (v_phase='book_expense' AND rec->>'section' IS DISTINCT FROM 'Expense')
      OR (v_phase='customer_receipt' AND rec->>'section' IS DISTINCT FROM 'Revenue')) THEN
      RAISE EXCEPTION 'financial use phase or currency differs from the source'; END IF;
    IF NOT legacy AND (rec->>'amount')::numeric<>source_amount THEN
      RAISE EXCEPTION 'financial use amount differs from the addressed source'; END IF;
    allocations:=CASE WHEN legacy THEN jsonb_build_array(v) ELSE v->'allocations' END;
    IF jsonb_typeof(allocations) IS DISTINCT FROM 'array' OR jsonb_array_length(allocations)>50 THEN
      RAISE EXCEPTION 'financial use requires bounded allocations'; END IF;
    IF e.field_key IS DISTINCT FROM (CASE WHEN legacy THEN 'expense_use_' ELSE 'financial_use_' END)||left(v->>'source_key',24) THEN
      RAISE EXCEPTION 'financial use key does not address its source record'; END IF;
    bank:=NULL; bank_rec:=NULL; bank_amount:=NULL;
    IF NOT legacy AND v ? 'bank_line_id' THEN
      SELECT l.* INTO bank FROM public.financial_document_lines l
        WHERE l.id=(v->>'bank_line_id')::uuid AND l.owner_id=d.owner_id AND l.document_id=(v->>'bank_document_id')::uuid
          AND l.attributes->>'intake_mode'='financial_evidence_v1'
          AND l.attributes->'accounting_record'->>'source_key'=v->>'bank_source_key'
        LIMIT 1;
      bank_rec:=bank.attributes->'accounting_record';
      IF bank.id IS NULL OR bank_rec->>'record_kind' IS DISTINCT FROM 'retained_bank_movement'
        OR bank_rec->>'currency' IS DISTINCT FROM currency
        OR coalesce(bank_rec->>'amount','') !~ '^-?[0-9]{1,12}(\.[0-9]{1,6})?$'
      THEN RAISE EXCEPTION 'financial use requires the same book currency and an addressed bank witness'; END IF;
      bank_amount:=(bank_rec->>'amount')::numeric;
    END IF;
    IF (v_phase='customer_receipt' AND coalesce(bank_amount,0)<=0)
      OR (v_phase='customer_refund' AND coalesce(bank_amount,0)>=0)
      OR (v_phase='book_expense' AND bank.id IS NOT NULL AND source_amount<>0 AND sign(bank_amount)=sign(source_amount)) THEN
      RAISE EXCEPTION 'customer cash phase requires a correctly directed bank source'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(d.owner_id::text||':'||line.document_id::text||':'||(rec->>'source_key')||':'||v_phase,0));
    IF NOT legacy AND EXISTS(
      SELECT 1 FROM public.financial_use_statements s JOIN public.financial_document_extractions sf
        ON sf.id=s.source_extraction_id AND NOT sf.is_superseded
      WHERE s.owner_id=d.owner_id AND s.document_id=line.document_id AND s.record_source_key=rec->>'source_key'
        AND s.phase=v_phase AND s.source_extraction_id<>e.id AND sf.field_key LIKE 'financial\_use\_%'
    ) THEN RAISE EXCEPTION 'supersede the current use statement before assigning a second vector'; END IF;
    INSERT INTO public.financial_use_statements(source_extraction_id,owner_id,claim_document_id,document_id,record_line_id,
      record_source_key,phase,source_amount,currency,bank_line_id,bank_document_id,bank_source_key)
    VALUES(e.id,d.owner_id,d.id,line.document_id,line.id,rec->>'source_key',v_phase,source_amount,currency,
      bank.id,bank.document_id,bank_rec->>'source_key') ON CONFLICT DO NOTHING;
    total:=0; idx:=0;
    FOR a IN SELECT value FROM jsonb_array_elements(allocations) LOOP
      idx:=idx+1;
      vehicle:=(a->>'vehicle_id')::uuid; job:=CASE WHEN NOT legacy THEN (a->>'work_order_id')::uuid END;
      invoice:=CASE WHEN NOT legacy THEN (a->>'invoice_document_id')::uuid END;
      receipt:=CASE WHEN NOT legacy THEN (a->>'receipt_id')::uuid END;
      item:=CASE WHEN NOT legacy THEN (a->>'receipt_item_id')::uuid END;
      session_id:=CASE WHEN NOT legacy THEN (a->>'work_session_id')::uuid END;
      IF vehicle IS NULL OR NOT EXISTS(SELECT 1 FROM public.vehicles WHERE id=vehicle)
        OR (NOT legacy AND coalesce(length(a->>'basis'),0) NOT BETWEEN 1 AND 2000)
        OR (job IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.work_orders WHERE id=job AND vehicle_id=vehicle))
        OR (invoice IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.financial_documents WHERE id=invoice AND owner_id=d.owner_id))
        OR (receipt IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.receipts WHERE id=receipt AND vehicle_id=vehicle
          AND scope_type='vehicle' AND scope_id::text=vehicle::text AND is_active AND NOT is_superseded AND duplicate_of IS NULL))
        OR (item IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.receipt_items WHERE id=item AND receipt_id=receipt))
        OR (session_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.work_sessions WHERE id=session_id AND vehicle_id=vehicle))
      THEN IF legacy THEN CONTINUE; ELSE RAISE EXCEPTION 'financial use references must belong to this source book and vehicle'; END IF; END IF;
      assigned:=NULL;
      IF a->>'allocated_amount' IS NOT NULL THEN
        IF a->>'allocated_amount' !~ '^-?[0-9]{1,12}(\.[0-9]{1,6})?$' THEN
          IF NOT legacy THEN RAISE EXCEPTION 'invalid allocated amount'; END IF;
        ELSE assigned:=(a->>'allocated_amount')::numeric; END IF;
        IF NOT legacy AND ((v_phase<>'book_expense' AND assigned<0) OR (v_phase='book_expense' AND assigned<>0 AND sign(assigned)<>sign(source_amount))) THEN
          RAISE EXCEPTION 'financial allocation direction differs from its phase'; END IF;
        total:=total+coalesce(abs(assigned),0);
      END IF;
      INSERT INTO public.financial_vehicle_uses(source_extraction_id,allocation_index,vehicle_id,work_order_id,allocated_amount,
        invoice_document_id,invoice_reference,receipt_id,receipt_item_id,work_session_id,basis)
      VALUES(e.id,idx,vehicle,job,assigned,invoice,a->>'invoice_reference',receipt,item,session_id,nullif(a->>'basis',''))
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS n=ROW_COUNT; inserted:=inserted+n;
      IF NOT legacy AND a ? 'witnesses' THEN
        IF jsonb_typeof(a->'witnesses') IS DISTINCT FROM 'array' OR jsonb_array_length(a->'witnesses')>20 THEN
          RAISE EXCEPTION 'financial witnesses must be bounded citations'; END IF;
        wi:=0;
        FOR w IN SELECT value FROM jsonb_array_elements(a->'witnesses') LOOP
          wi:=wi+1; wd:=(w->>'document_id')::uuid; wr:=(w->>'receipt_id')::uuid;
          wo:=(w->>'observation_id')::uuid; wp:=(w->>'image_id')::uuid;
          IF num_nonnulls(wd,wr,wo,wp)<>1 OR coalesce(length(w->>'label'),0) NOT BETWEEN 1 AND 300
            OR (wd IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.financial_documents WHERE id=wd AND owner_id=d.owner_id))
            OR (wr IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.receipts WHERE id=wr AND user_id=d.owner_id
              AND is_active AND NOT is_superseded AND duplicate_of IS NULL))
            OR (wo IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vehicle_observations WHERE id=wo AND vehicle_id=vehicle AND NOT coalesce(is_superseded,false)))
            OR (wp IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vehicle_images WHERE id=wp AND vehicle_id=vehicle
              AND NOT coalesce(is_superseded,false) AND NOT coalesce(is_sensitive,false)))
          THEN RAISE EXCEPTION 'financial witness must address a current source in this book or vehicle'; END IF;
          INSERT INTO public.financial_use_witnesses(source_extraction_id,allocation_index,witness_index,document_id,receipt_id,observation_id,image_id,label)
            VALUES(e.id,idx,wi,wd,wr,wo,wp,w->>'label') ON CONFLICT DO NOTHING;
        END LOOP;
      END IF;

    END LOOP;
    IF NOT legacy AND (total>abs(source_amount) OR (bank_amount IS NOT NULL AND total>abs(bank_amount))) THEN
      RAISE EXCEPTION 'financial allocations exceed their supported source amount'; END IF;
    IF bank.id IS NOT NULL THEN
      -- Different invoices/documents cannot each spend the whole same bank movement.
      -- Serialize on the immutable movement key, including allocations on other vehicles.
      PERFORM pg_advisory_xact_lock(hashtextextended(d.owner_id::text||':'||(bank_rec->>'source_key'),0));
      SELECT coalesce(sum(abs(u.allocated_amount)),0) INTO total
        FROM public.financial_vehicle_uses u JOIN public.financial_use_statements s USING(source_extraction_id)
        JOIN public.financial_document_extractions f ON f.id=s.source_extraction_id
        WHERE s.owner_id=d.owner_id AND s.bank_source_key=bank_rec->>'source_key'
          AND s.phase=v_phase AND NOT f.is_superseded;
      IF total>abs(bank_amount) THEN RAISE EXCEPTION 'current allocations exceed the shared bank movement'; END IF;
    END IF;
  END LOOP;
  RETURN inserted;
END $$;
REVOKE ALL ON FUNCTION public.project_financial_vehicle_uses(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.project_financial_vehicle_uses(uuid,boolean) TO service_role;

CREATE FUNCTION public.project_financial_vehicle_uses_after_intake()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM public.project_financial_vehicle_uses(NEW.id,true);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.project_financial_vehicle_uses_after_intake() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER financial_vehicle_uses_after_intake AFTER UPDATE OF attributes ON public.financial_documents
  FOR EACH ROW WHEN (OLD.attributes->'runs' IS DISTINCT FROM NEW.attributes->'runs')
  EXECUTE FUNCTION public.project_financial_vehicle_uses_after_intake();

-- Bounded keyset bootstrap of existing explicit use testimony. No inference, source
-- rewrite, scheduled scan or expense/payment creation occurs here.
CREATE FUNCTION public.backfill_financial_vehicle_uses(p_owner_id uuid,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 10)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d record; visited integer:=0; added integer:=0; after_id uuid:=p_after;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' OR p_owner_id IS NULL OR p_limit NOT BETWEEN 1 AND 25 THEN
    RAISE EXCEPTION 'bounded service projection required' USING ERRCODE='42501'; END IF;
  FOR d IN SELECT DISTINCT f.document_id FROM public.financial_document_extractions f
    WHERE f.owner_id=p_owner_id AND NOT f.is_superseded AND (p_after IS NULL OR f.document_id>p_after)
      AND (f.field_key LIKE 'expense\_use\_%' OR f.field_key LIKE 'financial\_use\_%')
    ORDER BY f.document_id LIMIT p_limit
  LOOP
    added:=added+public.project_financial_vehicle_uses(d.document_id);
    visited:=visited+1; after_id:=d.document_id;
  END LOOP;
  RETURN jsonb_build_object('visited',visited,'projected',added,'after',after_id,'exhausted',visited<p_limit);
END $$;
REVOKE ALL ON FUNCTION public.backfill_financial_vehicle_uses(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_financial_vehicle_uses(uuid,uuid,integer) TO service_role;

CREATE FUNCTION public.accounting_vehicle_financials(p_vehicle_id uuid)
RETURNS TABLE(use_id uuid,allocation_index integer,book_owner_id uuid,document_id uuid,record_source_key text,
  record_line_id uuid,phase text,allocated_amount text,book_amount text,currency text,record_date date,
  description text,category text,account text,basis text,qualification text,
  bank_document_id uuid,bank_source_key text,bank_amount text,bank_date date,bank_remainder text,
  invoice_document_id uuid,invoice_reference text,work_order_id uuid,receipt_id uuid,receipt_item_id uuid,
  work_session_id uuid,evidence jsonb,witnesses jsonb,assigned_by uuid,assigned_method text,assigned_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  WITH caller AS (
    SELECT auth.uid() id WHERE auth.role()='authenticated' AND auth.uid() IS NOT NULL
  ), vehicle AS (
    SELECT v.id FROM public.vehicles v CROSS JOIN caller c
    WHERE v.id=p_vehicle_id AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
      AND (v.owner_id=c.id OR v.user_id=c.id OR v.uploaded_by=c.id
        OR EXISTS(SELECT 1 FROM public.vehicle_ownerships o WHERE o.vehicle_id=v.id AND o.owner_profile_id=c.id AND o.is_current)
        OR EXISTS(SELECT 1 FROM public.ownership_verifications ov WHERE ov.vehicle_id=v.id AND ov.user_id=c.id AND ov.status='approved')
        OR EXISTS(SELECT 1 FROM public.vehicle_contributors vc WHERE vc.vehicle_id=v.id AND vc.user_id=c.id))
  ), books AS (
    SELECT c.id owner_id FROM caller c UNION SELECT g FROM public.accounting_readable_owners() g
  ), current_uses AS MATERIALIZED (
    SELECT u.*,s.owner_id,s.claim_document_id,s.document_id,s.record_line_id,s.record_source_key,s.phase,
      s.source_amount,s.currency,s.bank_line_id,s.bank_document_id,s.bank_source_key,
      f.field_key,f.value_normalized,f.extraction_run_id,f.created_at
    FROM public.financial_vehicle_uses u JOIN public.financial_use_statements s USING(source_extraction_id)
    JOIN books b ON b.owner_id=s.owner_id
    JOIN public.financial_document_extractions f ON f.id=u.source_extraction_id AND NOT f.is_superseded
    WHERE u.vehicle_id=p_vehicle_id AND EXISTS(SELECT 1 FROM vehicle)
      -- A new general expense use explicitly supersedes the old narrow representation.
      AND NOT (f.field_key LIKE 'expense\_use\_%' AND EXISTS(
        SELECT 1 FROM public.financial_use_statements n JOIN public.financial_document_extractions nf
          ON nf.id=n.source_extraction_id AND NOT nf.is_superseded
        WHERE n.owner_id=s.owner_id AND n.document_id=s.document_id AND n.record_source_key=s.record_source_key
          AND n.phase=s.phase AND nf.field_key LIKE 'financial\_use\_%'))
  )
  SELECT u.source_extraction_id,u.allocation_index,u.owner_id,u.document_id,u.record_source_key,u.record_line_id,u.phase,
    u.allocated_amount::text,u.source_amount::text,u.currency,
    public.financial_try_date(rec.r->>'date'),
    rec.r->>'description',rec.r->>'category',rec.r->>'account',u.basis,
    CASE WHEN rec.r->>'record_kind' IS DISTINCT FROM 'retained_ledger_decision'
        OR (u.phase='book_expense' AND rec.r->>'section' IS DISTINCT FROM 'Expense')
        OR (u.phase='customer_receipt' AND rec.r->>'section' IS DISTINCT FROM 'Revenue')
        OR rec.r->>'currency' IS DISTINCT FROM u.currency
        OR coalesce(rec.r->>'amount','') !~ '^-?[0-9]{1,12}(\.[0-9]{1,6})?$' THEN 'source_revised'
      WHEN (rec.r->>'amount')::numeric<>u.source_amount THEN 'source_revised'
      WHEN abs(u.allocated_amount)>abs(u.source_amount) THEN 'overallocated'
      WHEN u.phase='book_expense' AND u.allocated_amount<>0 AND sign(u.allocated_amount)<>sign(u.source_amount) THEN 'direction_conflict'
      WHEN u.bank_line_id IS NOT NULL AND (bank.id IS NULL
        OR bank.r->>'record_kind' IS DISTINCT FROM 'retained_bank_movement'
        OR bank.r->>'currency' IS DISTINCT FROM u.currency
        OR bank.r->>'amount' IS DISTINCT FROM oldbank.attributes->'accounting_record'->>'amount'
        OR bank.r->>'date' IS DISTINCT FROM oldbank.attributes->'accounting_record'->>'date'
        OR bank.r->>'account' IS DISTINCT FROM oldbank.attributes->'accounting_record'->>'account'
        OR bank.r->>'description' IS DISTINCT FROM oldbank.attributes->'accounting_record'->>'description') THEN 'bank_source_revised'
      WHEN u.allocated_amount IS NULL THEN 'unallocated' ELSE 'ready' END,
    u.bank_document_id,u.bank_source_key,
    CASE WHEN bank.r->>'amount' ~ '^-?[0-9]{1,12}(\.[0-9]{1,6})?$' THEN bank.r->>'amount' END,
    public.financial_try_date(bank.r->>'date'),
    CASE WHEN bank.r->>'amount' ~ '^-?[0-9]{1,12}(\.[0-9]{1,6})?$' THEN
      (abs((bank.r->>'amount')::numeric)-coalesce((SELECT sum(abs(n.allocated_amount))
        FROM public.financial_vehicle_uses n JOIN public.financial_use_statements ns USING(source_extraction_id)
        JOIN public.financial_document_extractions nf ON nf.id=n.source_extraction_id
        WHERE ns.owner_id=u.owner_id AND ns.bank_source_key=u.bank_source_key AND ns.phase=u.phase AND NOT nf.is_superseded),0))::text END,
    u.invoice_document_id,u.invoice_reference,u.work_order_id,u.receipt_id,u.receipt_item_id,u.work_session_id,
    u.value_normalized->'evidence',
    coalesce((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'label',w.label,'kind',CASE WHEN w.document_id IS NOT NULL THEN 'document' WHEN w.receipt_id IS NOT NULL THEN 'receipt'
        WHEN w.image_id IS NOT NULL THEN 'image' ELSE 'work' END,
      'id',CASE
        WHEN w.document_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.financial_documents x WHERE x.id=w.document_id AND x.owner_id=u.owner_id) THEN w.document_id
        WHEN w.receipt_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.receipts x WHERE x.id=w.receipt_id AND x.user_id=u.owner_id AND x.is_active AND NOT x.is_superseded AND x.duplicate_of IS NULL) THEN w.receipt_id
        WHEN w.image_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.vehicle_images x WHERE x.id=w.image_id AND x.vehicle_id=u.vehicle_id AND NOT coalesce(x.is_superseded,false) AND NOT coalesce(x.is_sensitive,false)) THEN w.image_id
        WHEN w.observation_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.vehicle_observations x WHERE x.id=w.observation_id AND x.vehicle_id=u.vehicle_id AND NOT coalesce(x.is_superseded,false)) THEN w.observation_id END
    )) ORDER BY w.witness_index) FROM public.financial_use_witnesses w
      WHERE w.source_extraction_id=u.source_extraction_id AND w.allocation_index=u.allocation_index),'[]'::jsonb),
    CASE WHEN assignment.v->>'actor_user_id' ~* '^[a-f0-9-]{36}$' THEN (assignment.v->>'actor_user_id')::uuid END,
    assignment.v->>'method',assignment.at
  FROM current_uses u JOIN public.financial_document_lines l ON l.id=u.record_line_id
  JOIN public.financial_documents doc ON doc.id=u.claim_document_id AND doc.owner_id=u.owner_id
  LEFT JOIN LATERAL(
    SELECT current_line.attributes->'accounting_record' r FROM public.financial_document_lines current_line
    WHERE current_line.owner_id=u.owner_id AND current_line.document_id=u.document_id
      AND current_line.attributes->>'intake_mode'='financial_evidence_v1'
      AND current_line.attributes->'accounting_record'->>'source_key'=u.record_source_key
      AND EXISTS(SELECT 1 FROM public.financial_document_extractions cf WHERE cf.owner_id=u.owner_id
        AND cf.document_id=u.document_id AND NOT cf.is_superseded
        AND cf.extraction_run_id::text=current_line.attributes->>'extraction_run_id')
    LIMIT 1
  ) rec ON true
  LEFT JOIN LATERAL(
    SELECT x.value_normalized v,x.created_at at FROM public.financial_document_extractions x
    JOIN jsonb_array_elements(coalesce(doc.attributes->'runs','[]')) WITH ORDINALITY run(item,n)
      ON run.item->>'run_id'=x.extraction_run_id::text
    WHERE x.owner_id=u.owner_id AND x.document_id=u.claim_document_id AND x.field_key=u.field_key
      AND x.value_normalized->'value'=u.value_normalized->'value'
      AND x.value_normalized->'evidence'=u.value_normalized->'evidence'
    ORDER BY run.n LIMIT 1
  ) assignment ON true
  LEFT JOIN public.financial_document_lines oldbank ON oldbank.id=u.bank_line_id
  LEFT JOIN LATERAL(
    SELECT b.id,b.attributes->'accounting_record' r FROM public.financial_document_lines b
    WHERE b.owner_id=u.owner_id AND b.document_id=u.bank_document_id
      AND b.attributes->>'intake_mode'='financial_evidence_v1'
      AND b.attributes->'accounting_record'->>'source_key'=u.bank_source_key
      AND EXISTS(SELECT 1 FROM public.financial_document_extractions f WHERE f.owner_id=b.owner_id
        AND f.document_id=b.document_id AND NOT f.is_superseded AND f.extraction_run_id::text=b.attributes->>'extraction_run_id')
    LIMIT 1
  ) bank ON true
  ORDER BY 11 NULLS LAST,1,2
$$;
REVOKE ALL ON FUNCTION public.accounting_vehicle_financials(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accounting_vehicle_financials(uuid) TO authenticated;
COMMENT ON FUNCTION public.accounting_vehicle_financials(uuid) IS
 'Current phased vehicle allocations from the caller-readable books AND caller-accessible vehicle. Retains source keys, exact cash witnesses, evidence, stale/unallocated state and remaining bank allocation; exact decimal money strings; never a sale price or lifetime investment claim.';

-- Existing consumers keep their contract while the new typed state bootstraps.
-- A source is returned from exactly one representation; the compatibility path is
-- only for explicit old use cells not projected yet, never an additional subtotal.
ALTER FUNCTION public.accounting_vehicle_costs(uuid) RENAME TO accounting_vehicle_costs_unprojected;
REVOKE ALL ON FUNCTION public.accounting_vehicle_costs_unprojected(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.accounting_vehicle_costs(p_vehicle_id uuid)
RETURNS TABLE(use_id uuid,book_owner_id uuid,document_id uuid,ledger_id text,record_year text,record_date date,
 description text,account text,category text,allocated_amount numeric,book_amount numeric,currency text,
 basis text,assigned_by uuid,assigned_method text,assigned_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  WITH uses AS MATERIALIZED(SELECT * FROM public.accounting_vehicle_financials(p_vehicle_id)
    WHERE phase='book_expense' AND qualification IN ('ready','unallocated'))
  SELECT u.use_id,u.book_owner_id,u.document_id,l.attributes->'accounting_record'->>'local_id',
    l.attributes->'accounting_record'->>'year',u.record_date,u.description,u.account,u.category,
    CASE WHEN bool_and(u.allocated_amount IS NOT NULL) THEN sum(u.allocated_amount::numeric) END,
    u.book_amount::numeric,u.currency,string_agg(DISTINCT u.basis,'; '),u.assigned_by,u.assigned_method,u.assigned_at
  FROM uses u JOIN public.financial_document_lines l ON l.id=u.record_line_id
  GROUP BY u.use_id,u.book_owner_id,u.document_id,l.id,u.record_date,u.description,u.account,u.category,
    u.book_amount,u.currency,u.assigned_by,u.assigned_method,u.assigned_at
  UNION ALL
  SELECT legacy.* FROM public.accounting_vehicle_costs_unprojected(p_vehicle_id) legacy
  JOIN public.financial_document_extractions source ON source.id=legacy.use_id
  WHERE NOT EXISTS(SELECT 1 FROM public.financial_use_statements u
    JOIN public.financial_document_extractions f ON f.id=u.source_extraction_id AND NOT f.is_superseded
    WHERE u.owner_id=legacy.book_owner_id AND u.document_id=legacy.document_id
      AND u.record_source_key=source.value_normalized->'value'->>'source_key' AND u.phase='book_expense')
$$;
REVOKE ALL ON FUNCTION public.accounting_vehicle_costs(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accounting_vehicle_costs(uuid) TO authenticated;
COMMENT ON FUNCTION public.accounting_vehicle_costs(uuid) IS
 'Compatible current booked-expense view over phased financial-use state; unprojected legacy source cells retain access during bounded bootstrap. No customer receipts are treated as costs.';

COMMENT ON COLUMN public.financial_use_statements.source_extraction_id IS 'Immutable attributed source cell; supersession determines currentness.';
COMMENT ON COLUMN public.financial_use_statements.owner_id IS 'Accounting book identity; not inferred vehicle owner or funder.';
COMMENT ON COLUMN public.financial_use_statements.claim_document_id IS 'Original containing this relationship testimony.';
COMMENT ON COLUMN public.financial_use_statements.document_id IS 'Original containing the addressed monetary book record.';
COMMENT ON COLUMN public.financial_use_statements.record_line_id IS 'Immutable monetary record snapshot used for this attribution.';
COMMENT ON COLUMN public.financial_use_statements.record_source_key IS 'Stable source key used to check the current monetary witness.';
COMMENT ON COLUMN public.financial_use_statements.phase IS 'Book expense recognition, customer cash receipt, or customer cash refund; never sale price.';
COMMENT ON COLUMN public.financial_use_statements.source_amount IS 'Exact original book amount, not vehicle allocation or cash settlement.';
COMMENT ON COLUMN public.financial_use_statements.currency IS 'Explicit ISO currency from the source; no default or exchange conversion.';
COMMENT ON COLUMN public.financial_use_statements.bank_line_id IS 'Immutable bank witness snapshot; required for customer cash phases.';
COMMENT ON COLUMN public.financial_use_statements.bank_document_id IS 'Original containing the bank witness.';
COMMENT ON COLUMN public.financial_use_statements.bank_source_key IS 'Stable bank movement identity for currentness and conservation.';
COMMENT ON COLUMN public.financial_vehicle_uses.source_extraction_id IS 'Parent immutable allocation statement.';
COMMENT ON COLUMN public.financial_vehicle_uses.allocation_index IS 'Position within the complete vector; not an item or purchase identity.';
COMMENT ON COLUMN public.financial_vehicle_uses.vehicle_id IS 'Explicit vehicle use subject; no beneficial ownership inference.';
COMMENT ON COLUMN public.financial_vehicle_uses.work_order_id IS 'Optional evidenced work phase on the same vehicle.';
COMMENT ON COLUMN public.financial_vehicle_uses.allocated_amount IS 'Exact signed book expense or positive cash-phase allocation; null is unsplit.';
COMMENT ON COLUMN public.financial_vehicle_uses.invoice_document_id IS 'Optional invoice original in this book.';
COMMENT ON COLUMN public.financial_vehicle_uses.invoice_reference IS 'Retained invoice reference when the original is not yet registered.';
COMMENT ON COLUMN public.financial_vehicle_uses.receipt_id IS 'Optional currently filed vehicle receipt; not a second expense.';
COMMENT ON COLUMN public.financial_vehicle_uses.receipt_item_id IS 'Optional source receipt line, not stock or installation confirmation.';
COMMENT ON COLUMN public.financial_vehicle_uses.work_session_id IS 'Optional evidenced work session on this vehicle.';
COMMENT ON COLUMN public.financial_vehicle_uses.basis IS 'Attributed explanation of this use allocation.';
COMMENT ON COLUMN public.financial_use_witnesses.source_extraction_id IS 'Parent immutable source statement.';
COMMENT ON COLUMN public.financial_use_witnesses.allocation_index IS 'Allocation supported by this nonmonetary citation.';
COMMENT ON COLUMN public.financial_use_witnesses.witness_index IS 'Source citation order.';
COMMENT ON COLUMN public.financial_use_witnesses.document_id IS 'Optional private original in the same book.';
COMMENT ON COLUMN public.financial_use_witnesses.receipt_id IS 'Optional receipt source in the same book; filing scope is not changed.';
COMMENT ON COLUMN public.financial_use_witnesses.observation_id IS 'Optional cited current work observation on this vehicle.';
COMMENT ON COLUMN public.financial_use_witnesses.image_id IS 'Optional cited current nonsensitive vehicle photo; not an installation decision.';
COMMENT ON COLUMN public.financial_use_witnesses.label IS 'Retained description of what this source supports.';

NOTIFY pgrst,'reload schema';

COMMIT;
