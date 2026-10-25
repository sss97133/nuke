-- Revenue evidence gate for the financial_evidence_v1 books.
--
-- Three judgments that reviewers made by hand become deterministic SQL:
--   A. financial_counterpart_matches: for each credit, opposite-sign movements in the owner's other accounts
--      (same amount, wire/PayPal fee allowed, within 5 days), a cash receipt it may be part of, and a related
--      payer. Classes: own_transfer, possible_split_of_booked_receipt, related_party, unmatched.
--   B. Related parties: financial_operator_entities gains relationship = 'related_party' (the existing per-owner
--      counterparty registry with name patterns; operator-owned rows keep their meaning). Owner-only writer
--      set_financial_related_party; readers see only entity names and patterns.
--   C. financial_revenue_evidence_gate: readiness test 7. A Revenue record must carry an invoice, deal, payer memo
--      naming the payer, message key or owner attestation, and an invoice addressed to someone other than the
--      payer is flagged. Each failure carries a ready desk question whose default is "not revenue".
--      ingest_financial_evidence reports the same check in its receipt and files that desk question for new or
--      changed failing Revenue records. It never blocks a write: a gate error is reported, not raised.
-- Every reader runs as the caller (owner or accounting delegate) and is bounded by date range and row limit.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

DO $guard$ BEGIN
  IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.ingest_financial_evidence(uuid,jsonb,jsonb,jsonb)'::regprocedure))
     NOT IN ('b462452fecb63d9acf6b0262fe4017d1', '47f0c6d230289358e9e5195b3920f4cd') THEN -- gitleaks:allow (function body checksums, not credentials)
    RAISE EXCEPTION 'ingest_financial_evidence differs from the reviewed preimage';
  END IF;
END $guard$;

-- B. Related-party registry: extend the existing counterparty registry.
ALTER TABLE public.financial_operator_entities
  ADD COLUMN IF NOT EXISTS relationship text NOT NULL DEFAULT 'operator_owned',
  ADD COLUMN IF NOT EXISTS relation_basis text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.financial_operator_entities'::regclass
                 AND conname = 'financial_operator_entities_relationship_check') THEN
    ALTER TABLE public.financial_operator_entities ADD CONSTRAINT financial_operator_entities_relationship_check
      CHECK (relationship IN ('operator_owned', 'related_party')
             AND (relation_basis IS NULL OR length(relation_basis) BETWEEN 1 AND 500));
  END IF;
END $$;
COMMENT ON TABLE public.financial_operator_entities IS
  'Per-owner counterparty registry with name patterns. relationship = operator_owned: organizations the operator owns, '
  'for direction classification (outbound/inbound/internal). relationship = related_party: people and companies related '
  'to the book owner, whose payments are not customer revenue without evidence (financial_revenue_evidence_gate). '
  'Second operator or related party = rows, not code. Related-party rows are written by set_financial_related_party.';
COMMENT ON COLUMN public.financial_operator_entities.relationship IS
  'operator_owned (default; the original meaning of every row) or related_party. Unit: code. Source: the writer.';
COMMENT ON COLUMN public.financial_operator_entities.relation_basis IS
  'Why the party is related, with who said so and when (at most 500 characters). Null on operator-owned rows.';

