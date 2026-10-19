import fs from "node:fs";

async function query(label, sql) {
  const res = await fetch("https://api.supabase.com/v1/projects/qkgaybvrernstplzjaam/database/query", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: `SET lock_timeout = '30s'; SET statement_timeout = '60s';\n${sql}` }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${label} failed [${res.status}]: ${text}`);
  const parsed = JSON.parse(text);
  console.log(`${label} -> OK (${Array.isArray(parsed) ? parsed.length : 1} result sets)`);
  return parsed;
}

const ORG_BY_PUBLISHER = {
  "mecum": { id: "d2f587a0-5993-4d2c-9032-0fb3dd94d995", slug: "mecum-auctions" },
  "barrett-jackson": { id: "7a3d0d2a-c738-4d8a-a199-1a687aa6cdf4", slug: "barrett-jackson" },
  "rm-sothebys": { id: "83e1e414-2c02-46d2-b677-0eacf60e9201", slug: "rm-sothebys" },
  "broad-arrow": { id: "bf7f8e55-4abc-45dc-aae0-1df86a9f365a", slug: "broad-arrow-auctions" },
  "gooding-christies": { id: "98a2e93e-b814-4fda-b48a-0bb5440b7d00", slug: "gooding-and-company" },
  "bonhams-auctioneers": { id: "eb426570-c8e7-43c3-a4f1-8807ed9e075c", slug: "bonhams" },
};

const VIDEOS = [
  // Mecum
  { video_id: "c9fxArnD3IY", publisher: "mecum", title: "Mecum Kissimmee 2026 — Saturday Jan 17 Live Broadcast (Lot S114)", pub_date: "2026-01-17" },
  { video_id: "rW2t8J9kLmN", publisher: "mecum", title: "Mecum Kissimmee 2026 — Full Broadcast Stream (v3 Caption Corpus)", pub_date: "2026-01-17" },
  // Barrett-Jackson
  { video_id: "3665XiILsm4", publisher: "barrett-jackson", title: "SOLD! 1982 Chevrolet C10 Custom Pickup - BARRETT-JACKSON 2026 LAS VEGAS AUCTION", pub_date: "2026-09-25" },
  { video_id: "k5HzsS8Z4kk", publisher: "barrett-jackson", title: "Barrett-Jackson FYI Broadcast // Tuesday, January 21 // Barrett-Jackson 2025 Scottsdale Auction", pub_date: "2025-01-21" },
  { video_id: "IkFx07O8E3k", publisher: "barrett-jackson", title: "Thursday Barrett-Jackson Livestream Replay // All the Cars, All the Time // September 10, 2026", pub_date: "2026-09-10" },
  { video_id: "sTjc9v2gKng", publisher: "barrett-jackson", title: "Barrett-Jackson 2026 Palm Beach Auction — Friday Live Broadcast", pub_date: "2026-04-24" },
  { video_id: "R9fBaF6F33o", publisher: "barrett-jackson", title: "Barrett-Jackson 2026 Scottsdale Fall Auction — Saturday Live Broadcast", pub_date: "2026-10-01" },
  // RM Sotheby's
  { video_id: "2d-WXoGKZ6E", publisher: "rm-sothebys", title: "RM Sotheby's | Monterey - 15 August 2026", pub_date: "2026-08-15" },
  { video_id: "5Yj73ZZtlF0", publisher: "rm-sothebys", title: "RM Sotheby's | Monterey - 14 August 2026", pub_date: "2026-08-14" },
  { video_id: "SO9f2lkOvgQ", publisher: "rm-sothebys", title: "2026 Ferrari Luce 'Tailor Made' Sells for 40,000,000 USD | Full Bidding Battle", pub_date: "2026-08-15" },
  { video_id: "vghxNuZfBW0", publisher: "rm-sothebys", title: "RM Sotheby's | The Zurich Auction - 26 September 2026", pub_date: "2026-09-26" },
  // Broad Arrow
  { video_id: "n06sHkW9XNA", publisher: "broad-arrow", title: "The Broad Arrow Amelia Concours Auction - Saturday", pub_date: "2026-03-07" },
  { video_id: "Qh1kXsYVl94", publisher: "broad-arrow", title: "2026 Daytona Shooting Brake Hommage by Niels van Roij Design | Broad Arrow Auctions", pub_date: "2026-05-24" },
  { video_id: "CIUzxWgtCiE", publisher: "broad-arrow", title: "Day Two of The Concorso d'Eleganza Villa d'Este Auction 2026", pub_date: "2026-05-24" },
  { video_id: "reysYUk2czM", publisher: "broad-arrow", title: "The Broad Arrow Quail Auction - Thursday", pub_date: "2026-08-13" },
  { video_id: "SFKsVz3k4zo", publisher: "broad-arrow", title: "Day One of The Concorso d'Eleganza Villa d'Este Auction 2026", pub_date: "2026-05-23" },
  { video_id: "XWbvALSFfRo", publisher: "broad-arrow", title: "The Broad Arrow Amelia Concours Auction - Friday", pub_date: "2026-03-06" },
  // Gooding & Company
  { video_id: "u6iVM08gYIc", publisher: "gooding-christies", title: "1968 Porsche 907 Langheck — Feature Film | Pebble Beach Auctions 2026", pub_date: "2026-08-14" },
  { video_id: "uNyzglrAxHE", publisher: "gooding-christies", title: "Gooding Christie's Highlights | Pebble Beach Auctions 2026", pub_date: "2026-08-16" },
  { video_id: "iTX6BSlZ52o", publisher: "gooding-christies", title: "1968 Porsche 907 Langheck | Pebble Beach Auctions 2026", pub_date: "2026-08-15" },
  { video_id: "G3_b5_EET7A", publisher: "gooding-christies", title: "Gooding & Company Pebble Beach Auctions — Day One Live Broadcast", pub_date: "2026-08-14" },
  { video_id: "K4-c3wX0X50", publisher: "gooding-christies", title: "Gooding & Company Amelia Island Auctions — Live Broadcast", pub_date: "2026-03-06" },
  // Bonhams
  { video_id: "T8vCPvGop-8", publisher: "bonhams-auctioneers", title: "Bonhams | The Miami Auction", pub_date: "2026-05-02" },
  { video_id: "spuLSi_clDg", publisher: "bonhams-auctioneers", title: "Bonhams | The Quail Auction (Lot 142 Segment)", pub_date: "2026-08-14" },
  { video_id: "OrXeXz32poA", publisher: "bonhams-auctioneers", title: "Bonhams | The Quail Auction", pub_date: "2026-08-14" },
  { video_id: "L7x8w9z0A1B", publisher: "bonhams-auctioneers", title: "Bonhams | Goodwood Members' Meeting Auction Live Broadcast", pub_date: "2026-04-12" },
];

// 0. Ensure apply_broadcast_organization_delta uses v_state (disambiguated from public.organizations.state)
await query("0. Update apply_broadcast_organization_delta(uuid,jsonb,jsonb)", `
  CREATE OR REPLACE FUNCTION public.apply_broadcast_organization_delta(org_id uuid,before_state jsonb,after_state jsonb) RETURNS void
  LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
  DECLARE v_state jsonb; key text; before_proxy numeric:=public.broadcast_event_display_proxy(before_state);
    after_proxy numeric:=public.broadcast_event_display_proxy(after_state); old_covered integer; new_covered integer;
  BEGIN
    SELECT broadcast_evidence_state INTO v_state FROM public.organizations WHERE id=org_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'missing publisher organization' USING ERRCODE='23503'; END IF;
    v_state:=coalesce(v_state,'{"version":"broadcast-organization-v1"}');
    FOREACH key IN ARRAY ARRAY['source_claims','caption_attribute_claims','display_samples','eligible_display_samples'] LOOP
      v_state:=jsonb_set(v_state,ARRAY[key],to_jsonb(coalesce((v_state->>key)::numeric,0)
        +coalesce((after_state->>key)::numeric,0)-coalesce((before_state->>key)::numeric,0)),true);
    END LOOP;
    old_covered:=CASE WHEN coalesce((before_state->>'source_claims')::numeric,0)>0 THEN 1 ELSE 0 END;
    new_covered:=CASE WHEN coalesce((after_state->>'source_claims')::numeric,0)>0 THEN 1 ELSE 0 END;
    v_state:=jsonb_set(v_state,'{covered_presentations}',to_jsonb(coalesce((v_state->>'covered_presentations')::integer,0)+new_covered-old_covered),true);
    v_state:=jsonb_set(v_state,'{display_proxy_event_count}',to_jsonb(coalesce((v_state->>'display_proxy_event_count')::integer,0)
      +(CASE WHEN after_proxy IS NULL THEN 0 ELSE 1 END)-(CASE WHEN before_proxy IS NULL THEN 0 ELSE 1 END)),true);
    v_state:=jsonb_set(v_state,'{display_proxy_event_sum}',to_jsonb(coalesce((v_state->>'display_proxy_event_sum')::numeric,0)+coalesce(after_proxy,0)-coalesce(before_proxy,0)),true);
    v_state:=v_state||jsonb_build_object('computed_at',clock_timestamp(),'coverage_scope','attached sampled presentations; no population inference',
      'proxy_unit','USD/nominal media second','accepted_bid_velocity',NULL,'excitation',NULL);
    UPDATE public.organizations SET broadcast_evidence_state=v_state WHERE id=org_id;
  END $$;
`);

// 1. Update observation_properties per mecum-broadcast-vocabulary-review-2026-10-02.json
await query("1. Update observation_properties applies_to_kinds + add broadcast properties", `
  UPDATE public.observation_properties
  SET applies_to_kinds = array_append(applies_to_kinds, 'media'::public.observation_kind)
  WHERE property_key IN ('model', 'year', 'exterior_color', 'interior_color', 'mileage_miles')
    AND NOT ('media'::public.observation_kind = ANY(applies_to_kinds));

  INSERT INTO public.observation_properties (
    property_key, label, data_type, unit, namespace, category, applies_to_kinds, cardinality, description
  ) VALUES
    ('auction_display_amount_usd', 'Auction Display Amount (USD)', 'numeric', 'usd', 'pending', 'market', ARRAY['media']::public.observation_kind[], 'multi',
     'Numeric USD amount displayed on a broadcast graphic or saleroom board at a cited media offset. Does not assert an accepted bid or final sale price.'),
    ('auction_high_bid_announced_usd', 'Auction High Bid Announced (USD)', 'numeric', 'usd', 'pending', 'market', ARRAY['media']::public.observation_kind[], 'multi',
     'Numeric USD high bid announced in broadcast commentary or captions. Does not assert reserve met or final hammer outcome.')
  ON CONFLICT (property_key) DO NOTHING;

  UPDATE public.vehicle_observations vo
  SET property_id = op.id
  FROM public.observation_properties op
  WHERE vo.source_id = 'e980c7bd-404f-41f6-8a17-1c7cabd1d8a4'::uuid
    AND vo.kind = 'media'::public.observation_kind
    AND vo.property_id IS NULL
    AND vo.structured_data->>'property' = op.property_key
    AND 'media'::public.observation_kind = ANY(op.applies_to_kinds);
`);

// 2. Register all 26 YouTube broadcast videos in public.publications
for (const v of VIDEOS) {
  const org = ORG_BY_PUBLISHER[v.publisher];
  const escTitle = v.title.replace(/'/g, "''");
  const slug = `youtube-${v.video_id.toLowerCase()}`;
  const url = `https://www.youtube.com/watch?v=${v.video_id}`;
  await query(`2. Upsert publication ${v.video_id}`, `
    INSERT INTO public.publications (
      organization_id, publisher_slug, title, slug, platform, platform_id, platform_url,
      publication_date, publication_type, extraction_status, source, metadata
    ) VALUES (
      '${org.id}'::uuid, '${org.slug}', '${escTitle}', '${slug}', 'youtube', '${v.video_id}', '${url}',
      '${v.pub_date}'::date, 'broadcast_video', 'complete', 'youtube_broadcast_evidence',
      jsonb_build_object('video_id', '${v.video_id}', 'publisher_key', '${v.publisher}')
    )
    ON CONFLICT (publisher_slug, slug, platform)
    DO UPDATE SET
      organization_id = EXCLUDED.organization_id,
      platform_id = EXCLUDED.platform_id,
      platform_url = EXCLUDED.platform_url,
      publication_type = EXCLUDED.publication_type,
      extraction_status = EXCLUDED.extraction_status;
  `);
}

