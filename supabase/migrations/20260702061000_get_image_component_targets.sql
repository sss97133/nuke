-- get_image_component_targets — the tappable-target contract (UI/data co-development seam).
--
-- Skylar 2026-07-02: "haptic select the targets of the analysis... user clicks target object,
-- haptic makes a right-click type action, a menu with options pops up: order, save, comment...
-- if the chain lines up and we have receipt and part number and provenance it stands to reason
-- we can collapse the whole sales path."
--
-- One call per image → every identified component as a TAP TARGET: bbox (the tap region,
-- TWVP 0-999), identity (verbatim label + family + status + confidence), the evidence chain
-- (receipt item → vendor → price → date, matched token), catalog join when present, provenance
-- drill (analysis record → verdict path), and AFFORDANCES computed from the chain — can_order
-- is true only when a part number AND a known source exist (never a dead button). The UI
-- renders the haptic menu from this; no commerce flow is built here (order execution is a
-- separate, owner-gated build).
--
-- Reads the entity layer landed 2026-07-02 (component_identifications ← byok verdicts).
-- Only CURRENT targets: superseded analysis records are excluded. Owner-scoped v1.

create or replace function public.get_image_component_targets(p_image_id uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'image_id', p_image_id,
    'targets', coalesce(jsonb_agg(
      jsonb_build_object(
        'target_id',   ci.id,
        'bbox',        ci.bounding_box,
        'label',       ci.identification,
        'family',      ci.component_type,
        'status',      ci.status,
        'confidence',  ci.confidence,
        'part_number', ci.part_number,
        'evidence', case when ri.id is not null then jsonb_build_object(
          'receipt_item_id', ri.id,
          'receipt_id',      r.id,
          'vendor',          r.vendor_name,
          'description',     ri.description,
          'unit_price',      ri.unit_price,
          'purchase_date',   coalesce(r.purchase_date::text, r.transaction_date::text),
          'match_basis',     ci.source_references->>'match_basis',
          'matched_token',   ci.source_references->>'matched_token'
        ) else null end,
        'catalog', case when pc.id is not null then jsonb_build_object(
          'part_id',          pc.id,
          'name',             pc.name,
          'brand',            pc.brand,
          'average_price',    pc.average_price,
          'min_price',        pc.min_price,
          'max_price',        pc.max_price,
          'price_updated_at', pc.price_updated_at,
          'verified',         pc.verified
        ) else null end,
        'provenance', jsonb_build_object(
          'analysis_record_id', ci.analysis_record_id,
          'analyzed_by_model',  iar.analyzed_by_model,
          'analyzed_at',        iar.analyzed_at,
          'verdict_path',       ci.source_references->>'verdict_path',
          'scene_type',         ci.source_references->>'scene_type',
          'human_validated',    ci.human_validated
        ),
        'affordances', jsonb_build_object(
          'can_order',    ci.part_number is not null and (r.vendor_name is not null or pc.id is not null),
          'can_save',     true,
          'can_comment',  true,
          'order_source', coalesce(r.vendor_name, null)
        )
      )
      order by (ci.status = 'confirmed') desc, ci.confidence desc nulls last
    ), '[]'::jsonb)
  )
  from component_identifications ci
  join image_analysis_records iar
    on iar.id = ci.analysis_record_id and iar.superseded_by is null
  join vehicle_images vi
    on vi.id = ci.image_id and vi.user_id = auth.uid()
  left join receipt_items ri
    on ri.id = (ci.source_references->>'receipt_item_id')::uuid
  left join receipts r
    on r.id = ri.receipt_id
  left join parts_catalog pc
    on ci.part_number is not null and pc.part_number = ci.part_number
  where ci.image_id = p_image_id
    and ci.bounding_box is not null
$$;

grant execute on function public.get_image_component_targets(uuid) to authenticated;

comment on function public.get_image_component_targets(uuid) is
  'Tappable analysis targets for one image: bbox + identity + receipt/catalog evidence chain + provenance + computed affordances (can_order only when PN + source exist). The haptic-menu contract; owner-scoped v1. Reads component_identifications (entity layer, 2026-07-02).';
