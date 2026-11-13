-- Synthetic disposable database only. Run the real catalog/lease/source contracts
-- first, then reproduce retry starvation and exercise the changed claim function.
\set ON_ERROR_STOP on
\ir test_receipt_catalog_enrichment.sql

ALTER FUNCTION public.claim_derivation_work(text,integer,uuid) SECURITY DEFINER;
ALTER FUNCTION public.claim_derivation_work(text,integer,uuid) SET search_path=public;
REVOKE ALL ON FUNCTION public.claim_derivation_work(text,integer,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_derivation_work(text,integer,uuid) TO service_role;
CREATE TEMP TABLE claim_before AS
 SELECT pg_get_functiondef(oid) AS definition,proacl,proowner,prosecdef,proconfig
 FROM pg_proc WHERE oid='public.claim_derivation_work(text,integer,uuid)'::regprocedure;

CREATE FUNCTION pg_temp.job_id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid
$$;
CREATE FUNCTION pg_temp.receipt_job(n integer,p integer,due interval,created interval,
 owner_id integer DEFAULT 101) RETURNS void LANGUAGE sql AS $$
 INSERT INTO public.derivation_queue(id,user_id,evidence_type,evidence_id,extractor_slug,
 status,priority,next_attempt_at,created_at)
 VALUES(pg_temp.job_id(n),pg_temp.job_id(owner_id),'receipt',pg_temp.job_id(n),
 'receipt-products-v1','pending',p,now()+due,now()+created)
$$;

-- Original behavior: both jobs are due, but the recently retried older receipt
-- wins over the receipt that has waited longer. No private receipt data is used.
TRUNCATE derivation_queue;
SELECT pg_temp.receipt_job(1,30,'-1 minute','-2 days');
SELECT pg_temp.receipt_job(2,30,'-40 minutes','-1 day');
DO $$ BEGIN
 ASSERT (SELECT id=pg_temp.job_id(1) FROM claim_derivation_work('before',5,NULL)),
   'fixture must reproduce creation-time retry starvation before the migration';
END $$;
TRUNCATE derivation_queue;

\ir ../migrations/20261113152100_receipt_catalog_due_order.sql

DO $$ BEGIN
 ASSERT (SELECT pg_get_functiondef(p.oid)=replace(b.definition,
   'ORDER BY rp.priority,rp.created_at,rp.id LIMIT 1',
   'ORDER BY rp.priority,rp.next_attempt_at,rp.created_at,rp.id LIMIT 1')
   AND p.proacl IS NOT DISTINCT FROM b.proacl AND p.proowner=b.proowner
   AND p.prosecdef=b.prosecdef AND p.proconfig IS NOT DISTINCT FROM b.proconfig
   FROM pg_proc p CROSS JOIN claim_before b
   WHERE p.oid='public.claim_derivation_work(text,integer,uuid)'::regprocedure),
   'only the receipt-specific sort changes; return contract, ACL, locks and recovery remain';
END $$;

-- Same timestamps after the repair: due age wins within priority, even if an
-- older media retry is due again. Finishing advances the retry clock and makes
-- the next waiting receipt eligible without changing the worker's request cap.
SELECT pg_temp.receipt_job(1,30,'-1 minute','-2 days');
SELECT pg_temp.receipt_job(2,30,'-40 minutes','-1 day');
SELECT pg_temp.receipt_job(3,30,'-30 minutes','-1 day');
DO $$ DECLARE result uuid; BEGIN
 SELECT id INTO STRICT result FROM claim_derivation_work('after',5,NULL);
 ASSERT result=pg_temp.job_id(2),'long-waiting receipt wins over older media retry';
 ASSERT finish_receipt_products(result,'after',0,'{"items":{"synthetic":{"status":"stock_image_unavailable"}}}',false,60)='pending';
 ASSERT (SELECT next_attempt_at>=now()+interval '60 seconds' AND attempts=0 FROM derivation_queue WHERE id=result),
   'retry clock and attempt reset are preserved';
 SELECT id INTO STRICT result FROM claim_derivation_work('after',5,NULL);
 ASSERT result=pg_temp.job_id(3),'second waiting receipt progresses after first receipt retries';
 ASSERT (SELECT count(*)=1 FROM derivation_queue WHERE status='claimed'),
   'each call still claims at most one receipt';
 RAISE NOTICE 'receipt fairness: old behavior reproduced, due order and retry progress pass';
END $$;

-- Explicit priorities still dominate due age. Future, exhausted, wrong-user,
-- separately routed and already-claimed work remains ineligible.
TRUNCATE derivation_queue;
SELECT pg_temp.receipt_job(10,30,'-2 hours','-2 days');
SELECT pg_temp.receipt_job(11,20,'-1 minute','-1 day');
SELECT pg_temp.receipt_job(12,1,'1 hour','-3 days');
SELECT pg_temp.receipt_job(13,1,'-3 hours','-3 days');
SELECT pg_temp.receipt_job(14,1,'-3 hours','-3 days',102);
SELECT pg_temp.receipt_job(15,1,'-3 hours','-3 days');
UPDATE derivation_queue SET attempts=max_attempts WHERE id=pg_temp.job_id(13);
UPDATE derivation_queue SET status='claimed',locked_by='active',locked_at=now()
 WHERE id=pg_temp.job_id(15);
INSERT INTO derivation_queue(id,user_id,evidence_type,evidence_id,extractor_slug,status,
 priority,next_attempt_at,created_at)
 VALUES(pg_temp.job_id(16),pg_temp.job_id(101),'listing_page_snapshot',pg_temp.job_id(16),
 'separate-listing-reader','pending',1,now()-interval '3 hours',now()-interval '3 days');
DO $$ DECLARE result uuid; BEGIN
 SELECT id INTO STRICT result FROM claim_derivation_work('priority',5,pg_temp.job_id(101));
 ASSERT result=pg_temp.job_id(11),'priority dominates due age after eligibility filters';
 ASSERT (SELECT attempts=1 AND locked_by='priority' AND locked_at=now()
   FROM derivation_queue WHERE id=result),'claim increments attempts and owns lease';
 ASSERT (SELECT count(*)=4 FROM derivation_queue WHERE id IN
   (pg_temp.job_id(12),pg_temp.job_id(13),pg_temp.job_id(14),pg_temp.job_id(16)) AND status='pending');
 ASSERT (SELECT locked_by='active' FROM derivation_queue WHERE id=pg_temp.job_id(15));
 SELECT id INTO STRICT result FROM claim_derivation_work('global',1,NULL);
 ASSERT result=pg_temp.job_id(14),'unscoped caller retains existing cross-user eligibility';
 RAISE NOTICE 'receipt fairness: priority, due cutoff, attempt cap, routing and user scope pass';
END $$;

-- Equal priority/due time falls back to creation time, then stable ID.
TRUNCATE derivation_queue;
BEGIN;
SELECT pg_temp.receipt_job(20,30,'-1 hour','-1 day');
SELECT pg_temp.receipt_job(22,30,'-1 hour','-2 days');
SELECT pg_temp.receipt_job(21,30,'-1 hour','-2 days');
DO $$ DECLARE result uuid; BEGIN
 SELECT id INTO STRICT result FROM claim_derivation_work('ties',5,NULL);
 ASSERT result=pg_temp.job_id(21),'creation time then ID break equal due/priority ties';
 SELECT id INTO STRICT result FROM claim_derivation_work('ties',5,NULL);
 ASSERT result=pg_temp.job_id(22),'remaining equal-time job progresses';
END $$;
COMMIT;

-- General work keeps its existing priority/creation ordering and batch size.
TRUNCATE derivation_queue;
SELECT pg_temp.receipt_job(30,30,'-1 hour','-2 days');
SELECT pg_temp.receipt_job(31,30,'-30 minutes','-1 day');
INSERT INTO derivation_queue(id,user_id,evidence_type,evidence_id,extractor_slug,status,
 priority,next_attempt_at,created_at)
 VALUES(pg_temp.job_id(32),pg_temp.job_id(101),'artifact',pg_temp.job_id(32),
 'existing-reader','pending',10,now()-interval '1 minute',now()-interval '1 day'),
 (pg_temp.job_id(33),pg_temp.job_id(101),'artifact',pg_temp.job_id(33),
 'existing-reader','pending',10,now()-interval '2 hours',now()-interval '1 hour');
DO $$ DECLARE result uuid; BEGIN
 ASSERT (SELECT count(*)=0 FROM claim_derivation_work('zero',0,NULL));
 SELECT id INTO STRICT result FROM claim_derivation_work('general',1,NULL);
 ASSERT result=pg_temp.job_id(32),'non-receipt creation ordering is unchanged';
 ASSERT (SELECT count(*)=2 FROM claim_derivation_work('mixed',5,NULL)),
   'mixed batch contains one receipt and remaining general work';
 ASSERT (SELECT status='pending' FROM derivation_queue WHERE id=pg_temp.job_id(31)),
   'second receipt stays pending despite spare batch slots';
END $$;

-- Expired receipt leases recover exactly as before: not selectable in the same
-- statement snapshot; a following call can claim them. Active and other-reader
-- leases are not reset by receipt recovery.
TRUNCATE derivation_queue;
SELECT pg_temp.receipt_job(40,30,'-2 hours','-2 days');
SELECT pg_temp.receipt_job(41,30,'-2 hours','-2 days');
SELECT pg_temp.receipt_job(42,30,'-2 hours','-2 days');
UPDATE derivation_queue SET status='claimed',locked_by='expired',
 locked_at=now()-interval '20 minutes',attempts=3;
UPDATE derivation_queue SET locked_at=now(),locked_by='live' WHERE id=pg_temp.job_id(41);
UPDATE derivation_queue SET extractor_slug='existing-reader' WHERE id=pg_temp.job_id(42);
DO $$ BEGIN
 ASSERT (SELECT count(*)=0 FROM claim_derivation_work('recover',5,NULL)),
   'recovered writes are not visible to the same statement pick';
 ASSERT (SELECT status='pending' AND attempts=0 AND locked_by IS NULL AND locked_at IS NULL
   AND next_attempt_at=now() FROM derivation_queue WHERE id=pg_temp.job_id(40));
 ASSERT (SELECT id=pg_temp.job_id(40) FROM claim_derivation_work('reclaim',5,NULL));
 ASSERT (SELECT status='claimed' AND locked_by='live' AND attempts=3
   FROM derivation_queue WHERE id=pg_temp.job_id(41));
 ASSERT (SELECT status='claimed' AND locked_by='expired' AND attempts=3
   FROM derivation_queue WHERE id=pg_temp.job_id(42));
 RAISE NOTICE 'receipt fairness: batch cap, general queue and receipt-only lease recovery pass';
END $$;

-- Two real PostgreSQL backends: a concurrent claim owns the receipt row lock.
-- The second caller must skip that head without duplicating it or spending a
-- second receipt slot. General work can still progress under SKIP LOCKED.
TRUNCATE derivation_queue;
SELECT pg_temp.receipt_job(50,30,'-2 hours','-2 days');
SELECT pg_temp.receipt_job(51,30,'-1 hour','-1 day');
CREATE EXTENSION dblink;
SELECT dblink_connect('receipt_holder',format('host=%s port=%s dbname=%s user=%s',
 split_part(current_setting('unix_socket_directories'),',',1),current_setting('port'),current_database(),current_user));
SELECT dblink_exec('receipt_holder','BEGIN');
SELECT * FROM dblink('receipt_holder',
 $$SELECT id FROM public.claim_derivation_work('concurrent-a',1,NULL)$$) AS claimed(id uuid);
INSERT INTO derivation_queue(id,user_id,evidence_type,evidence_id,extractor_slug,status,
 priority,next_attempt_at,created_at)
 VALUES(pg_temp.job_id(52),pg_temp.job_id(101),'artifact',pg_temp.job_id(52),
 'existing-reader','pending',30,now()-interval '1 hour',now());
SET statement_timeout='2s';
DO $$ DECLARE result uuid; BEGIN
 SELECT id INTO STRICT result FROM claim_derivation_work('concurrent-b',5,NULL);
 ASSERT result=pg_temp.job_id(52),'locked receipt is skipped while general work proceeds';
 ASSERT (SELECT status='pending' FROM derivation_queue WHERE id=pg_temp.job_id(51)),
   'locked receipt head does not bypass the one-receipt selection cap';
END $$;
RESET statement_timeout;
SELECT dblink_exec('receipt_holder','COMMIT');
SELECT dblink_disconnect('receipt_holder');
DO $$ BEGIN
 ASSERT (SELECT status='claimed' AND locked_by='concurrent-a' AND attempts=1
   FROM derivation_queue WHERE id=pg_temp.job_id(50)),'first claim remains singly owned';
 ASSERT (SELECT id=pg_temp.job_id(51) FROM claim_derivation_work('next',5,NULL)),
   'next receipt progresses after the concurrent claim commits';
 RAISE NOTICE 'receipt fairness: concurrent claim, SKIP LOCKED, no duplicate lease and next-call progress pass';
END $$;
