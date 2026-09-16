# Node Dossier — Delmo Speed (v0)

**Org ID:** `fd76096a-cae0-4425-8246-08e1bc526f21`
**Handle:** @delmospeed · **Web:** https://delmospeed.com
**Type:** builder / "Custom restomod builder."
**Dossier date:** 2026-06-10 · **Status:** SEED (first node of the mesh map)

This is the first end-to-end node in the high-value-shop mesh. Built with
wire-closure discipline: every claim is cited to data or explicitly marked unknown.
Ground-truthed against Skylar's K5 (his build sources Delmo parts).

---

## 1. Current node state — STUB

Org record exists but is un-enriched. `enrichment_status = stub`. Of ~120 intelligence
columns, **all are empty or 0**: specializations, specialty_makes, services_offered,
employee_count, social_links, total_vehicles_worked, trust_score, founded_year,
city/state, hourly_rate, bay_count. `is_verified = false`.

What we actually hold: `name`, `slug=delmo-speed`, `website=https://delmospeed.com`,
`description="Custom restomod builder."`, `entity_type=builder`. Created 2026-01-20.

**Gap:** the node is a name + URL. No depth.

## 2. Structured edges — NONE

No vehicle references Delmo via `selling_organization_id`, `origin_organization_id`,
or `owner_shop_id`. The org↔vehicle relationship does not exist in the graph.

## 3. Recovered output — from text signal (search_vector @@ 'delmo', Oldsmobile excluded)

19 vehicles, unmistakably this node's work. Attributed via **text signal only —
pending listing-level verification** (not yet a verified built-by edge).

| vehicle_id | year | model | price |
|---|---|---|---|
| 21b38bce-bad7-4e8b-8743-064a378d75cf | 1963 | Corvette Grand Sport | $319,950 |
| 17211105-a882-4ff5-b647-a1a02b064ff7 | 1963 | Corvette | $249,950 |
| eb70102a-f581-44be-a426-2c5d5c2bb2dc | 1963 | Superformance Corvette Grand Sport | $219,900 |
| 776e2f8f-c0ae-4dae-898e-1c49b7a2e166 | 1964 | C10 Custom Pickup | $200,000 |
| 648faa4f-c786-4eca-97ac-d411681a5474 | 1972 | Camper | $187,000 *(uncertain)* |
| 5e0ba369-f169-4b98-8167-d3c35885523c | 1963 | C10 Custom Pickup | $148,500 |
| 8ffb97c2-f5cc-4eab-9408-fa9a3eec0562 | 1965 | C10 | $105,000 |
| 2a74bb71-6db4-4b69-a5f1-358be8ea91e7 | 1965 | C10 | $105,000 |
| e1039915-49e9-4c92-8d00-ab030f9cad93 | 1963 | LS3 C10 Pickup | $85,000 |
| baad8af1-f1bd-4259-beb3-ecb3ea2b3676 | 1970 | Blazer Custom SUV | $83,600 |
| 2cf32faa-d9f8-473a-b0c0-2b120f174302 | 1951 | LS3 3100 Hot Rod | $83,500 |
| 75409d14-f691-4506-82fc-3e30cba7da20 | 1951 | LS3 3100 Hot Rod | $83,500 |
| 7419b241-afde-40d5-a6e5-c2e5fd79f142 | 1967 | C10 | $75,000 |
| **57058eec-6874-4e0f-8fc3-be470683ffe2** | **1970** | **LS3 K5 Blazer** | **$70,700** |
| c4556d99-9add-4012-b384-94a6122f88b4 | 1965 | C10 Pickup | $40,000 |
| 8f3c6eea-74df-481d-8357-0fabfa3ebee7 | 1928 | Hemi Ford Model A Hot Rod | $36,500 *(uncertain — non-GM)* |
| d711369e-3e1a-47db-9dff-e3ff04331fb1 | 1965 | C10 6-Speed | $29,000 |
| d7486076-eeb3-491c-ae19-24027fda9741 | 1959 | Apache | (no price) |
| d733356d-5127-4598-95bb-8ce54ac3e458 | 1963 | C10 Custom Pickup | (no price) |

**Signature:** LS-swapped pro-touring GM — C10 trucks, K5 Blazers, '63 Corvettes.
Median ~$85k, range $29k–$320k. Six-figure tier; far above the generic LS-swap market.

## 4. Ground-truth edge — Skylar's K5

Delmo built `57058eec` (1970 K5 Blazer, LS3, $70,700) — same body, same LS idiom as
Skylar's build, which sources Delmo parts. This node connects to Skylar's own garage,
which is why it's the correct seed: the first edge is hand-verifiable.

## 5. The access layer (why this node matters per the mesh thesis)

A high-value node broadcasts needs (talent / clients / capital / exposure) it can't
hide because it needs them filled. Delmo's need-signal lives on @delmospeed (Instagram),
NOT in transaction data. The product job: read the broadcast, close the access loop.
Need-signal capture is unbuilt — see next bricks.

## 6. Next bricks (ordered, one per turn — wire-closure discipline)

1. **Verify the built-by edges.** Fetch 2–3 listings (start with the K5 `57058eec`)
   and confirm Delmo attribution at the source before promoting text-signal → verified edge.
2. **Design the builder↔vehicle relationship.** Do NOT stuff `selling_organization_id`
   (wrong semantics — Delmo built, didn't necessarily sell). Needs a proper `built_by`
   attribution with provenance, per the trust-invariant rules.
3. **Enrich the stub** from delmospeed.com + @delmospeed: specializations, makes,
   services, social_links, location.
4. **Capture need-signal** from @delmospeed (the Instagram sensor) — the access-layer seed.

## 7. Provenance / honesty

Section 3 edges are text-signal attributions, explicitly NOT yet verified built-by
links. They are contestable and will be superseded by listing-verified edges, not
overwritten. Two rows flagged uncertain. No FK was written to the substrate on the
basis of unverified text — by design.
