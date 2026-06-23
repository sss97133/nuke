-- get_make_model_sentiment_points: carry each comment's source_url so the iOS
-- sentiment alignment map can DRILL a dot to where the comment was actually said
-- (the auction listing). A presented comment that can't reach its source is a
-- broken drill path — "tap anything → its real evidence opens." auction_comments
-- already stores source_url; we were just not passing it through. Pure additive
-- field on the per-comment points object; no behavior change otherwise.

CREATE OR REPLACE FUNCTION public.get_make_model_sentiment_points(p_make text, p_model text, p_year integer DEFAULT NULL::integer, p_grain text DEFAULT 'year'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
declare v_subject uuid; v_ids uuid[]; v_canon text; v_points jsonb; v_agg jsonb; v_2axis jsonb;
begin
  select cm.canonical_model into v_canon from public.canonical_models cm
   where lower(cm.make)=lower(p_make)
     and (lower(cm.canonical_model)=lower(p_model) or lower(p_model)=any(select lower(a) from unnest(cm.aliases) a)) limit 1;
  v_canon := coalesce(v_canon, p_model);
  select subject_id into v_subject from public.make_model_profiles
   where lower(canonical_make)=lower(p_make) and lower(canonical_model)=lower(v_canon)
     and grain=p_grain and (p_grain<>'year' or year=p_year) limit 1;
  if v_subject is null then return jsonb_build_object('resolved',false,'note','No subject registered — intake gap, not a verdict.'); end if;
  select array_agg(vehicle_id) into v_ids from public.cohort_members(v_subject);

  select jsonb_build_object('populated', count(*)>0, 'source','auction_comments', 'n', count(*),
     'n_vehicles', count(distinct ac.vehicle_id),
     'n_stance', count(*) filter (where ac.community_stance_score is not null),
     'points', coalesce(jsonb_agg(jsonb_build_object(
        'comment_id', ac.id, 'vehicle_id', ac.vehicle_id,
        'sentiment', round((ac.sentiment_score/100.0)::numeric,3),       -- -1..1
        'stance', round(ac.community_stance_score::numeric,3),           -- -1..1 (null = unscored)
        'kind', ac.comment_type, 'is_seller', ac.is_seller, 'author', ac.author_username,
        'likes', ac.comment_likes, 'text', left(ac.comment_text,280),
        'source_url', ac.source_url) order by ac.sentiment_score), '[]'::jsonb))   -- drill: where it was said
    into v_points
  from public.auction_comments ac
  where ac.vehicle_id = any(v_ids) and ac.sentiment_score is not null
    and ac.comment_type <> 'bid' and ac.bid_amount is null;

  select jsonb_build_object('populated', count(*)>0,
     'mean', round((avg(ac.sentiment_score)/100.0)::numeric,3),
     'stddev', round((stddev(ac.sentiment_score)/100.0)::numeric,3),
     'n_positive', count(*) filter (where ac.sentiment_score>10),
     'n_negative', count(*) filter (where ac.sentiment_score<-10),
     'n_neutral', count(*) filter (where ac.sentiment_score between -10 and 10))
    into v_agg
  from public.auction_comments ac
  where ac.vehicle_id = any(v_ids) and ac.sentiment_score is not null
    and ac.comment_type <> 'bid' and ac.bid_amount is null;

  select jsonb_build_object('populated', count(*)>0, 'axis','community_stance',
     'label','challenges ↔ vouches the car''s claims',
     'n', count(*), 'mean', round(avg(community_stance_score)::numeric,3),
     'stddev', round(stddev(community_stance_score)::numeric,3),
     'n_vouch', count(*) filter (where community_stance_score>0.2),
     'n_challenge', count(*) filter (where community_stance_score<-0.2))
    into v_2axis
  from public.auction_comments ac
  where ac.vehicle_id = any(v_ids) and ac.community_stance_score is not null
    and ac.comment_type <> 'bid' and ac.bid_amount is null;

  return jsonb_build_object('resolved',true,'subject_id',v_subject,
    'cohort', jsonb_build_object('make',p_make,'model',v_canon,'year',p_year,'grain',p_grain),
    'spectrum', coalesce(v_agg, jsonb_build_object('populated',false)),
    'comment_points', coalesce(v_points, jsonb_build_object('populated',false)),
    'second_axis', coalesce(v_2axis, jsonb_build_object('populated',false)));
end; $function$;

NOTIFY pgrst, 'reload schema';
