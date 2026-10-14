-- vehicle_comments_unified as production has it on 2026-10-14 (pg_get_viewdef pretty, md5 561821b0f8495fb238b4a43a5d997e66).
-- security_invoker = true, owner postgres; the row policies of the three tables apply to the caller.
-- UNION ALL of auction_comments, user_comments and the comment and bid observations of vehicles with no auction_comments.
CREATE OR REPLACE VIEW public.vehicle_comments_unified WITH (security_invoker = true) AS
SELECT ac.id::text AS comment_id,
   ac.vehicle_id,
   ac.comment_text,
   ac.posted_at AS observed_at,
   ac.author_username,
   ac.comment_type,
   ac.bid_amount,
   ac.is_seller,
   ac.platform,
   ac.source_url AS comment_url,
   ac.external_identity_id,
   ac.media_urls,
   ac.auction_event_id,
   'auction'::text AS source_category,
   COALESCE(ac.platform, 'bat'::text) AS source_slug,
   NULL::uuid AS user_id,
   false AS is_editable
  FROM auction_comments ac
UNION ALL
SELECT uc.id::text AS comment_id,
   uc.vehicle_id,
   uc.comment_text,
   uc.created_at AS observed_at,
   NULL::text AS author_username,
   uc.target_type AS comment_type,
   NULL::numeric AS bid_amount,
   false AS is_seller,
   NULL::text AS platform,
   NULL::text AS comment_url,
   NULL::uuid AS external_identity_id,
   uc.media_urls,
   NULL::uuid AS auction_event_id,
   'user'::text AS source_category,
   'nuke'::text AS source_slug,
   uc.user_id,
   true AS is_editable
  FROM user_comments uc
UNION ALL
SELECT vo.id::text AS comment_id,
   vo.vehicle_id,
   vo.content_text AS comment_text,
   vo.observed_at,
   vo.structured_data ->> 'author_username'::text AS author_username,
   vo.structured_data ->> 'comment_type'::text AS comment_type,
   (vo.structured_data ->> 'bid_amount'::text)::numeric AS bid_amount,
   COALESCE((vo.structured_data ->> 'is_seller'::text)::boolean, false) AS is_seller,
   vo.structured_data ->> 'platform'::text AS platform,
   vo.source_url AS comment_url,
   NULL::uuid AS external_identity_id,
   NULL::text[] AS media_urls,
   NULL::uuid AS auction_event_id,
   'observation'::text AS source_category,
   COALESCE(os.slug, 'unknown'::text) AS source_slug,
   NULL::uuid AS user_id,
   false AS is_editable
  FROM vehicle_observations vo
    LEFT JOIN observation_sources os ON os.id = vo.source_id
 WHERE (vo.kind = ANY (ARRAY['comment'::observation_kind, 'bid'::observation_kind])) AND NOT (EXISTS ( SELECT 1
          FROM auction_comments ac
         WHERE ac.vehicle_id = vo.vehicle_id
        LIMIT 1))
;
GRANT SELECT ON public.vehicle_comments_unified TO anon, authenticated, service_role;
