# Layer Dependencies

**Status:** Live contract (load-bearing)
**Cited by:** `supabase/functions/_shared/cockpit/attribute-registry.ts` (~line 91)
**Companion to:** `image-to-atom-taxonomy.md` (the L1–L5 layers themselves)
**Enforced by:** `AttributeDefinition.depends_on` + the `topoSort()` in `attribute-registry.ts` (~lines 1181–1199), surfaced through `getChecklist()`.

---

## The rule, verbatim

From the registry's `layer` field documentation (`attribute-registry.ts:89–91`):

> The L1–L5 layer per image-to-atom-taxonomy.md.
> Lower layers must be answered before higher layers can be (e.g. **L3 color depends on L2 vehicle bbox** per layer-dependencies.md).

There are two orderings, and they must agree:

1. **Coarse — the layer number (L1 < L2 < L3 < L4 < L5).** A higher layer is downstream of every lower layer *in general*.
2. **Fine — the per-attribute `depends_on` edges.** The exact atoms that must already exist before *this* attribute can be answered.

This doc specifies the *fine* edges that cross layers — the dependencies a caller agent must satisfy before it can answer a given attribute. These are the edges `topoSort()` walks.

## The canonical example: color depends on bbox

`vehicle.exterior_color` is an **L3** attribute. Its definition (`attribute-registry.ts:471–487`):

```ts
{
  attribute: "vehicle.exterior_color",
  layer: 3,
  depends_on: ["image.vehicle_bboxes", "vehicle.viewpoint"],
  prompt: "Extract the exterior color from the vehicle's body panels ONLY
           (ignore background, sky, ground, wheels, glass) ...",
}
```

The dependency is not bureaucratic — it is **what makes the answer correct**:

- `image.vehicle_bboxes` is **L1**. Without the box, "the dominant color of the image" includes sky, asphalt, and the garage wall. The color attribute is defined as *body-panels-only*; you cannot honor "body panels only" until you know which pixels are the body. The bbox is the mask.
- `vehicle.viewpoint` is **L2**. The viewpoint disambiguates which panels are even visible (a rear shot can't report hood color) and guards against reading a reflection or an interior trim color as the exterior.

So `exterior_color` (L3) has a hard edge back to `vehicle_bboxes` (**L1**, skipping L2 for that edge) and to `viewpoint` (L2). The layer number bounds the dependencies; it does not enumerate them. **Edges may skip layers** (L3→L1), but they never point *forward* (a lower layer never depends on a higher one). The graph is a DAG, and `topoSort` relies on it being acyclic.

## The full cross-layer dependency map (live)

Read straight from `depends_on` in the registry:

| Attribute | Layer | `depends_on` | Edge crosses |
|---|---|---|---|
| `image.classification` | L1 | `image.has_vehicle` | within L1 |
| `image.vehicle_bboxes` | L1 | `image.has_vehicle` | within L1 |
| `vehicle.viewpoint` | L2 | `image.vehicle_bboxes` | L2→L1 |
| `vehicle.year_range` | L2 | `image.vehicle_bboxes` | L2→L1 |
| `vehicle.make` | L2 | `image.vehicle_bboxes` | L2→L1 |
| `vehicle.model` | L2 | `vehicle.make` | within L2 |
| `vehicle.vin_visible` | L2 | `image.ocr_regions` | L2→L1 |
| `vehicle.plate_redacted` | L2 | `image.ocr_regions` | L2→L1 |
| `vehicle.exterior_color` | L3 | `image.vehicle_bboxes`, `vehicle.viewpoint` | L3→L1, L3→L2 |
| `vehicle.current_color` | L3 | `image.vehicle_bboxes`, `vehicle.viewpoint` | L3→L1, L3→L2 |
| `vehicle.condition_cues` | L3 | `image.vehicle_bboxes` | L3→L1 |
| `vehicle.odometer_reading` | L3 | `image.ocr_regions` | L3→L1 |
| `vehicle.modifications` | L3 | `vehicle.year_range`, `vehicle.model` | L3→L2 |
| `vehicle.refinish_event` | L4 | `vehicle.current_color` | L4→L3 |
| `image.likely_vehicle_id` | L5 | `image.vehicle_bboxes`, `vehicle.year_range`, `vehicle.make`, `vehicle.model`, `vehicle.exterior_color` | L5→L1/L2/L3 |

A few structural observations:

- **L1 detection atoms are the root.** `image.has_vehicle`, `image.vehicle_bboxes`, and `image.ocr_regions` have no dependencies; everything eventually traces back to them. If detection fails, the whole subtree is unanswerable — correctly.
- **The two L1 roots split the tree.** Spatial attributes (color, condition, viewpoint, identity) descend from `vehicle_bboxes`; textual attributes (VIN, odometer, plate) descend from `ocr_regions`. They reconverge only at L5 linking.
- **`image.likely_vehicle_id` is the deepest node** — it depends on one atom from L1, three from L2, and one from L3. It is last in any topological order, which is right: you bind an image to a chassis only after you've extracted everything that could distinguish chassis.

## Dependencies the registry encodes in prose, not `depends_on`

Two attributes have real dependencies that are *not* expressed as `depends_on` edges, by design:

- **`cluster.work_transition`** (L5) consumes the per-image `state_observations` atoms on two consecutive `work_sessions`. Those atoms live in `ai_scan_metadata.byok_deep_analysis`, not as registry attributes, so the dependency is stated in the prompt rather than as an edge (`attribute-registry.ts:884–887`). `topoSort` can't order what isn't a registry attribute.
- **Compound projections** (`invoice_artifact`, `work_log_artifact`, `make_model.*`) depend on whole tables of atoms, not single attributes; their layer is nominal (5 = synthesis) and they carry no `depends_on`.

When a real dependency cannot be a clean attribute-to-attribute edge, it is documented in the prompt — never silently dropped.

## How `topoSort` uses this

`getChecklist(subject_kind)` filters the registry to the subject, then runs `topoSort()`:

```ts
function visit(d) {
  if (visited.has(d.attribute)) return;
  visited.add(d.attribute);
  for (const dep of d.depends_on ?? []) {
    const depDef = byName.get(dep);
    if (depDef && inSet.has(dep)) visit(depDef);   // emit dependency first
  }
  out.push(d);                                       // then emit self
}
```

The output guarantees: **a caller iterating the returned list top-to-bottom answers every dependency before the attribute that needs it.** Note the `inSet.has(dep)` guard — if a layer filter (`include_layers`) excludes a dependency, the sort silently drops that edge rather than emitting an out-of-scope attribute. So a caller that requests "L3 only" gets L3 attributes ordered among themselves, but is responsible for having the excluded L1/L2 atoms already in the substrate. The dependency map above is the full picture; the checklist is a filtered, sorted view of it.

## The done-test

A `depends_on` edge is correct iff the dependent attribute's answer would be *wrong or unanswerable* without the dependency's atom — not merely "nicer to have." Color without a bbox is wrong (it averages in the sky). Make without a bbox is unanswerable (which vehicle?). If removing the edge wouldn't change the answer's correctness, it isn't a dependency — it's a preference, and preferences don't belong in `depends_on`.