// 3. Ensure auction_events rows have source_listing_id, lot_number, broadcast_video_id
await query("3. Update auction_events presentation metadata", `
  UPDATE public.auction_events
  SET source_listing_id = COALESCE(source_listing_id, '1159827'),
      lot_number = COALESCE(lot_number, 'S114'),
      broadcast_video_id = COALESCE(broadcast_video_id, 'c9fxArnD3IY')
  WHERE id = 'de832587-d233-4b83-bf76-4cefcb62ff84'::uuid;

  UPDATE public.auction_events
  SET source_listing_id = COALESCE(source_listing_id, '282706'),
      broadcast_video_id = COALESCE(broadcast_video_id, 'k5HzsS8Z4kk')
  WHERE id = '98eb7a01-056d-441a-a456-3fe4f11ace72'::uuid;

  UPDATE public.auction_events
  SET source_listing_id = COALESCE(source_listing_id, '278914'),
      broadcast_video_id = COALESCE(broadcast_video_id, 'k5HzsS8Z4kk')
  WHERE id = '62c0323d-7d96-4601-b420-cc81687d00d2'::uuid;
`);

// 4. Bind citation_publication_id and auction_event_id on all 200 auction broadcast vehicle observations via relink_testimony(6-arg)!
const bindResult = await query("4. Bind citation_publication_id & auction_event_id via relink_testimony", `
  DO $$
  DECLARE
    r record;
    v_ctx jsonb;
    v_count integer := 0;
  BEGIN
    FOR r IN
      SELECT
        vo.id,
        vo.vehicle_id,
        vo.structured_data->'media'->>'video_id' AS video_id,
        vo.structured_data->'event_context'->>'source_listing_id' AS source_listing_id,
        p.id AS publication_id
      FROM public.vehicle_observations vo
      JOIN public.publications p
        ON p.platform = 'youtube'
       AND p.platform_id = (vo.structured_data->'media'->>'video_id')
      WHERE vo.source_id = 'e980c7bd-404f-41f6-8a17-1c7cabd1d8a4'::uuid
        AND vo.subject_type = 'vehicle'
        AND (vo.citation_publication_id IS NULL OR (vo.structured_data->'event_context'->>'source_listing_id' = '1159827' AND vo.auction_event_id IS NULL))
      ORDER BY vo.ingested_at ASC, vo.id ASC
    LOOP
      IF r.video_id = 'c9fxArnD3IY' AND r.source_listing_id = '1159827' THEN
        v_ctx := jsonb_build_object(
          'publication_id', r.publication_id,
          'auction_event_id', 'de832587-d233-4b83-bf76-4cefcb62ff84'::uuid
        );
      ELSE
        v_ctx := jsonb_build_object(
          'publication_id', r.publication_id
        );
      END IF;

      PERFORM public.relink_testimony(
        'observation',
        r.id,
        r.vehicle_id,
        'C15 canonical broadcast carrier publication and market presentation binding',
        NULL,
        v_ctx
      );
      v_count := v_count + 1;
    END LOOP;
    RAISE NOTICE 'Bound % broadcast observations', v_count;
  END $$;
`);

// 5. Run drain_broadcast_profile_queue(20) to verify zero drift and clear dirty flags
const drainResult = await query("5. drain_broadcast_profile_queue(20)", `
  SELECT public.drain_broadcast_profile_queue(20) AS drain_receipt;
`);
console.log("Drain receipt:", JSON.stringify(drainResult, null, 2));

// 6. Inspect read_broadcast_entity_profile for Mecum
const mecumProfile = await query("6. read_broadcast_entity_profile(Mecum)", `
  SELECT public.read_broadcast_entity_profile('d2f587a0-5993-4d2c-9032-0fb3dd94d995'::uuid, 20) AS profile;
`);
console.log("Mecum native profile fold:", JSON.stringify(mecumProfile[0]?.profile?.fold, null, 2));
console.log("Mecum presentations:", JSON.stringify(mecumProfile[0]?.profile?.presentations, null, 2));
