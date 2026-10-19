-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations.
-- Facility reservations: request, confirm (capacity, overlap), cancel, facility offer on the job's facility requirement.
\ir test_facility_assets.sql
\ir ../migrations/20261019225000_facility_reservations.sql

SELECT (:'d1'::jsonb)->>'asset_id' AS lift \gset
SELECT (:'d3'::jsonb)->>'asset_id' AS booth \gset
CREATE FUNCTION public.rsv(p_asset uuid,p_from timestamptz,p_until timestamptz,p_terms jsonb DEFAULT NULL,p_wo uuid DEFAULT '30000000-0000-0000-0000-000000000001')
 RETURNS jsonb LANGUAGE sql AS $$ SELECT reserve_facility(p_wo,p_asset,p_from,p_until,p_terms) $$;
CREATE FUNCTION public.cnf(p jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT confirm_facility_reservation((p->>'reservation_id')::uuid,p->>'reservation_hash') $$;
GRANT EXECUTE ON FUNCTION public.rsv(uuid,timestamptz,timestamptz,jsonb,uuid),public.cnf(jsonb) TO authenticated;
SELECT jp('plan')->>'requirements_with_offers' AS offers0 \gset

SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT t_assert(t_refused_with(format('SELECT rsv(%L,''2099-02-01 09:00+00'',''2099-02-01 12:00+00'')',:'booth'),'Only the customer or an accepted provider'),'stranger cannot reserve');
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT t_assert(t_refused_with(format('SELECT rsv(%L,''2020-02-01 09:00+00'',''2020-02-01 12:00+00'')',:'booth'),'Window must be future'),'past window refused');
SELECT t_assert(t_refused_with(format('SELECT rsv(%L,''2099-02-01 09:00+00'',''2099-04-01 09:00+00'')',:'booth'),'at most 31 days'),'over-long window refused');
SELECT t_assert(t_refused_with(format('SELECT rsv(%L,''2099-02-01 09:00+00'',''2099-02-01 12:00+00'',''{"basis":"hourly","amount":40}'')',:'booth'),'Terms must be'),'amount without currency refused');
SELECT t_assert(t_refused_with('SELECT rsv(''a4000000-0000-0000-0000-000000000001'',''2099-02-01 09:00+00'',''2099-02-01 12:00+00'')','declared, in-service'),'photo-inferred equipment cannot be reserved');
SELECT rsv(:'booth','2099-02-01 09:00+00','2099-02-01 12:00+00','{"basis":"hourly","amount":40,"currency":"USD"}') AS r1 \gset
SELECT rsv(:'booth','2099-02-01 09:00+00','2099-02-01 12:00+00','{"basis":"hourly","amount":40,"currency":"USD"}') AS r1dup \gset
SELECT rsv(:'booth','2099-02-01 10:00+00','2099-02-01 11:00+00') AS r2 \gset
SELECT t_assert(t_refused_with(format('SELECT cnf(%L)',:'r1'),'Only active owners or members'),'customer cannot confirm');
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT t_assert(t_refused_with(format('SELECT cnf(%L)',:'r1'),'Only active owners or members'),'non-member cannot confirm');
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT t_assert(t_refused_with(format('SELECT confirm_facility_reservation(%L,%L)',(:'r1'::jsonb)->>'reservation_id',repeat('a',64)),'hash does not match'),'confirmation is hash-pinned');
SELECT cnf(:'r1') AS c1 \gset
SELECT as_user('10000000-0000-0000-0000-00000000000d');
SELECT t_assert(t_refused_with(format('SELECT cnf(%L)',:'r2'),'fully booked'),'overlap on a capacity-1 asset refused');
RESET ROLE;
SELECT t_assert((:'r1'::jsonb) @> '{"state":"requested","requester_role":"customer","capacity_free_now":true,"terms":{"basis":"hourly","amount":40,"currency":"USD"},"payment_authorized":false}'
 AND (:'r1'::jsonb)->>'requirement_id'=:'rfac' AND (:'r1dup'::jsonb) @> '{"duplicate":true}' AND (:'r1dup'::jsonb)->>'reservation_id'=(:'r1'::jsonb)->>'reservation_id'
 AND (:'r2'::jsonb) @> '{"state":"requested","capacity_free_now":true}','requests do not occupy capacity; linked to the job''s facility requirement; idempotent');
SELECT t_assert((:'c1'::jsonb) @> '{"state":"confirmed","signer_role":"organization_owner","slot":1,"capacity":1,"facility_offer":{"state":"offered"}}'
 AND EXISTS (SELECT 1 FROM work_order_resource_fulfillments f WHERE f.id=((:'c1'::jsonb)#>>'{facility_offer,offer_id}')::uuid AND f.requirement_id=:'rfac'
   AND f.offer_kind='organization' AND f.facility_organization_id='20000000-0000-0000-0000-000000000001'
   AND f.available_from='2099-02-01 09:00+00' AND f.available_until='2099-02-01 12:00+00'
   AND f.offer_terms @> '{"lines":[{"pricing_basis":"hourly","amount":40,"currency":"USD","unit":"hour","quantity":3}]}'),
 'owner confirmation occupies the slot and records the facility offer (window, hourly bay fee) on the facility requirement');
SELECT t_assert((jp('plan')->>'requirements_with_offers')::int=(:'offers0')::int+1,'job path plan counts the facility offer');

-- Capacity 3: three overlapping confirmations fit, the fourth does not; non-overlapping windows reuse slots.
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT rsv(:'lift','2099-03-01 08:00+00','2099-03-01 17:00+00') AS l1 \gset
SELECT rsv(:'lift','2099-03-01 09:00+00','2099-03-01 10:00+00') AS l2 \gset
SELECT rsv(:'lift','2099-03-01 09:30+00','2099-03-01 12:00+00') AS l3 \gset
SELECT rsv(:'lift','2099-03-01 09:45+00','2099-03-01 09:50+00') AS l4 \gset
SELECT rsv(:'lift','2099-03-01 13:00+00','2099-03-01 14:00+00') AS l5 \gset
SELECT as_user('10000000-0000-0000-0000-00000000000d');
SELECT (cnf(:'l1')->>'slot')||','||(cnf(:'l2')->>'slot')||','||(cnf(:'l3')->>'slot') AS slots \gset
SELECT t_assert(t_refused_with(format('SELECT cnf(%L)',:'l4'),'fully booked'),'fourth overlapping confirmation refused at capacity 3');
SELECT cnf(:'l5') AS c5 \gset
RESET ROLE;
SELECT t_assert(:'slots'='1,2,3' AND (:'c5'::jsonb)->>'slot'='2' AND (:'c5'::jsonb) @> '{"signer_role":"organization_member","facility_offer":{"state":"not_created","reason":"facility offers are organization owner Signs"}}',
 'slots assigned within capacity; a later window reuses a free slot; member confirmations record no offer');

-- Cancellation supersedes the request and frees the slot.
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT t_assert(t_refused_with(format('SELECT cancel_facility_reservation(%L)',(:'r1'::jsonb)->>'reservation_id'),'Only the requester or the facility'),'stranger cannot cancel');
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT cancel_facility_reservation(((:'r1'::jsonb)->>'reservation_id')::uuid) AS x1 \gset
SELECT as_user('10000000-0000-0000-0000-00000000000d');
SELECT cnf(:'r2') AS c2 \gset
RESET ROLE;
SELECT t_assert((:'x1'::jsonb) @> '{"state":"cancelled","signer_role":"customer","slot_released":true}' AND (:'c2'::jsonb) @> '{"state":"confirmed","slot":1}'
 AND (SELECT is_superseded FROM vehicle_observations WHERE id=((:'r1'::jsonb)->>'reservation_id')::uuid)
 AND facility_reservation_state(((:'r1'::jsonb)->>'reservation_id')::uuid)='cancelled','cancellation releases the slot; the waiting request now confirms');

-- An accepted provider may reserve.
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT (SELECT a->'args' FROM jsonb_array_elements(ofr()#>'{viewer,actions}') a WHERE a->>'action'='accept_offer'
  AND a#>>'{args,p_offer_id}' NOT IN (:'f0',:'f1') AND a#>>'{args,p_offer_id}' <> (:'c1'::jsonb)#>>'{facility_offer,offer_id}') AS rev \gset
SELECT accept_offer(((:'rev'::jsonb)->>'p_offer_id')::uuid,(:'rev'::jsonb)->>'p_offer_hash');
SELECT as_user('10000000-0000-0000-0000-00000000000f');
SELECT t_assert(rsv(:'lift','2099-03-02 08:00+00','2099-03-02 09:00+00')->>'requester_role'='accepted_provider','accepted provider reserves');
RESET ROLE;

SELECT t_assert(t_refused_with(format('UPDATE facility_reservations SET terms=NULL WHERE id=%L',(:'r2'::jsonb)->>'reservation_id'),'immutable')
 AND t_refused_with(format('DELETE FROM facility_asset_occupancy WHERE reservation_id=%L',(:'r2'::jsonb)->>'reservation_id'),'only released'),
 'reservations immutable; occupancy only released');
SET ROLE anon;
SELECT as_user(NULL);
SELECT t_assert(t_refused('SELECT * FROM facility_reservations') AND t_refused('SELECT * FROM facility_asset_occupancy'),'anon cannot read reservation tables');
RESET ROLE;
SELECT t_assert(has_function_privilege('authenticated','reserve_facility(uuid,uuid,timestamptz,timestamptz,jsonb)','EXECUTE')
 AND has_function_privilege('authenticated','confirm_facility_reservation(uuid,text)','EXECUTE')
 AND NOT has_function_privilege('anon','reserve_facility(uuid,uuid,timestamptz,timestamptz,jsonb)','EXECUTE')
 AND NOT has_function_privilege('anon','confirm_facility_reservation(uuid,text)','EXECUTE')
 AND NOT has_function_privilege('authenticated','project_facility_reservation_event(uuid)','EXECUTE'),'grants');
