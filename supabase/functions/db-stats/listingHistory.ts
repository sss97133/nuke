// Existing private db-stats reader, at source-listing grain. No new history store.
import { boundedRead, type IntakeConnection } from './intakeStatus.ts';

export function listingHistoryScope(params: URLSearchParams, now = Date.now()) {
  const readClock = (name: string) => {
    const value = params.get(name) ?? new Date(now).toISOString();
    const at = Date.parse(value);
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)
      || !Number.isFinite(at) || at > now || new Date(at).toISOString().slice(0, 19) !== value.slice(0, 19)) {
      throw new Error('invalid_history_cutoff');
    }
    return new Date(at).toISOString();
  };
  const eventBefore = readClock('history_before');
  const knownAt = readClock('history_known_at');
  const facebookId = params.get('facebook_id')?.trim() || null;
  if (facebookId !== null && !/^\d{1,30}$/.test(facebookId)) throw new Error('invalid_facebook_id');
  return { eventBefore, knownAt, eventFrom: new Date(Date.parse(eventBefore) - 86_400_000).toISOString(), facebookId };
}

// Run-time index bounds select <=100 recorded captures; result pointers then use
// listing/sighting primary keys. Never scan the unindexed sighting foreign keys.
// completed_at is an awaited capture acknowledgement, not a row commit clock.
export const LISTING_HISTORY_SQL = `WITH runs AS MATERIALIZED (
  SELECT id, started_at, completed_at, created_at, status, metadata
  FROM public.fb_sweep_jobs
  WHERE started_at >= $3::timestamptz AND started_at <= $2::timestamptz
    AND metadata->>'writer'='extract-facebook-marketplace' AND metadata->>'capture_version'='1'
  ORDER BY started_at DESC,id LIMIT 101
), selected AS MATERIALIZED (
  SELECT *, metadata->'capture' AS capture,
    CASE WHEN metadata->'capture'->>'observed_at' ~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
      AND pg_input_is_valid(metadata->'capture'->>'observed_at','timestamptz')
      THEN (metadata->'capture'->>'observed_at')::timestamptz END AS source_at
  FROM runs ORDER BY started_at DESC,id LIMIT 100
), acknowledged AS MATERIALIZED (
  SELECT * FROM selected WHERE status='completed'
    AND started_at IS NOT NULL AND completed_at IS NOT NULL AND created_at IS NOT NULL
    AND isfinite(started_at) AND isfinite(completed_at) AND isfinite(created_at)
    AND started_at <= completed_at AND created_at <= completed_at
    AND source_at IS NOT NULL AND isfinite(source_at)
    AND source_at >= $3::timestamptz AND source_at < $1::timestamptz
    AND greatest(source_at,started_at,created_at,completed_at) <= $2::timestamptz
    AND CASE WHEN pg_input_is_valid(capture->>'capture_id','uuid') THEN (capture->>'capture_id')::uuid END=id
    AND capture->>'access_state'='available'
    AND ((capture->>'actual_url' ~ '^https://(www[.])?facebook[.]com/marketplace/[^[:space:]]+$'
      AND capture->>'target_url' ~ '^https://(www[.])?facebook[.]com/marketplace/[^[:space:]]+$')
      OR (capture->>'retrieval_surface'='chrome_mv3_rendered_saved_cards'
        AND capture->>'actual_url' ~ '^https://(www[.])?facebook[.]com/saved/([?][^[:space:]]*)?$'
        AND capture->>'target_url' ~ '^https://(www[.])?facebook[.]com/saved/([?][^[:space:]]*)?$'))
    AND length(capture->>'actual_url')<=2048 AND length(capture->>'target_url')<=2048
    AND CASE WHEN jsonb_typeof(metadata->'batch')='array' THEN jsonb_array_length(metadata->'batch') BETWEEN 1 AND 50 ELSE false END
    AND CASE WHEN jsonb_typeof(metadata->'results')='array' THEN jsonb_array_length(metadata->'results') BETWEEN 1 AND 50 ELSE false END
), records AS MATERIALIZED (
  SELECT DISTINCT ON (s.id) s.id AS sighting_id,s.listing_id,l.facebook_id,l.vehicle_id AS current_vehicle_id,
    left(card.value->>'title',200) AS title, s.seen_at AS observed_at,
    j.id AS capture_id,j.started_at AS intake_started_at,j.completed_at AS capture_acknowledged_at,
    greatest(j.source_at,j.started_at,j.created_at,j.completed_at) AS known_by,
    left(j.capture->>'retrieval_surface',100) AS retrieval_surface,
    left(j.capture->>'actual_region',200) AS actual_region,
    j.capture->>'actual_url' AS actual_url,j.capture->>'target_url' AS target_url,
    j.capture->'complete'='true'::jsonb AS source_scope_complete,
    coalesce(page.detail_id=l.facebook_id,false) AS detail_observation,
    coalesce(j.capture->>'retrieval_surface'='chrome_mv3_rendered_saved_cards',false) AS saved_observation,
    CASE WHEN page.detail_id=l.facebook_id AND j.capture->>'source_listed_at' ~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
      AND pg_input_is_valid(j.capture->>'source_listed_at','timestamptz')
      THEN CASE WHEN isfinite((j.capture->>'source_listed_at')::timestamptz)
        THEN (j.capture->>'source_listed_at')::timestamptz END END AS source_reported_listed_at,
    CASE WHEN page.detail_id=l.facebook_id THEN left(j.capture->>'source_listed_label',100) END AS source_reported_age_label,
    CASE WHEN pg_input_is_valid(card.value->>'price','numeric')
      THEN CASE WHEN (card.value->>'price')::numeric::text NOT IN ('NaN','Infinity','-Infinity')
        AND (card.value->>'price')::numeric >= 0 AND (card.value->>'price')::numeric=s.price_at_sighting
        THEN s.price_at_sighting END END AS asking_amount,
    CASE WHEN card.value->>'currency' IN ('USD','EUR','GBP','CAD','AUD') THEN card.value->>'currency' END AS asking_currency
  FROM acknowledged j
  CROSS JOIN LATERAL jsonb_array_elements(j.metadata->'results') WITH ORDINALITY r(value,ordinal)
  JOIN public.fb_listing_sightings s ON s.id=CASE WHEN pg_input_is_valid(r.value->>'sighting_id','uuid') THEN (r.value->>'sighting_id')::uuid END
  JOIN public.marketplace_listings l ON l.id=CASE WHEN pg_input_is_valid(r.value->>'listing_id','uuid') THEN (r.value->>'listing_id')::uuid END
  CROSS JOIN LATERAL (
    SELECT (jsonb_agg(b.value))->0 AS value,count(*) AS matching_cards
    FROM jsonb_array_elements(j.metadata->'batch') b(value) WHERE b.value->>'facebook_id'=l.facebook_id
  ) card
  CROSS JOIN LATERAL (
    SELECT substring(j.capture->>'actual_url' FROM '^https://(?:www[.])?facebook[.]com/marketplace/item/([0-9]+)/?(?:[?].*)?$') AS detail_id
  ) page
  WHERE card.matching_cards=1 AND l.facebook_id ~ '^[0-9]+$'
    AND r.value->>'facebook_id'=l.facebook_id
    AND r.value->'listing_landed'='true'::jsonb AND r.value->'sighting_landed'='true'::jsonb
    AND s.listing_id=l.id AND s.sweep_job_id=j.id AND s.seen_at=j.source_at
    -- A detail page's age/availability testimony belongs to its exact item,
    -- not additional recommendation cards retained in the same capture.
    AND (j.capture->>'actual_url' !~ '^https://(www[.])?facebook[.]com/marketplace/item/' OR page.detail_id=l.facebook_id)
    AND ($4::text IS NULL OR l.facebook_id=$4)
  ORDER BY s.id,r.ordinal
), ordered AS (
  SELECT *,lag(asking_amount) OVER (PARTITION BY listing_id ORDER BY observed_at,capture_id,sighting_id) AS prior_amount,
    lag(asking_currency) OVER (PARTITION BY listing_id ORDER BY observed_at,capture_id,sighting_id) AS prior_currency
  FROM records
), query_revisits AS (
  SELECT listing_id,sum(n-1) AS same_query_revisits FROM (
    SELECT listing_id,actual_url,actual_region,count(*) AS n FROM records
    WHERE NOT detail_observation AND NOT saved_observation GROUP BY listing_id,actual_url,actual_region
  ) q GROUP BY listing_id
), histories AS MATERIALIZED (
  SELECT o.listing_id,min(o.facebook_id) AS facebook_id,
    (array_agg(o.title ORDER BY o.observed_at DESC,o.capture_id DESC))[1] AS title,
    (array_agg(o.current_vehicle_id ORDER BY o.observed_at DESC,o.capture_id DESC))[1] AS current_vehicle_id,
    min(o.observed_at) AS first_observed_at,max(o.observed_at) AS last_observed_at,
    extract(epoch FROM max(o.observed_at)-min(o.observed_at))/60 AS observed_span_minutes,
    count(*) AS observation_count,count(*) FILTER(WHERE NOT o.detail_observation AND NOT o.saved_observation) AS search_sightings,
    count(*) FILTER(WHERE o.detail_observation) AS detail_observations,
    count(*) FILTER(WHERE o.saved_observation) AS saved_observations,
    coalesce(max(q.same_query_revisits),0) AS same_query_revisits,
    count(*) FILTER(WHERE o.asking_amount IS NOT NULL AND o.prior_amount IS NOT NULL
      AND o.asking_currency IS NOT DISTINCT FROM o.prior_currency AND o.asking_amount<>o.prior_amount) AS observed_asking_changes,
    jsonb_agg(jsonb_build_object('sighting_id',o.sighting_id,'capture_id',o.capture_id,
      'observed_at',o.observed_at,'intake_started_at',o.intake_started_at,
      'capture_acknowledged_at',o.capture_acknowledged_at,'known_by',o.known_by,
      'asking_amount',o.asking_amount,'asking_currency',o.asking_currency,
      'source_reported_listed_at',o.source_reported_listed_at,'source_reported_age_label',o.source_reported_age_label,
      'detail_observation',o.detail_observation,'saved_observation',o.saved_observation,'retrieval_surface',o.retrieval_surface,
      'actual_region',o.actual_region,'actual_url',o.actual_url,'target_url',o.target_url,
      'source_scope_complete',o.source_scope_complete)
      ORDER BY o.observed_at,o.capture_id,o.sighting_id) AS observations
  FROM ordered o LEFT JOIN query_revisits q USING(listing_id) GROUP BY o.listing_id
)
SELECT statement_timestamp() AS measured_at,
  coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY observation_count DESC,last_observed_at DESC,listing_id)
    FROM (SELECT * FROM histories ORDER BY observation_count DESC,last_observed_at DESC,listing_id LIMIT 20) h),'[]') AS rows,
  (SELECT count(*)<=100 FROM runs) AS capture_window_complete,
  jsonb_build_object('selected_runs',(SELECT count(*) FROM selected),
    'acknowledged_runs',(SELECT count(*) FROM acknowledged),
    'withheld_runs',(SELECT count(*) FROM selected)-(SELECT count(*) FROM acknowledged),
    'retained_sightings',(SELECT count(*) FROM records),'listing_histories',(SELECT count(*) FROM histories),
    'repeated_histories',(SELECT count(*) FROM histories WHERE observation_count>1),
    'histories_with_asking_changes',(SELECT count(*) FROM histories WHERE observed_asking_changes>0)) AS summary`;

export async function readListingHistory(conn: IntakeConnection, scope: ReturnType<typeof listingHistoryScope>) {
  const reading = await boundedRead(conn, LISTING_HISTORY_SQL,
    [scope.eventBefore,scope.knownAt,scope.eventFrom,scope.facebookId]);
  return { ...reading, contract: 'facebook_listing_history_v1', section: 'listing_history',
    scope: { event_from: scope.eventFrom,event_before: scope.eventBefore,knowledge_cutoff: scope.knownAt,
      facebook_id: scope.facebookId,capture_limit: 100,listing_limit: 20,
      basis: 'retained_listing_sightings_in_selected_acknowledged_captures',
      knowledge_basis: 'capture_completion_upper_bound_not_per_sighting_admission_or_commit_time',
      availability_between_observations: 'unobserved',source_market_population: null,
      continuous_active_duration: null,confirmed_sale: null,relist_identity: 'unresolved' } };
}