CREATE OR REPLACE FUNCTION public.set_financial_related_party(
  p_entity_name text, p_name_patterns text[], p_relation_basis text, p_owner_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_owner uuid := coalesce(p_owner_id, auth.uid());
  v_patterns text[];
  v_row public.financial_operator_entities%ROWTYPE;
BEGIN
  IF v_owner IS NULL OR NOT (v_owner = auth.uid() OR coalesce(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'only the book owner registers related parties' USING ERRCODE = '42501';
  END IF;
  SELECT array_agg(DISTINCT p ORDER BY p) INTO v_patterns
  FROM (SELECT upper(btrim(regexp_replace(x, '\s+', ' ', 'g'))) p FROM unnest(p_name_patterns) x) s
  WHERE p <> '';
  IF coalesce(length(btrim(p_entity_name)), 0) NOT BETWEEN 2 AND 120
    OR coalesce(array_length(v_patterns, 1), 0) NOT BETWEEN 1 AND 20
    OR EXISTS (SELECT 1 FROM unnest(v_patterns) p WHERE length(p) NOT BETWEEN 2 AND 80)
    OR coalesce(length(btrim(p_relation_basis)), 0) NOT BETWEEN 1 AND 500
  THEN RAISE EXCEPTION 'invalid related party'; END IF;
  INSERT INTO public.financial_operator_entities AS e (owner_id, entity_name, name_patterns, relationship, relation_basis)
  VALUES (v_owner, btrim(p_entity_name), v_patterns, 'related_party', btrim(p_relation_basis))
  ON CONFLICT (owner_id, entity_name) DO UPDATE
    SET name_patterns = (SELECT array_agg(DISTINCT p ORDER BY p) FROM unnest(e.name_patterns || excluded.name_patterns) p),
        relation_basis = excluded.relation_basis
    WHERE e.relationship = 'related_party'
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'entity is registered as operator-owned'; END IF;
  RETURN jsonb_build_object('id', v_row.id, 'entity_name', v_row.entity_name, 'name_patterns', to_jsonb(v_row.name_patterns),
                            'relationship', v_row.relationship);
END $$;

-- Readers see names and patterns only (never tax ids), for books they may read.
CREATE OR REPLACE FUNCTION public.financial_related_parties(p_owner_id uuid)
RETURNS TABLE(entity_id uuid, entity_name text, name_patterns text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e.id, e.entity_name, e.name_patterns
  FROM public.financial_operator_entities e
  WHERE e.owner_id = p_owner_id AND e.relationship = 'related_party'
    AND (p_owner_id = auth.uid() OR coalesce(auth.role(), '') = 'service_role'
         OR p_owner_id IN (SELECT public.accounting_readable_owners()))
  ORDER BY e.entity_name
$$;

-- Pure text readers used by the matcher and the gate.
CREATE OR REPLACE FUNCTION public.financial_try_date(p text)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
BEGIN
  IF p !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN NULL; END IF;
  RETURN p::date;
EXCEPTION WHEN others THEN RETURN NULL;
END $$;

-- The payer a bank or PayPal memo names, or null when the memo names none (wire, cash and check deposits) or names
-- only a payment processor.
CREATE OR REPLACE FUNCTION public.financial_memo_payer(p_description text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN n IS NULL OR upper(n) ~ '^(PAYPAL|TRANSFER|DEPOSIT|CASH|BANK|UNKNOWN|N/?A)$'
                   OR upper(n) ~ '\m(MONEYCORP|INTUIT|STRIPE|SQUARE|SQ \*|WISE|TRANSFERWISE|PAYONEER|REMITLY|WESTERN UNION|XOOM|SHOPIFY|ETSY|EBAY)\M'
              THEN NULL ELSE n END
  FROM (SELECT nullif(btrim(regexp_replace(coalesce(
      substring(d from '(?i)^zelle\s+(?:from\s+)?([a-z][a-z .,&''-]*[a-z.])\s+\d{3}-\d{3}-\d{4}'),
      substring(d from '(?i)^(?:[a-z ]{0,30})payment(?: received)?:\s*([^\[|]+)'),
      substring(d from '(?i)^([^|]{2,80})\|\s*[a-z ]{0,30}payment\s*(?:\||$)'),
      substring(d from '(?i)from share account:\s*\|?\s*x*[0-9][0-9.\-]*\s+(.+)$'),
      substring(d from '(?i)^(?:automatic deposit|ach (?:credit|deposit)|direct dep(?:osit)?)[ ,]+([a-z0-9][a-z0-9 .,&''-]{2,80}?)\s*(?:ccd|ppd|ctx|web)?$'),
      substring(d from '(?i)\m(?:wire|ach|transfer|deposit)\s+from\s+([a-z][a-z .,&''-]{2,80})$'),
      substring(d from '(?i)^venmo\s+(?:from\s+)?([a-z][a-z .,&''-]{2,80})$')
    ), '\s+', ' ', 'g')), '') n
    FROM (SELECT btrim(coalesce(p_description, '')) d) s) t
$$;

-- Name tokens for payer/addressee comparison: upper-case words of 3+ letters, legal forms dropped.
CREATE OR REPLACE FUNCTION public.financial_name_tokens(p text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce(array_agg(DISTINCT w), '{}')
  FROM regexp_split_to_table(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]+', ' ', 'g')), ' ') w
  WHERE length(w) >= 3 AND w NOT IN ('LLC','LTD','INC','SAS','SARL','THE','AND','CO','CORP','COMPANY','OTHERS','GROUP',
                                     'VIA','PAYPAL','CARD','ACCOUNT','BANK','PAYMENT','MOBILE','GENERAL','ASSOCIATION')
$$;

-- The book owner's own name tokens (a memo naming the owner is the owner's own money), for books the caller may read.
CREATE OR REPLACE FUNCTION public.financial_owner_name_tokens(p_owner_id uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT public.financial_name_tokens(p.full_name) FROM public.profiles p WHERE p.id = p_owner_id), '{}')
  WHERE p_owner_id = auth.uid() OR coalesce(auth.role(), '') = 'service_role'
     OR p_owner_id IN (SELECT public.accounting_readable_owners())
$$;

-- Evidence references a Revenue record carries in its own text. memo_payer is the payer the bank memo names.
-- Only the reviewer's structured "; payer X" clause of the last income allocation is read as a named payer, so prose
-- such as "verifies payer and" or "did not recognize the payer" is not mistaken for one.
CREATE OR REPLACE FUNCTION public.financial_revenue_evidence(p_record jsonb, p_memo_payer text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  WITH t AS (
    SELECT concat_ws(' | ', p_record->>'decision', p_record->>'status', p_record->>'source_reference', p_record->>'description') txt,
           coalesce((regexp_match(coalesce(p_record->>'decision', ''), '^.*income allocation(.*)$', 'i'))[1], '') alloc,
           nullif(btrim(p_memo_payer), '') memo
  ), f AS (
    SELECT txt, memo,
      coalesce(substring(txt from '(?i)\m(?:invoice|facture)\s+(?:no\.?\s*|number\s*|#\s*)?([A-Z]{0,4}[_-]?[0-9][A-Z0-9_-]{2,})'),
               substring(txt from '\m(SW_?[A-Z0-9][A-Z0-9-]{3,})'),
               substring(txt from '(?i)\m(invoice[a-z0-9_-]{0,20}\.(?:txt|pdf|csv|png|jpe?g))')) invoice_ref,
      coalesce(substring(txt from '(?i)\m(work order [0-9a-f]{8})'),
               substring(txt from '(?i)\m(quote [^;|,]{0,40}\$?[0-9][0-9,.]*)'),
               substring(txt from '(?i)\m(bill of sale|sale agreement|purchase agreement)\M'),
               substring(txt from '(?i)\m(BaT lot [0-9]{4,})'),
               substring(txt from '(?i)\m(settlement statement|primary settlement)\M'),
               substring(txt from '(?i)\m(deal [0-9a-f]{8})')) deal_ref,
      coalesce(substring(txt from '(?i)\m(gmail ?[0-9a-f]{10,})'),
               substring(txt from '(?i)\m(messages? ?#?[0-9]{3,})'),
               substring(txt from '(?i)\m(message[_ -]?(?:key|id)[:= ]+[A-Za-z0-9:._-]{6,})'),
               substring(txt from '(?i)\m(email\s+[''"][^''"]{3,120}[''"][^|;]{0,20}\m[0-9]{1,2} (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* (?:19|20)[0-9]{2})')) message_ref,
      coalesce(substring(txt from '(?i)\m(owner(?:''s)?[- ](?:attestation|attests?|confirm(?:ed|s|ation)?|email|said|says|statement|testimony|screenshot)[^|;.]{0,60})'),
               substring(txt from '(?i)\m(confirmed (?:received )?by (?:the )?owner)'),
               substring(txt from '(?i)\m(per owner[^|;.]{0,40})')) attestation_ref,
      coalesce(substring(txt from '(?i)\m((?:form )?1099-(?:nec|misc|k)\M[^|;]{0,40})'),
               substring(txt from '(?i)\m((?:original )?payer memo)\M')) payer_document_ref,
      (SELECT CASE WHEN x ~* '^(identified|unknown|unidentified|not|on|and|to|of|is|still|tbd|n/a)\M'
                     OR x ~* '\m(unknown|unidentified|not identified|to confirm|to be (named|confirmed)|missing)\M' THEN NULL ELSE x END
         FROM regexp_replace(substring(alloc from '(?i)(?:^|[;:(]\s*?)payer\s+([^;(,|—–]{3,80}?)\s*(?:\(|,|;|\s[-—–]\s|\||$)'), '\s+[-—–]\s+.*$', '') x) reviewer_payer,
      substring(txt from '(?i)\minvoice\s+?[A-Z0-9_-]{3,}\s+(?:\([^)]*\)\s+)?to\s+([A-Z][A-Za-z0-9 &''.-]{2,60}?)\s*(?:\(|,|;|\||$)') invoice_addressee
    FROM t
  ), g AS (
    SELECT f.*, btrim(coalesce(invoice_addressee, reviewer_payer)) addressee FROM f
  )
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'invoice', invoice_ref, 'deal', deal_ref, 'payer_memo', memo, 'payer_document', payer_document_ref,
    'payer_named_by_reviewer', btrim(reviewer_payer), 'message', message_ref, 'owner_attestation', btrim(attestation_ref),
    'addressee', addressee,
    -- A reference that is evidence on its own (the reviewer's payer clause is not).
    'has_document', (invoice_ref IS NOT NULL OR deal_ref IS NOT NULL OR message_ref IS NOT NULL OR attestation_ref IS NOT NULL
                     OR payer_document_ref IS NOT NULL),
    'has_reference', (invoice_ref IS NOT NULL OR deal_ref IS NOT NULL OR memo IS NOT NULL OR message_ref IS NOT NULL
                      OR attestation_ref IS NOT NULL OR payer_document_ref IS NOT NULL OR reviewer_payer IS NOT NULL),
    'addressee_differs_from_payer',
      CASE WHEN addressee IS NOT NULL AND memo IS NOT NULL
                AND cardinality(public.financial_name_tokens(addressee)) > 0 AND cardinality(public.financial_name_tokens(memo)) > 0
           THEN NOT (public.financial_name_tokens(addressee) && public.financial_name_tokens(memo)) END))
  FROM g
$$;

-- A. Counterpart matcher. One row per credit in the window: Revenue (or p_sections) records with a positive amount.
-- Ledger decisions are judged with the bank movements linked to them; a movement is judged on its own when no
-- decision is linked to it.
CREATE OR REPLACE FUNCTION public.financial_counterpart_rows(
  p_owner_id uuid, p_from date, p_to date, p_sections text[] DEFAULT ARRAY['Revenue'], p_document_id uuid DEFAULT NULL)
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH yrs AS (
    SELECT array_agg(y::text) ys FROM generate_series(extract(year FROM p_from - 5)::int, extract(year FROM p_to + 5)::int) y
  ), base AS MATERIALIZED (
    SELECT v.document_id, v.extraction_run_id, v.record_kind, v.local_id, public.financial_try_date(v.record_date) d,
           v.account, lower(btrim(coalesce(v.account, ''))) acct, v.section, v.category, v.amount_value amt, v.currency,
           v.description, v.decision, v.status, v.record
    FROM public.v_financial_accounting_records v, yrs
    WHERE v.owner_id = p_owner_id AND v.year = ANY (yrs.ys) AND v.amount_value IS NOT NULL
  ), rp AS (
    SELECT r.entity_id, r.entity_name, p pattern,
           '(^|[^A-Z0-9])' || regexp_replace(p, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '($|[^A-Z0-9])' rx
    FROM public.financial_related_parties(p_owner_id) r, unnest(r.name_patterns) p
  ), opposite AS MATERIALIZED (
    -- Only outgoing statement lines and Transfer decisions can be the other side of an own transfer.
    SELECT b.* FROM base b
    WHERE (b.record_kind = 'retained_bank_movement' AND b.amt < 0)
       OR (b.record_kind = 'retained_ledger_decision' AND b.section = 'Transfer')
  ), own AS (
    SELECT public.financial_owner_name_tokens(p_owner_id) tokens
  ), decisions AS (
    SELECT b.* FROM base b WHERE b.record_kind = 'retained_ledger_decision'
  ), links AS MATERIALIZED (
    -- One row per statement line and decision it links to (hash-joinable, unlike a jsonb containment test per pair).
    SELECT m.document_id, m.local_id, m.d, l.link
    FROM base m, jsonb_array_elements_text(CASE WHEN jsonb_typeof(m.record->'bank_links') = 'array' THEN m.record->'bank_links' ELSE '[]' END) l(link)
    WHERE m.record_kind = 'retained_bank_movement'
  ), credits AS (
    SELECT b.* FROM base b
    WHERE b.section = ANY (p_sections) AND b.amt > 0 AND b.d BETWEEN p_from AND p_to
      AND (p_document_id IS NULL OR b.document_id = p_document_id)
      AND (b.record_kind = 'retained_ledger_decision'
           OR NOT EXISTS (SELECT 1 FROM links k JOIN decisions x ON x.local_id = k.link
                          WHERE k.document_id = b.document_id AND k.local_id = b.local_id))
  ), anchors AS (
    -- The statement lines behind each credit: the credit itself when it is a movement, else the movements linked to it.
    SELECT c.document_id cdoc, c.local_id clid, b.local_id, b.document_id, b.acct, b.account, b.description, b.decision,
           b.category, b.d, b.amt, 'self' how
    FROM credits c JOIN base b ON b.document_id = c.document_id AND b.local_id = c.local_id
    WHERE c.record_kind = 'retained_bank_movement'
    UNION ALL
    SELECT c.document_id, c.local_id, m.local_id, m.document_id, m.acct, m.account, m.description, m.decision,
           m.category, m.d, m.amt, 'linked'
    FROM credits c
    JOIN links k ON k.link = c.local_id AND k.d BETWEEN c.d - 10 AND c.d + 10
    JOIN base m ON m.document_id = k.document_id AND m.local_id = k.local_id AND m.record_kind = 'retained_bank_movement'
    WHERE c.record_kind = 'retained_ledger_decision'
  ), scored AS (
    SELECT c.*,
      -- Exact below 100; above, a wire or PayPal fee: 3.99% + 0.49, at most 50.
      CASE WHEN c.amt < 100 THEN 0 ELSE least(round(c.amt * 0.0399 + 0.49, 2), 50) END fee_allow,
      coalesce((SELECT jsonb_agg(jsonb_build_object('local_id', a.local_id, 'document_id', a.document_id, 'account', a.account,
                 'date', a.d, 'amount', a.amt, 'link', a.how) ORDER BY a.d, a.local_id) FROM anchors a
                WHERE a.cdoc = c.document_id AND a.clid = c.local_id), '[]') anchor_rows,
      (SELECT array_agg(DISTINCT a.acct) FROM anchors a WHERE a.cdoc = c.document_id AND a.clid = c.local_id) anchor_accts,
      (SELECT string_agg(coalesce(a.description, ''), ' || ') FROM anchors a WHERE a.cdoc = c.document_id AND a.clid = c.local_id) anchor_text,
      (SELECT string_agg(a.local_id, ', ') FROM anchors a WHERE a.cdoc = c.document_id AND a.clid = c.local_id
        AND a.decision ~* '(prior supplied workpaper category|original (bank )?classification|original source (status|category))\s*:\s*transfer between own accounts') prior_own_transfer,
      coalesce(public.financial_memo_payer(c.description),
               (SELECT public.financial_memo_payer(a.description) FROM anchors a
                 WHERE a.cdoc = c.document_id AND a.clid = c.local_id AND public.financial_memo_payer(a.description) IS NOT NULL
                 ORDER BY a.d, a.local_id LIMIT 1)) memo_payer
    FROM credits c
  ), matched AS (
    SELECT s.*,
      coalesce((SELECT jsonb_agg(jsonb_build_object('local_id', o.local_id, 'document_id', o.document_id, 'account', o.account,
                 'date', o.d, 'amount', o.amt, 'section', o.section, 'kind', o.record_kind,
                 'fee', round(abs(o.amt) - s.amt, 2), 'days', o.d - s.d,
                 -- Strong: the opposite line is a transfer, and the credit's memo names no payer or only the owner.
                 'strength', CASE WHEN (o.section = 'Transfer' OR concat_ws(' ', o.description, o.category) ~* '\mtransfer|\mxfer\M')
                                       AND (s.memo_payer IS NULL OR (cardinality(own.tokens) > 0
                                            AND own.tokens <@ public.financial_name_tokens(s.memo_payer)))
                                  THEN 'strong' ELSE 'weak' END)
                 ORDER BY abs(o.d - s.d), abs(abs(o.amt) - s.amt), o.local_id)
         FROM opposite o, own
         WHERE o.d BETWEEN s.d - 5 AND s.d + 5
           AND o.acct <> ALL (coalesce(s.anchor_accts, ARRAY[s.acct]))
           AND o.acct <> s.acct
           AND ((o.record_kind = 'retained_bank_movement' AND o.amt < 0 AND -o.amt BETWEEN s.amt AND s.amt + s.fee_allow)
             OR (o.record_kind = 'retained_ledger_decision' AND o.section = 'Transfer'
                 AND abs(o.amt) BETWEEN s.amt AND s.amt + s.fee_allow
                 AND NOT (o.document_id = s.document_id AND o.local_id = s.local_id)))), '[]') counterparts,
      coalesce((SELECT jsonb_agg(jsonb_build_object('local_id', r.local_id, 'document_id', r.document_id, 'account', r.account,
                 'date', r.d, 'amount', r.amt, 'description', left(r.description, 160)) ORDER BY abs(r.d - s.d), r.local_id)
         FROM decisions r
         WHERE r.section = 'Revenue' AND NOT (r.document_id = s.document_id AND r.local_id = s.local_id)
           AND r.d BETWEEN s.d - 2 AND s.d + 2 AND r.amt >= s.amt
           AND concat_ws(' ', r.account, r.description) ~* '\mcash\M'
           AND s.acct !~ '\mcash\M'
           AND concat_ws(' ', s.description, s.anchor_text) ~* '\mcash\M'), '[]') booked_cash_receipts,
      coalesce((SELECT jsonb_agg(DISTINCT jsonb_build_object('entity_id', rp.entity_id, 'entity_name', rp.entity_name, 'pattern', rp.pattern))
         FROM rp WHERE upper(regexp_replace(concat_ws(' || ', s.description, s.anchor_text), '\s+', ' ', 'g')) ~ rp.rx), '[]') related
    FROM scored s
  )
  SELECT jsonb_build_object(
    'local_id', m.local_id, 'document_id', m.document_id, 'extraction_run_id', m.extraction_run_id,
    'record_kind', m.record_kind, 'date', m.d, 'year', extract(year FROM m.d)::int, 'account', m.account,
    'section', m.section, 'category', m.category, 'amount', m.amt, 'currency', m.currency,
    'description', left(m.description, 200), 'status', left(m.status, 200), 'memo_payer', m.memo_payer,
    'class', CASE
      WHEN m.prior_own_transfer IS NOT NULL OR jsonb_path_exists(m.counterparts, '$[*] ? (@.strength == "strong")') THEN 'own_transfer'
      WHEN jsonb_array_length(m.booked_cash_receipts) > 0 THEN 'possible_split_of_booked_receipt'
      WHEN jsonb_array_length(m.related) > 0 THEN 'related_party'
      ELSE 'unmatched' END,
    'transfer_basis', CASE WHEN jsonb_path_exists(m.counterparts, '$[*] ? (@.strength == "strong")') THEN 'opposite_movement'
                           WHEN m.prior_own_transfer IS NOT NULL THEN 'original_classification' END,
    'prior_own_transfer_classification', m.prior_own_transfer,
    'anchors', m.anchor_rows, 'counterparts', m.counterparts, 'booked_cash_receipts', m.booked_cash_receipts,
    'related_parties', m.related, 'record', m.record)
  FROM matched m
$$;

CREATE OR REPLACE FUNCTION public.financial_counterpart_matches(
  p_owner_id uuid, p_from date, p_to date, p_sections text[] DEFAULT ARRAY['Revenue'], p_limit integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE v_rows jsonb; v_total integer;
BEGIN
  IF p_owner_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 400
    OR coalesce(p_limit, 0) NOT BETWEEN 1 AND 1000 OR coalesce(cardinality(p_sections), 0) NOT BETWEEN 1 AND 8
  THEN RAISE EXCEPTION 'bounded window required: at most 400 days, limit 1 to 1000, 1 to 8 sections'; END IF;
  SELECT count(*), coalesce(jsonb_agg(r - 'record' ORDER BY r->>'date', r->>'local_id') FILTER (WHERE n <= p_limit), '[]')
    INTO v_total, v_rows
  FROM (SELECT r, row_number() OVER (ORDER BY r->>'date', r->>'local_id') n
        FROM public.financial_counterpart_rows(p_owner_id, p_from, p_to, p_sections) r) s;
  RETURN jsonb_build_object('reader', 'financial_counterpart_matches', 'owner_id', p_owner_id, 'from', p_from, 'to', p_to,
    'sections', to_jsonb(p_sections), 'credits', v_total, 'returned', jsonb_array_length(v_rows), 'truncated', v_total > p_limit,
    'rows', v_rows);
END $$;

-- C. One gate verdict per credit: matcher class plus the evidence references; failing rows carry a desk question.
CREATE OR REPLACE FUNCTION public.financial_revenue_gate_rows(
  p_owner_id uuid, p_from date, p_to date, p_document_id uuid DEFAULT NULL)
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH m AS MATERIALIZED (
    SELECT r, public.financial_revenue_evidence(r->'record', r->>'memo_payer') ev
    FROM public.financial_counterpart_rows(p_owner_id, p_from, p_to, ARRAY['Revenue'], p_document_id) r
  ), v AS MATERIALIZED (
    SELECT r, ev, array_remove(ARRAY[
      -- An old own-transfer label yields to a document that names the customer (invoice, deal, message, attestation).
      CASE WHEN r->>'transfer_basis' = 'opposite_movement'
             OR (r->>'transfer_basis' = 'original_classification' AND NOT (ev->>'has_document')::boolean) THEN 'own_transfer' END,
      CASE WHEN concat_ws(' ', r->>'description', r->>'category') ~* '\mcash ?back\M|\mrewards?\M|\mrebate' THEN 'card_rebate_not_customer_revenue' END,
      CASE WHEN r->>'class' = 'possible_split_of_booked_receipt' THEN 'part_of_booked_cash_receipt' END,
      CASE WHEN jsonb_array_length(r->'related_parties') > 0 AND ev->>'owner_attestation' IS NULL THEN 'related_party_without_owner_attestation' END,
      CASE WHEN NOT (ev->>'has_reference')::boolean THEN 'no_evidence_reference' END,
      CASE WHEN (ev->>'addressee_differs_from_payer')::boolean THEN 'invoice_addressee_differs_from_payer' END], NULL) reasons
    FROM m
  ), p AS (
    SELECT r, ev, reasons,
      CASE WHEN 'own_transfer' = ANY (reasons) THEN 'Transfer'
           WHEN 'part_of_booked_cash_receipt' = ANY (reasons) OR 'card_rebate_not_customer_revenue' = ANY (reasons) THEN 'Reference'
           WHEN cardinality(reasons) > 0 THEN 'Clearing' END proposed,
      CASE WHEN 'own_transfer' = ANY (reasons) THEN 'hors_perimetre'
           WHEN 'part_of_booked_cash_receipt' = ANY (reasons) THEN 'doublon_suspect'
           WHEN 'related_party_without_owner_attestation' = ANY (reasons) THEN 'hors_perimetre'
           WHEN 'card_rebate_not_customer_revenue' = ANY (reasons) THEN 'hors_perimetre'
           ELSE 'tiers_non_identifie' END concern_type
    FROM v
  )
  SELECT (r - 'record') || jsonb_build_object(
    'evidence', ev, 'reasons', to_jsonb(reasons), 'passes', cardinality(reasons) = 0,
    'pnl_effect', r->>'record_kind' = 'retained_ledger_decision',
    'proposed_section', proposed,
    'desk_question', CASE WHEN cardinality(reasons) > 0 THEN jsonb_build_object(
      'concern_type', concern_type,
      'priority', CASE WHEN (r->>'amount')::numeric >= 1000 THEN 'high' ELSE 'medium' END,
      'default', 'not revenue',
      'detail', left(format(
        'Revenue evidence gate (test 7) for %s: %s %s %s on %s is booked as Revenue, but %s. Matched evidence: %s. '
        'Default if unanswered: not revenue (%s). To keep it in Revenue, name the payer and the invoice, deal, message or '
        'your attestation for this receipt.',
        r->>'local_id', r->>'date', r->>'amount', coalesce(r->>'currency', ''), coalesce(r->>'account', 'an unnamed account'),
        replace(array_to_string(reasons, ', '), '_', ' '),
        coalesce(nullif(concat_ws('; ',
          CASE WHEN r->>'prior_own_transfer_classification' IS NOT NULL THEN 'original classification own-account transfer on ' || (r->>'prior_own_transfer_classification') END,
          (SELECT 'opposite movement ' || string_agg((c->>'local_id') || ' ' || (c->>'account') || ' ' || (c->>'date') || ' ' || (c->>'amount'), ', ')
             FROM jsonb_array_elements(r->'counterparts') c WHERE c->>'strength' = 'strong'),
          (SELECT 'booked cash receipt ' || string_agg((c->>'local_id') || ' ' || (c->>'date') || ' ' || (c->>'amount'), ', ')
             FROM jsonb_array_elements(r->'booked_cash_receipts') c),
          (SELECT 'related party ' || string_agg(DISTINCT c->>'entity_name', ', ') FROM jsonb_array_elements(r->'related_parties') c),
          CASE WHEN (ev->>'addressee_differs_from_payer')::boolean THEN 'invoice/payer named ' || (ev->>'addressee') || ', bank memo payer ' || (ev->>'payer_memo') END
        ), ''), 'none'),
        proposed), 2000)) END)
  FROM p
$$;

-- Readiness test 7: every Revenue record carries evidence, or has a desk question on its current revision.
CREATE OR REPLACE FUNCTION public.financial_revenue_evidence_gate(
  p_owner_id uuid, p_from date, p_to date, p_limit integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  IF p_owner_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 400
    OR coalesce(p_limit, 0) NOT BETWEEN 1 AND 1000
  THEN RAISE EXCEPTION 'bounded window required: at most 400 days, limit 1 to 1000'; END IF;
  WITH g AS (
    SELECT r FROM public.financial_revenue_gate_rows(p_owner_id, p_from, p_to) r
  ), f AS (
    SELECT g.r || jsonb_build_object('has_desk_question', EXISTS (
             SELECT 1 FROM public.financial_review_queue q
             WHERE q.owner_id = p_owner_id AND q.document_id = (g.r->>'document_id')::uuid AND q.status = 'pending'
               AND q.confidence_factors->>'extraction_run_id' = g.r->>'extraction_run_id'
               AND position(g.r->>'local_id' IN q.detail) > 0)) r
    FROM g WHERE NOT (g.r->>'passes')::boolean
  ), n AS (
    SELECT r, row_number() OVER (ORDER BY (r->>'pnl_effect')::boolean DESC, r->>'date', r->>'local_id') k FROM f
  )
  SELECT jsonb_build_object(
    'test', 7, 'name', 'Revenue records carry evidence', 'owner_id', p_owner_id, 'from', p_from, 'to', p_to,
    'measured_at', now(),
    'population', (SELECT count(*) FROM g),
    'population_pnl', (SELECT count(*) FROM g WHERE (g.r->>'pnl_effect')::boolean),
    'population_amount', (SELECT coalesce(sum((g.r->>'amount')::numeric) FILTER (WHERE (g.r->>'pnl_effect')::boolean), 0) FROM g),
    'failing', (SELECT count(*) FROM f),
    'failing_pnl', (SELECT count(*) FROM f WHERE (f.r->>'pnl_effect')::boolean),
    'failing_amount', (SELECT coalesce(sum((f.r->>'amount')::numeric) FILTER (WHERE (f.r->>'pnl_effect')::boolean), 0) FROM f),
    'failing_without_desk_question', (SELECT count(*) FROM f WHERE NOT (f.r->>'has_desk_question')::boolean),
    'passes', NOT EXISTS (SELECT 1 FROM f WHERE NOT (f.r->>'has_desk_question')::boolean),
    'returned', (SELECT count(*) FROM n WHERE k <= p_limit),
    'truncated', (SELECT count(*) FROM n) > p_limit,
    'rows', coalesce((SELECT jsonb_agg(n.r ORDER BY n.k) FROM n WHERE n.k <= p_limit), '[]'))
  INTO v;
  RETURN v;
END $$;

REVOKE ALL ON FUNCTION public.set_financial_related_party(text, text[], text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.financial_related_parties(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.financial_counterpart_rows(uuid, date, date, text[], uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.financial_counterpart_matches(uuid, date, date, text[], integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.financial_revenue_gate_rows(uuid, date, date, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.financial_revenue_evidence_gate(uuid, date, date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_financial_related_party(text, text[], text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financial_related_parties(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financial_counterpart_rows(uuid, date, date, text[], uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financial_counterpart_matches(uuid, date, date, text[], integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financial_revenue_gate_rows(uuid, date, date, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financial_revenue_evidence_gate(uuid, date, date, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.financial_counterpart_matches(uuid, date, date, text[], integer) IS
  'Counterpart matcher for credits (Revenue by default) in a window of at most 400 days: opposite-sign movements in the '
  'owner''s other accounts within 5 days (exact below 100, else a fee of up to min(3.99% + 0.49, 50)); strong when the '
  'opposite line is a Transfer or says transfer. Booked cash receipts within 2 days '
  'it may be part of, and registered related parties named in the memo. Class: own_transfer, '
  'possible_split_of_booked_receipt, related_party or unmatched, with the evidence ids. Runs as the caller.';
COMMENT ON FUNCTION public.financial_revenue_evidence_gate(uuid, date, date, integer) IS
  'Readiness test 7: every Revenue record carries an invoice, deal, payer memo naming the payer, message key or owner '
  'attestation; no own transfer, split of a booked cash receipt or unattested related-party receipt; no invoice addressed to '
  'someone other than the payer. Failing rows carry a proposed section and a desk question whose default is not revenue. '
  'passes = every failing row has a pending desk question on its current revision. Runs as the caller.';

-- What the writer reports for one revision. Revenue records the revision adds or changes and that fail the gate get
-- the gate's desk question on the new run (unless the revision already carries a concern naming the record, and
-- never past 30 pending concerns on the run). Unchanged records are reported only. Any error is reported, not raised,
-- so the gate can never block or roll back a write.
CREATE OR REPLACE FUNCTION public.financial_revenue_gate_report(
  p_owner_id uuid, p_document_id uuid, p_run uuid, p_prior uuid, p_revision jsonb, p_actor uuid, p_actor_context jsonb,
  p_original_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_from date; v_to date; v_revenue integer; v_changed text[]; v_row jsonb; v_failing jsonb := '[]'; v_ids jsonb := '[]';
  v_id uuid; v_pending integer; v_resolver text; v_filed boolean; v_reason text;
BEGIN
  SELECT min(public.financial_try_date(r->>'date')), max(public.financial_try_date(r->>'date')), count(*),
         array_agg(r->>'local_id') FILTER (WHERE NOT EXISTS (
           SELECT 1 FROM public.financial_document_lines l
           WHERE p_prior IS NOT NULL AND l.document_id = p_document_id AND l.owner_id = p_owner_id
             AND l.attributes->>'extraction_run_id' = p_prior::text AND l.attributes ? 'accounting_record'
             AND l.attributes->'accounting_record'->>'local_id' = r->>'local_id'
             AND (l.attributes->'accounting_record') - 'bank_links' = r - 'bank_links'))
    INTO v_from, v_to, v_revenue, v_changed
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_revision->'accounting_records') = 'array'
                                 THEN p_revision->'accounting_records' ELSE '[]' END) r
  WHERE r->>'section' = 'Revenue' AND r->>'amount' ~ '^[0-9]{1,15}(\.[0-9]{1,6})?$' AND (r->>'amount')::numeric > 0;
  IF coalesce(v_revenue, 0) = 0 OR v_from IS NULL THEN
    RETURN jsonb_build_object('checked', 0, 'failing', '[]'::jsonb);
  END IF;
  SELECT count(*) INTO v_pending FROM public.financial_review_queue q
  WHERE q.document_id = p_document_id AND q.owner_id = p_owner_id AND q.status = 'pending'
    AND q.confidence_factors->>'extraction_run_id' = p_run::text;
  SELECT coalesce(nullif(btrim(p.full_name), ''), 'book owner') INTO v_resolver FROM public.profiles p WHERE p.id = p_owner_id;
  v_resolver := left(coalesce(v_resolver, 'book owner'), 120);
  FOR v_row IN SELECT r FROM public.financial_revenue_gate_rows(p_owner_id, v_from, v_to, p_document_id) r
               WHERE NOT (r->>'passes')::boolean AND r->>'extraction_run_id' = p_run::text
               ORDER BY r->>'date', r->>'local_id' LOOP
    v_filed := false; v_reason := NULL;
    IF NOT (v_row->>'local_id' = ANY (coalesce(v_changed, '{}'))) THEN
      v_reason := 'unchanged record: reported only';
    ELSIF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_revision->'concerns', '[]')) c
                  WHERE position(v_row->>'local_id' IN coalesce(c->>'detail', '')) > 0) THEN
      v_reason := 'the revision carries a concern naming this record';
    ELSIF v_pending >= 30 THEN
      v_reason := 'run already holds 30 pending concerns';
    ELSE
      INSERT INTO public.financial_review_queue(owner_id, document_id, concern_type, priority, detail, resolver, confidence_factors)
      VALUES (p_owner_id, p_document_id, v_row->'desk_question'->>'concern_type', v_row->'desk_question'->>'priority',
              v_row->'desk_question'->>'detail', v_resolver,
              jsonb_build_object('extraction_run_id', p_run, 'method', 'revenue-evidence-gate', 'version', '1',
                'original_sha256', p_original_sha256, 'actor_user_id', p_actor, 'auth_context', p_actor_context,
                'local_id', v_row->>'local_id', 'default', 'not revenue', 'proposed_section', v_row->>'proposed_section'))
      RETURNING id INTO v_id;
      v_ids := v_ids || to_jsonb(v_id); v_pending := v_pending + 1; v_filed := true;
    END IF;
    v_failing := v_failing || jsonb_build_object('local_id', v_row->>'local_id', 'class', v_row->>'class',
      'reasons', v_row->'reasons', 'proposed_section', v_row->>'proposed_section', 'desk_question_filed', v_filed,
      'desk_question_id', CASE WHEN v_filed THEN v_id END, 'not_filed_because', v_reason);
  END LOOP;
  RETURN jsonb_build_object('checked', v_revenue, 'changed', coalesce(cardinality(v_changed), 0),
                            'failing', v_failing, 'review_ids', v_ids);
EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('checked', coalesce(v_revenue, 0), 'error', left(SQLERRM, 300), 'failing', '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.financial_revenue_gate_report(uuid, uuid, uuid, uuid, jsonb, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;

-- The writer reports the gate and files its desk question for new or changed failing Revenue records.
-- Everything else in the writer is the reviewed preimage, unchanged.
CREATE OR REPLACE FUNCTION public.ingest_financial_evidence(p_owner_id uuid, p_original jsonb, p_revision jsonb, p_actor_context jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  doc public.financial_documents%ROWTYPE;
  v_run uuid := gen_random_uuid();
  v_prior uuid;
  v_key text := p_revision->>'idempotency_key';
  v_digest text := encode(extensions.digest(p_original::text || p_revision::text,'sha256'),'hex');
  v_runs jsonb;
  v_old jsonb;
  v_cell jsonb;
  v_concern jsonb;
  v_id uuid;
  v_cells jsonb := '[]';
  v_reviews jsonb := '[]';
  v_receipt jsonb;
  v_part jsonb;
  v_actor uuid := coalesce((p_actor_context->>'actor_user_id')::uuid,p_owner_id);
  v_authority jsonb;
  v_gate jsonb;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' OR p_owner_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id=p_owner_id AND deleted_at IS NULL AND is_anonymous IS NOT TRUE AND (banned_until IS NULL OR banned_until<=now())
  ) THEN RAISE EXCEPTION 'authenticated account required' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_actor_context) IS DISTINCT FROM 'object'
    OR octet_length(p_actor_context::text)>500
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_actor_context) k WHERE k NOT IN ('kind','agent_id','actor_user_id','owner_user_id','grant_id','key_id'))
    OR (p_actor_context->>'kind' IS NOT NULL AND p_actor_context->>'kind' NOT IN ('user','api_key'))
    OR (p_actor_context->>'agent_id' IS NOT NULL AND p_actor_context->>'agent_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  THEN RAISE EXCEPTION 'invalid verified actor context'; END IF;
  IF p_actor_context ? 'actor_user_id' THEN
    v_authority := authorize_financial_access(v_actor,p_owner_id,(p_actor_context->>'key_id')::uuid,'correct');
    IF p_actor_context->>'owner_user_id' IS DISTINCT FROM p_owner_id::text
      OR p_actor_context->>'grant_id' IS DISTINCT FROM v_authority->>'grant_id'
      OR (p_actor_context->>'kind'='api_key' AND p_actor_context->>'key_id' IS NULL)
      OR (p_actor_context->>'kind'='user' AND p_actor_context->>'key_id' IS NOT NULL)
    THEN RAISE EXCEPTION 'Verified accounting authority mismatch' USING ERRCODE='42501'; END IF;
  ELSIF p_actor_context ?| array['owner_user_id','grant_id','key_id'] THEN
    RAISE EXCEPTION 'Incomplete verified accounting authority' USING ERRCODE='42501';
  END IF;
  IF p_original IS NULL OR p_revision IS NULL OR jsonb_typeof(p_original)<>'object' OR jsonb_typeof(p_revision)<>'object'
    OR octet_length(p_original::text || p_revision::text)>250000
    OR coalesce(p_original->>'sha256','') !~ '^[a-f0-9]{64}$'
    OR coalesce(p_original->>'storage_path','') NOT LIKE p_owner_id::text || '/%'
    OR position('..' in p_original->>'storage_path')>0
    OR length(p_original->>'storage_path')>600 OR length(p_original->>'source_filename')>255
    OR coalesce(p_original->>'byte_size','') !~ '^[0-9]+$'
    OR (p_original->>'byte_size')::bigint NOT BETWEEN 1 AND 10485760
    OR coalesce(length(v_key),0) NOT BETWEEN 1 AND 200
    OR coalesce(length(p_revision->>'method'),0) NOT BETWEEN 1 AND 120
    OR coalesce(length(p_revision->>'version'),0) NOT BETWEEN 1 AND 120
    OR jsonb_typeof(p_revision->'fields') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_revision->'fields') NOT BETWEEN 1 AND 100
    OR jsonb_typeof(coalesce(p_revision->'concerns','[]')) IS DISTINCT FROM 'array'
    OR jsonb_array_length(coalesce(p_revision->'concerns','[]')) > 30
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_original) k WHERE k NOT IN ('sha256','storage_path','source_filename','source_kind','byte_size'))
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_revision) k WHERE k NOT IN ('idempotency_key','method','version','fields','concerns','supersedes_run_id','lines','accounting_records'))
  THEN RAISE EXCEPTION 'invalid financial evidence envelope'; END IF;
  FOR v_part IN SELECT jsonb_path_query(p_revision, '$.**') LOOP
    IF (jsonb_typeof(v_part)='string' AND (length(v_part #>> '{}')>2000
          OR (v_part #>> '{}') ~ '[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}'))
      OR (jsonb_typeof(v_part)='object' AND EXISTS (SELECT 1 FROM jsonb_object_keys(v_part) k
        WHERE lower(k) IN ('ocr_text','raw_text','full_ocr','full_text','iban','bank_iban','full_iban')))
    THEN RAISE EXCEPTION 'full OCR and financial identifiers must remain local'; END IF;
  END LOOP;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_id::text || ':' || (p_original->>'sha256'),0));
  SELECT * INTO doc FROM financial_documents WHERE owner_id=p_owner_id AND content_sha256=p_original->>'sha256'
    AND logical_index=1 ORDER BY created_at,id LIMIT 1 FOR UPDATE;
  IF doc.id IS NOT NULL AND doc.attributes->>'intake_mode' IS DISTINCT FROM 'financial_evidence_v1' THEN
    RAISE EXCEPTION 'existing original requires explicit migration review';
  END IF;
  IF v_actor<>p_owner_id AND (doc.id IS NULL OR p_revision->>'supersedes_run_id' IS NULL
    OR doc.storage_path IS DISTINCT FROM p_original->>'storage_path') THEN
    RAISE EXCEPTION 'Delegated correction requires the existing original and current revision' USING ERRCODE='42501';
  END IF;
  IF doc.id IS NULL THEN
    INSERT INTO financial_documents(owner_id,content_sha256,storage_path,source_filename,source_kind,byte_size,
      doc_type,extraction_status,review_status,privacy_tier,attributes)
    VALUES(p_owner_id,p_original->>'sha256',p_original->>'storage_path',p_original->>'source_filename',
      coalesce(p_original->>'source_kind','upload'),(p_original->>'byte_size')::bigint,
      'unclassified','extracted','needs_review','private',jsonb_build_object('intake_mode','financial_evidence_v1','expense_posted',false,'runs','[]'::jsonb))
    RETURNING * INTO doc;
  END IF;
  v_runs := doc.attributes->'runs';
  SELECT x INTO v_old FROM jsonb_array_elements(v_runs) x WHERE x->>'key'=v_key;
  IF v_old IS NOT NULL THEN
    IF v_old->>'digest'<>v_digest THEN RAISE EXCEPTION 'idempotency key payload conflict'; END IF;
    RETURN (v_old->'receipt') || jsonb_build_object('duplicate',true);
  END IF;
  IF jsonb_array_length(v_runs)>=100 THEN RAISE EXCEPTION 'revision limit requires review'; END IF;
  IF p_revision->>'supersedes_run_id' IS NOT NULL THEN
    v_prior := (p_revision->>'supersedes_run_id')::uuid;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_runs) x WHERE x->>'run_id'=v_prior::text)
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_runs) x WHERE x->>'supersedes_run_id'=v_prior::text)
    THEN RAISE EXCEPTION 'correction must name a current revision of this original'; END IF;
  ELSIF jsonb_array_length(v_runs)>0 THEN
    RAISE EXCEPTION 'existing original requires explicit revision supersession';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_revision->'fields')) <>
     (SELECT count(DISTINCT x->>'field_key') FROM jsonb_array_elements(p_revision->'fields') x)
  THEN RAISE EXCEPTION 'duplicate field keys'; END IF;
  IF v_prior IS NOT NULL AND (
    EXISTS (SELECT field_key FROM financial_document_extractions WHERE extraction_run_id=v_prior AND document_id=doc.id
      EXCEPT SELECT x->>'field_key' FROM jsonb_array_elements(p_revision->'fields') x)
  ) THEN RAISE EXCEPTION 'correction requires the complete prior field set'; END IF;
  FOR v_cell IN SELECT x FROM jsonb_array_elements(p_revision->'fields') x LOOP
    IF jsonb_typeof(v_cell)<>'object' OR coalesce(length(v_cell->>'field_key'),0) NOT BETWEEN 1 AND 160
      OR coalesce(length(v_cell->>'value_raw'),0) NOT BETWEEN 1 AND 2000
      OR jsonb_typeof(v_cell->'evidence') IS DISTINCT FROM 'object' OR v_cell->'evidence'='{}'::jsonb
      OR octet_length(coalesce(v_cell->'value_normalized','null')::text)>4000
      OR octet_length(coalesce(v_cell->'evidence','null')::text)>4000
      OR lower(v_cell->>'field_key') IN ('ocr_text','raw_text','full_ocr','full_text','redacted_source')
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_cell) k WHERE k NOT IN ('field_key','value_raw','value_normalized','value_type','page_number','evidence'))
    THEN RAISE EXCEPTION 'only bounded attributed cells allowed'; END IF;
    INSERT INTO financial_document_extractions(owner_id,document_id,field_key,value_raw,value_normalized,value_type,
      page_number,extractor,extractor_model,extraction_run_id,privacy_tier)
    VALUES(p_owner_id,doc.id,v_cell->>'field_key',v_cell->>'value_raw',
      jsonb_build_object('value',v_cell->'value_normalized','evidence',v_cell->'evidence','method',p_revision->>'method',
        'version',p_revision->>'version','actor_user_id',v_actor,'auth_context',p_actor_context,'original_sha256',p_original->>'sha256'),
      coalesce(v_cell->>'value_type','text'),(v_cell->>'page_number')::integer,
      p_revision->>'method',p_revision->>'version',v_run,'private') RETURNING id INTO v_id;
    v_cells := v_cells || to_jsonb(v_id);
  END LOOP;
  FOR v_concern IN SELECT x FROM jsonb_array_elements(coalesce(p_revision->'concerns','[]')) x LOOP
    IF coalesce(length(v_concern->>'resolver'),0) NOT BETWEEN 1 AND 120
      OR coalesce(length(v_concern->>'detail'),0)>2000
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_concern) k WHERE k NOT IN ('concern_type','priority','detail','resolver'))
    THEN RAISE EXCEPTION 'invalid review concern'; END IF;
    INSERT INTO financial_review_queue(owner_id,document_id,concern_type,priority,detail,resolver,confidence_factors)
    VALUES(p_owner_id,doc.id,v_concern->>'concern_type',coalesce(v_concern->>'priority','medium'),
      v_concern->>'detail',v_concern->>'resolver',jsonb_build_object('extraction_run_id',v_run,'method',p_revision->>'method',
        'version',p_revision->>'version','original_sha256',p_original->>'sha256','actor_user_id',v_actor,'auth_context',p_actor_context))
    RETURNING id INTO v_id;
    v_reviews := v_reviews || to_jsonb(v_id);
  END LOOP;
  PERFORM public.project_financial_document_lines(p_owner_id,doc.id,v_run,p_revision->'lines',v_prior);
  PERFORM public.project_financial_accounting_records(p_owner_id,doc.id,v_run,p_revision->'accounting_records',v_prior);
  -- Only the existing supersession stamps change; original cells remain intact.
  IF v_prior IS NOT NULL THEN
    UPDATE financial_document_extractions old SET is_superseded=true,superseded_at=now(),superseded_by=new.id
      FROM financial_document_extractions new
      WHERE old.owner_id=p_owner_id AND old.document_id=doc.id AND old.extraction_run_id=v_prior AND NOT old.is_superseded
        AND new.document_id=doc.id AND new.extraction_run_id=v_run AND new.field_key=old.field_key;
  END IF;
  v_gate := public.financial_revenue_gate_report(p_owner_id, doc.id, v_run, v_prior, p_revision, v_actor, p_actor_context, p_original->>'sha256');
  v_reviews := v_reviews || coalesce(v_gate->'review_ids', '[]');
  v_receipt := jsonb_build_object('document_id',doc.id,'extraction_run_id',v_run,'extraction_ids',v_cells,
    'review_ids',v_reviews,'duplicate',false,'expense_posted',false) || jsonb_build_object('revenue_evidence_gate', v_gate - 'review_ids');
  UPDATE financial_documents SET attributes=attributes || jsonb_build_object('runs',v_runs || jsonb_build_array(
    jsonb_build_object('run_id',v_run,'key',v_key,'digest',v_digest,'supersedes_run_id',v_prior,'receipt',v_receipt,'actor_user_id',v_actor,'auth_context',p_actor_context))),
    review_status='needs_review' WHERE id=doc.id AND owner_id=p_owner_id;
  RETURN v_receipt;
END $function$;

COMMIT;
