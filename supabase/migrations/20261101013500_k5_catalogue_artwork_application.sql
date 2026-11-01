-- Exact original matches OER *157532 image bytes, read 2026-11-01 UTC.
-- OER catalogue: 1975–80 Chevrolet K5 Blazer front-fender reproduction.
-- Catalogue applicability is not evidence of installation on any physical car.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

INSERT INTO public.vehicle_identity_marks
 (id,brand,family,year_start,year_end,mark_kind,display_label,fender_placement,svg_markup,provenance_note,vetted)
VALUES
 ('7c9b6538-88a2-53b7-91c3-ea91f4c3ae72','Chevrolet','K5 Blazer',1975,1980,'model_wordmark','K5 Blazer','front fender',
 '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 325"><image href="/stacks/makes/emblems/k5-blazer-reference-pair-924a1de7d4cb.svg" width="800" height="325"/></svg>',
 'OER *157532 GM-licensed reproduction, manufacturer catalogue https://www.oerparts.com/product/%2A157532.html; Classic Industries truck catalogue page 162 https://promo2.classicindustries.com/hubfs/Classic_Industries/pdf-catalogs/Truck/T_SEC_F.pdf?hsLang=en. 1975–80 Chevrolet K5 Blazer only. Read 2026-11-01 UTC. Not factory-original artwork or evidence of actual installation.',true)
ON CONFLICT (id) DO NOTHING;

-- Register a new identity scope; do not supersede or rewrite unbound originals.
-- Both registrations reuse the original immutable file paths and byte hashes.
SELECT public.record_vehicle_identity_mark_asset(
 (to_jsonb(a) - 'recorded_at') || jsonb_build_object(
   'id','1bfe5579-e712-51ed-b375-524d52c81eac','identity_mark_id','7c9b6538-88a2-53b7-91c3-ea91f4c3ae72','supersedes_id',NULL,
   'source_url','https://cdn.oerparts.com/assets/images/ProductImg/k/kit_157532.jpg',
   'source_context','OER *157532 reproduction artwork. Manufacturer image matches the owner-supplied original SHA256 exactly. Catalogue application: 1975–80 Chevrolet K5 Blazer front fender; not proof of actual installation.',
   'review_state','usable','applicability_evidence','https://www.oerparts.com/product/%2A157532.html; Classic Industries truck catalogue p162. Read 2026-11-01 UTC. Exact source SHA256(base64) CVrEt7t+9bM+Vw79EmKrqxcFriSjfuMBVrHGXYqj9Rw=. Chevrolet K5 Blazer 1975–80, no trim restriction.'))
FROM public.vehicle_identity_mark_assets a WHERE a.id='97ada8f5-fdde-51b0-b65b-ac983ad6c394'
 AND a.sha256_base64='CVrEt7t+9bM+Vw79EmKrqxcFriSjfuMBVrHGXYqj9Rw=';

SELECT public.record_vehicle_identity_mark_asset(
 (to_jsonb(a) - 'recorded_at') || jsonb_build_object(
   'id','b6600339-b156-5284-a40b-1c342e9cf694','identity_mark_id','7c9b6538-88a2-53b7-91c3-ea91f4c3ae72','supersedes_id',NULL,'source_asset_id','1bfe5579-e712-51ed-b375-524d52c81eac',
   'source_url','https://www.oerparts.com/product/%2A157532.html',
   'source_context','Traced derivative of OER *157532 reproduction artwork, catalogued for 1975–80 Chevrolet K5 Blazer. Original file and transformation parameters retained; not a factory drawing or evidence of actual installation.',
   'applicability_evidence','https://www.oerparts.com/product/%2A157532.html; Classic Industries truck catalogue p162. Read 2026-11-01 UTC. Derives from the exact hash-matched OER original; Chevrolet K5 Blazer 1975–80 only.'))
FROM public.vehicle_identity_mark_assets a WHERE a.id='991b3b46-4342-58d4-9ce8-3f6846580bc5'
 AND a.sha256_base64='kkod59TLoj583U1o1QIiYJ9+hcNS1pblb7qX0YMvwfY=';

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.vehicle_identity_marks WHERE id='7c9b6538-88a2-53b7-91c3-ea91f4c3ae72'
   AND brand='Chevrolet' AND family='K5 Blazer' AND year_start=1975 AND year_end=1980
   AND mark_kind='model_wordmark' AND display_label='K5 Blazer' AND vetted
   AND series_code IS NULL AND trim_package IS NULL AND body_style IS NULL)
 THEN RAISE EXCEPTION 'K5 artwork identity scope differs from reviewed catalogue'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.vehicle_identity_mark_assets WHERE id='1bfe5579-e712-51ed-b375-524d52c81eac' AND identity_mark_id='7c9b6538-88a2-53b7-91c3-ea91f4c3ae72')
    OR NOT EXISTS (SELECT 1 FROM public.vehicle_identity_mark_assets WHERE id='b6600339-b156-5284-a40b-1c342e9cf694' AND source_asset_id='1bfe5579-e712-51ed-b375-524d52c81eac')
 THEN RAISE EXCEPTION 'Required original artwork registrations unavailable'; END IF;
END $$;
COMMIT;
