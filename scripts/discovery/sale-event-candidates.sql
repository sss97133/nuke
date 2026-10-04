-- Local/read-only candidate population contract. This is a parameterized SELECT,
-- not a DB function, migration, public reader, or qualified price distribution.
-- $1 uuid[]: explicit parent population/page; no implicit year or event-age filter.
-- $2 timestamptz: optional comparison event cutoff (annotates, never drops rows).
-- $3 timestamptz: optional knowledge cutoff (header annotations, not knownAt proof).
-- $4 integer: maximum rows PER native source, 1..100000; cap+1 refuses sampling.
-- $5 integer: maximum protected capture headers, 1..100000; independent sentinel.
-- A caller must walk its declared population and reconcile episode identity across
-- pages before claiming a complete distribution. Do not publish candidate amounts:
-- parent visibility does not establish source publication/consent or price units.
WITH request AS MATERIALIZED (
  SELECT $1::uuid[] AS parent_ids,$2::timestamptz AS event_before,
    $3::timestamptz AS evidence_as_of,$4::integer AS native_limit,$5::integer AS capture_limit,
    cardinality($1::uuid[]) BETWEEN 1 AND 10000
      AND $4::integer BETWEEN 1 AND 100000 AND $5::integer BETWEEN 1 AND 100000
      AND ($2::timestamptz IS NULL OR isfinite($2::timestamptz))
      AND ($3::timestamptz IS NULL OR isfinite($3::timestamptz)) AS valid
), parents AS MATERIALIZED (
  SELECT v.id FROM public.vehicles v CROSS JOIN request r
  WHERE r.valid AND v.id=ANY(r.parent_ids) AND v.is_public IS TRUE
    AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
), native_events AS MATERIALIZED (
  SELECT 'vehicle_events'::text AS source_table,e.id,e.vehicle_id,
    nullif(lower(btrim(e.source_platform)),'') AS platform,e.source_url AS source_url,
    nullif(btrim(e.source_listing_id),'') AS listing_id,e.event_status AS recorded_outcome,
    e.final_price::numeric AS amount,coalesce(e.sold_at,e.ended_at) AS event_at,
    NULL::date AS typed_day,
    CASE WHEN e.sold_at IS NOT NULL THEN 'vehicle_events.sold_at'
      WHEN e.ended_at IS NOT NULL THEN 'vehicle_events.ended_at_recorded_outcome_day' END AS event_basis,
    e.created_at,e.updated_at,e.extracted_at AS source_read_at,
    'vehicle_events.extracted_at'::text AS read_clock_basis
  FROM parents p JOIN public.vehicle_events e ON e.vehicle_id=p.id
  ORDER BY e.id LIMIT (SELECT CASE WHEN valid THEN native_limit+1 ELSE 0 END FROM request)
), native_listings AS MATERIALIZED (
  SELECT 'bat_listings'::text AS source_table,l.id,l.vehicle_id,'bat'::text AS platform,
    l.bat_listing_url AS source_url,nullif(btrim(l.bat_lot_number),'') AS listing_id,
    l.listing_status AS recorded_outcome,l.sale_price::numeric AS amount,
    NULL::timestamptz AS event_at,coalesce(l.sale_date,l.auction_end_date) AS typed_day,
    CASE WHEN l.sale_date IS NOT NULL THEN 'bat_listings.sale_date'
      WHEN l.auction_end_date IS NOT NULL THEN 'bat_listings.auction_end_date_recorded_outcome_day' END AS event_basis,
    l.created_at,l.updated_at,l.scraped_at AS source_read_at,
    'bat_listings.scraped_at'::text AS read_clock_basis
  FROM parents p JOIN public.bat_listings l ON l.vehicle_id=p.id
  ORDER BY l.id LIMIT (SELECT CASE WHEN valid THEN native_limit+1 ELSE 0 END FROM request)
), boundary AS MATERIALIZED (
  SELECT r.*,
    coalesce(r.valid,false) AND (SELECT count(*) FROM native_events)<=r.native_limit
      AND (SELECT count(*) FROM native_listings)<=r.native_limit AS native_complete
  FROM request r
), native AS MATERIALIZED (
  SELECT * FROM native_events UNION ALL SELECT * FROM native_listings
), normalized AS MATERIALIZED (
  SELECT n.*,
    -- Only the established BaT listing aliases share a normalized key. Other
    -- sources retain exact URL path/query/case: these may identify distinct lots.
    CASE WHEN n.platform='bat' AND btrim(n.source_url) ~* '^https?://(www\.)?bringatrailer\.com/listing/[a-z0-9-]+/?([?#].*)?$'
      THEN lower(regexp_replace(regexp_replace(regexp_replace(btrim(n.source_url),
        '^https?://(www\.)?','','i'),'[?#].*$',''),'/+$',''))
      WHEN btrim(n.source_url) ~* '^https?://[^/@[:space:]]+/[^[:space:]]+'
        THEN btrim(n.source_url) END AS url_key,
    CASE WHEN n.source_table='vehicle_events' AND n.platform='bat'
      AND n.listing_id ~* '^(https?://)?(www\.)?bringatrailer\.com/listing/[a-z0-9-]+/?([?#].*)?$'
      THEN lower(regexp_replace(regexp_replace(regexp_replace(n.listing_id,
        '^(https?://)?(www\.)?','','i'),'[?#].*$',''),'/+$',''))
      WHEN n.source_table='vehicle_events' AND n.listing_id ~* '^https?://[^/@[:space:]]+/[^[:space:]]+'
        THEN n.listing_id END AS listing_url_key,
    CASE lower(btrim(n.recorded_outcome)) WHEN 'sold' THEN 'sold'
      WHEN 'no_sale' THEN 'not_sold' WHEN 'unsold' THEN 'not_sold'
      WHEN 'reserve_not_met' THEN 'not_sold' WHEN 'cancelled' THEN 'not_sold'
      WHEN 'withdrawn' THEN 'not_sold' ELSE 'unknown' END AS outcome,
    CASE WHEN n.typed_day IS NOT NULL THEN to_char(n.typed_day,'YYYY-MM-DD')
      WHEN n.event_at IS NOT NULL AND isfinite(n.event_at)
        THEN to_char(n.event_at AT TIME ZONE 'UTC','YYYY-MM-DD') END AS event_day,
    CASE WHEN n.typed_day IS NOT NULL OR n.event_at IS NOT NULL AND isfinite(n.event_at)
      AND (n.event_at AT TIME ZONE 'UTC')::time='00:00:00' THEN 'day'
      WHEN n.event_at IS NOT NULL AND isfinite(n.event_at) THEN 'instant' END AS event_grain
  FROM native n CROSS JOIN boundary b WHERE b.native_complete
), presentations AS MATERIALIZED (
  SELECT n.*,
    CASE WHEN n.platform IS NOT NULL AND (n.url_key IS NULL OR n.listing_url_key IS NULL OR n.url_key=n.listing_url_key)
      THEN coalesce(n.url_key,n.listing_url_key,CASE WHEN n.listing_id IS NOT NULL THEN 'listing_id:'||n.listing_id END) END AS episode_key,
    n.url_key IS NOT NULL AND n.listing_url_key IS NOT NULL AND n.url_key<>n.listing_url_key AS identity_conflict,
    CASE WHEN n.event_grain='day' THEN n.event_day
      WHEN n.event_grain='instant' THEN to_char(n.event_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END AS formatted_event
  FROM normalized n
), episodes AS MATERIALIZED (
  SELECT p.vehicle_id,p.platform,p.episode_key,coalesce(p.url_key,p.listing_url_key) AS url_key,
    array_agg(DISTINCT p.source_url) FILTER(WHERE p.source_url IS NOT NULL) AS recorded_urls
  FROM presentations p WHERE p.episode_key IS NOT NULL AND coalesce(p.url_key,p.listing_url_key) IS NOT NULL
  GROUP BY p.vehicle_id,p.platform,p.episode_key,coalesce(p.url_key,p.listing_url_key)
), capture_headers AS MATERIALIZED (
  -- Exact indexed platform/URL variants only; no metadata/whole-snapshot scan,
  -- current vehicle snapshot locator, raw HTML projection, or archived metadata proof.
  SELECT DISTINCT s.id,s.platform,s.listing_url,s.fetched_at,s.created_at,
    s.http_status,s.success,s.html_sha256,s.html IS NOT NULL AS inline_body_present,
    nullif(s.html_storage_path,'') IS NOT NULL AS archived_body_recorded,
    e.vehicle_id,e.episode_key,
    s.metadata->>'vehicle_matched'='true' AND CASE
      WHEN pg_input_is_valid(s.metadata->>'vehicle_id','uuid') THEN (s.metadata->>'vehicle_id')::uuid END=e.vehicle_id AS parent_attested,
    CASE WHEN s.metadata->>'parsed_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}.*(Z|[+-][0-9]{2}(:?[0-9]{2})?)$'
      AND pg_input_is_valid(s.metadata->>'parsed_at','timestamptz') THEN (s.metadata->>'parsed_at')::timestamptz END AS parsed_at
  FROM episodes e JOIN public.listing_page_snapshots s ON s.platform=e.platform AND s.listing_url=ANY(coalesce(e.recorded_urls,'{}'::text[])||
    CASE WHEN e.platform='bat' AND e.url_key ~ '^bringatrailer\.com/listing/[a-z0-9-]+$' THEN ARRAY[
    'https://'||e.url_key,'https://'||e.url_key||'/',
    'http://'||e.url_key,'http://'||e.url_key||'/',
    'https://www.'||e.url_key,'https://www.'||e.url_key||'/',
    'http://www.'||e.url_key,'http://www.'||e.url_key||'/'
    ] ELSE ARRAY[e.url_key] END)
  ORDER BY s.id,e.vehicle_id LIMIT (SELECT CASE WHEN valid THEN capture_limit+1 ELSE 0 END FROM request)
)
SELECT jsonb_build_object(
  'contract','sale_event_candidates_v1','stage','private_candidate_assay_not_price_comps',
  'population',jsonb_build_object('basis','explicit_supplied_parent_ids_page',
    'requestedIds',coalesce(cardinality(b.parent_ids),0),'eligiblePublicParents',(SELECT count(*) FROM parents),
    'membership','current_parent_gate_not_historical_membership','fleetComplete',false),
  'coverage',jsonb_build_object('complete',b.native_complete,'validRequest',coalesce(b.valid,false),
    'maximumParentIds',10000,'nativeRowsPerSourceLimit',b.native_limit,
    'vehicleEventPresentations',(SELECT count(*) FROM native_events),
    'batListingPresentations',(SELECT count(*) FROM native_listings),
    'refusal',CASE WHEN NOT coalesce(b.valid,false) THEN 'invalid_request'
      WHEN NOT b.native_complete THEN 'native_presentation_cap_no_sample' END,
    'captureHeadersComplete',(SELECT count(*) FROM capture_headers)<=b.capture_limit,
    'captureHeaderLimit',b.capture_limit,'captureHeadersAtLeast',(SELECT count(*) FROM capture_headers)),
  'candidates',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'capture',jsonb_build_object('table',p.source_table,'id',p.id),
    'vehicleId',p.vehicle_id,'sourcePlatform',p.platform,'sourceEpisodeKey',p.episode_key,
    'sourceUrl',p.source_url,'sourceListingId',p.listing_id,
    'eventAt',p.formatted_event,'eventDay',p.event_day,'eventGrain',p.event_grain,'eventTimeBasis',p.event_basis,
    'recordedOutcome',p.recorded_outcome,'outcome',p.outcome,
    'amount',CASE WHEN p.amount::text IN ('NaN','Infinity','-Infinity') THEN NULL ELSE p.amount END,
    'currency',NULL,'priceBasis',NULL,'unitSource',NULL,'conditionEvidence','unknown',
    'knownAt',NULL,'knownAtEvidence',NULL,
    'qualification',jsonb_build_object('status','candidate','basis','native_recorded_claim_units_source_clock_unverified',
      'evidenceRefs',jsonb_build_array(jsonb_build_object('table',p.source_table,'id',p.id))),
    'publicSourceStatus','unestablished','relevance','[]'::jsonb,
    'nativeRow',jsonb_build_object('recordedAmount',p.amount::text,'createdAt',p.created_at,'updatedAt',p.updated_at,
      'sourceReadAt',p.source_read_at,'readClockBasis',p.read_clock_basis,
      'clockMeaning','mutable_row_headers_not_immutable_claim_knownAt'),
    'flags',jsonb_build_object('identityConflict',p.identity_conflict,
      'unresolvedEpisode',p.episode_key IS NULL,'pricePositiveFinite',p.amount>0 AND p.amount::text NOT IN ('NaN','Infinity','-Infinity'),
      'eventBeforeCutoff',CASE WHEN b.event_before IS NULL THEN NULL
        WHEN p.event_grain='day' AND p.event_day::date<>(b.event_before AT TIME ZONE 'UTC')::date
          THEN p.event_day::date<(b.event_before AT TIME ZONE 'UTC')::date
        WHEN p.event_grain='instant' THEN p.event_at<b.event_before END)
  ) ORDER BY p.source_table,p.id) FROM presentations p),'[]'::jsonb),
  'sourceCaptureHeaders',CASE WHEN (SELECT count(*) FROM capture_headers)>b.capture_limit THEN '[]'::jsonb ELSE
    coalesce((SELECT jsonb_agg(jsonb_build_object('capture',jsonb_build_object('table','listing_page_snapshots','id',h.id),
      'vehicleId',h.vehicle_id,'sourcePlatform',h.platform,'sourceEpisodeKey',h.episode_key,'sourceUrl',h.listing_url,
      'fetchedAt',h.fetched_at,'sourceIngestedAt',h.created_at,'parsedAt',h.parsed_at,
      'success',h.success,'httpStatus',h.http_status,'storedSha256',h.html_sha256,
      'parentAttested',h.parent_attested,'inlineBodyPresent',h.inline_body_present,'archivedBodyRecorded',h.archived_body_recorded,
      'qualification',jsonb_build_object('status','candidate','basis','protected_header_only_raw_hash_parser_not_verified'),
      'sourceHeadersWithinKnowledgeCutoff',CASE WHEN b.evidence_as_of IS NULL THEN NULL
        ELSE h.fetched_at<=b.evidence_as_of AND h.created_at<=b.evidence_as_of AND h.parsed_at<=b.evidence_as_of END
    ) ORDER BY h.id,h.vehicle_id) FROM capture_headers h),'[]'::jsonb) END
) AS receipt FROM boundary b;
