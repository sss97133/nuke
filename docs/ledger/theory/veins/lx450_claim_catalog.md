# LX450 claim catalog: schema discovery, 2026-10-01

This is the discovery step that `.claude/rules/extraction.md` requires before any schema is designed: "sample 20–50 documents,
enumerate ALL fields, aggregate with frequencies, then design". Case C26 in `../data-machine-cases.md`.

**Method.** I read 25 full BaT descriptions straight from Postgres, with no web fetch. The source is
`extraction_metadata.field_value` where `field_name = 'raw_listing_description'`, which covers 97 LX450 vehicles at a median of
2,789 characters. I took rows 1, 4, 7 … 55, then 64, 73, 82, 91, 98 and 105 of the URL-sorted list, spread across 1996–1997
and 2019–2026 lots.

**Sampled lots** (`bringatrailer.com/listing/…`):
- lexus-lexus-450-land-cruiser
- 1996-lexus-lx-19, 1996-lexus-lx-25
- 1996-lexus-lx450, -lx450-19, -24, -29, -36-2, -4, -50, -57, -62, -65, -76, -81
- 1997-lexus-lx-20
- 1997-lexus-lx450-104, -114, -128, -141, -160, -176, -188, -47, -90

**What the descriptions look like.** BaT writes them in a fixed order:
1. a summary
2. exterior, paint and Carfax
3. wheels, brakes and suspension
4. interior and its flaws
5. gauges and odometer
6. engine and dated service
7. drivetrain and lockers
8. underside
9. Carfax history and states

Almost every claim is either:
- a **state at the listing date** (a condition of the truck as listed), or
- a **dated past event** (a repair or a Carfax entry).

Keeping those two times apart is the bitemporal rule in `data-machine.md`.

## The catalog (frequency out of 25)

"Home" names where each claim lands: an observation kind (the `observation_kind` enum), a descriptor in `condition_taxonomy`, or a
key in `observation_properties`. MISSING means that home doesn't exist yet; the proposed key follows.

| # | Claim type | n/25 | Time | Example (lot) | Home |
|---|---|---|---|---|---|
| 1 | Title status and state ("clean Texas title") | 25 | listing date | "a clean Texas title in the seller's name" (-65) | `ownership`; MISSING properties `title_status` (clean / salvage / rebuilt / not_actual_mileage / exempt) and `title_state` |
| 2 | Ownership history (acquired when, owner count, miles added) | 25 | dated past | "acquired by the seller in 2018 … approximately 10k of which were added" (-65) | `ownership` (dated) + `mileage_miles` EXISTS |
| 3 | Carfax accident or damage entry, dated | 13 (12 state "no accidents") | dated past | "accident … in February 2021 that involved damage to the front end" (-47) | `provenance` with descriptor `structural.collision.evidence` EXISTS; date in `observed_at`, never at the listing date |
| 4 | Dated service work (named components) | 23 | dated past | "head gasket, timing chain, water pump … replaced in November 2013" (-160) | `work_record` EXISTS; MISSING a component key (see note A) |
| 5 | Locking differentials (factory triple, center only, aftermarket air) | 20 | listing date | "locking front, center, and rear differentials" (-176); "air lockers" (-4) | `specification`; MISSING property `locking_differentials` (none / center / center_front_rear / aftermarket_air) |
| 6 | Paint scratches, chips, blemishes | 20 | listing date | "scratches and paint chips around the truck" (-176) | `condition`; `exterior.flag.scratch` EXISTS |
| 7 | Dated registration and location history | 20 | dated past | "registration history in Illinois from new" (lx-20) | `ownership` / `sighting`; place key is C8 |
| 8 | Modifications (lift, bumpers, winch, sliders, snorkel, supercharger) | 15 | listing date | "Old Man Emu suspension lift, an ARB Bull Bar front bumper, a winch" (-19) | `condition` states: `mechanical.suspension.lifted`, `exterior.accessories.winch`, `exterior.flag.brush_guard`, `mechanical.engine.forced_induction` EXIST; MISSING `exterior.accessories.aftermarket_bumper`, `exterior.accessories.rock_sliders`, `mechanical.intake.snorkel` |
| 9 | Inoperative or failing interior or electrical item | 12 | listing date | "the climate control fan only works on its highest setting" (-90) | `condition`; MISSING `interior.function.inoperative` (the junk `interior.electrical.*` keys are no home) |
| 10 | Underside corrosion | 8 | listing date | "corrosion on the underside including the frame rails" (land-cruiser) | `condition`; `structural.frame.corrosion` EXISTS for the frame, `exterior.metal.surface_oxidation` EXISTS for components |
| 11 | Service records or receipts present | 8 | listing date | "offered with … service records" (-114) | `provenance`; `provenance.documentation.service_records` EXISTS |
| 12 | Respray or refinish (whole or part) | 8 | dated or undated past | "said to have been repainted in 2016" (-29) | `condition`; `exterior.paint.respray` EXISTS |
| 13 | Seat wear, splits, rips | 7 | listing date | "splits and wear on the driver's seat and second-row bench" (-141) | `condition`; `interior.upholstery.tear` / `.wear` EXIST |
| 14 | Front axle, knuckle, Birfield or bearing service | 7 | dated past | "front Birfield joints and knuckles where overhauled" (-47) | `work_record`; component `front_axle` (note A) |
| 15 | Tire age or date codes | 7 | listing date | "tires that show signs of dry rot" (lx-20) | `condition`; MISSING `exterior.tires.aged` (`exterior.flag.tire_wear` is wear, not age) |
| 16 | Reupholstered interior | 5 | dated or undated past | "front seat cushions and center armrest have been reupholstered" (-57) | `condition`; `interior.upholstery.replaced` EXISTS |
| 17 | Oil or fluid leaks and seepage | 5 | listing date | "seepage from the rear main seal and oil pan" (-128) | `condition`; MISSING `mechanical.engine.oil_seepage`, `mechanical.drivetrain.axle_seal_leak` (`exterior.flag.leak` is too vague) |
| 18 | Significant paint failure (fading, peeling, bubbling, failing) | 4 | listing date | "bubbling paint is noted below the rear glass … fading paint on the roof" (-141) | `condition`; `exterior.paint.fading`, `.delamination`, `.blistering` EXIST |
| 19 | Head gasket or head work | 4 | dated past | "resurfacing the cylinder head and replacing the head gasket" (-65) | `work_record`; component `cylinder_head` (note A) |
| 20 | Running board or rocker rust | 4 | listing date | "rust on the driver-side rocker panel" (-62) | `condition`; `exterior.metal.oxidation` EXISTS (location in `region_detail`) |
| 21 | Dashboard cracked | 3 | listing date | "a crack on the top of the dashboard above the instrument cluster" (-141) | `condition`; `interior.dashboard.cracking` EXISTS |
| 22 | Emissions items (catalytic converter replaced, EGR bypass, O2 sensor) | 5 | dated past or listing date | "replacement of the radiator and the catalytic converter" (-19); "an EGR bypass system" (-65) | `work_record`; MISSING `mechanical.emissions.catalytic_converter_absent`, `mechanical.emissions.egr_bypassed` (a missing converter, as on the Facebook truck, is a state) |
| 23 | Engine replaced | 2 | dated past | "replaced with a new engine due to oil starvation at 90k miles in 2006" (land-cruiser) | `work_record`; `mechanical.engine.non_original` EXISTS as the resulting state |
| 24 | Odometer discrepancy | 2 | dated past | "an odometer reading of 79k miles was recorded in a November 2001 entry" (-188) | `provenance`; MISSING `provenance.odometer.discrepancy` |
| 25 | Window sticker, manuals, inspection report | 8 | listing date | "offered with a window sticker, the owner's manual, service records" (-160) | `provenance`; `provenance.documentation.window_sticker` EXISTS; MISSING `provenance.documentation.inspection_report` |
| 26 | Earlier market event of the same truck (previously sold on BaT, relist, failed buyer) | 2 | dated past | "previously sold on BaT in October 2023 and the winning bidder failed to follow through" (-36-2) | `sale_result` / `listing`; a blip on the market event (§1) |
| 27 | Seller type and reserve (dealer, no reserve, charity) | 25 | listing date | "offered by the selling dealer at no reserve" (-29) | `listing` structured data; market-event method dimension |
| 28 | Long storage or dormancy | 2 | dated past | "not driven from ~2017 until 2026" (-76) | `provenance` (dated span); MISSING `provenance.usage.dormant` |
| 29 | Stolen and recovered | 1 | dated past | "reported stolen in February 2008 and subsequently recovered" (lx-25) | `provenance`; MISSING `provenance.history.theft_recovered` |

**Note A: components.** Work records name parts: head gasket, water pump, Birfield, knuckle, axle seal, rear main seal, radiator,
catalytic converter, steering gearbox, brake booster. No component dimension exists for text claims. `condition_component_definitions`
(35 rows, idle) and the wiring part models are the candidates to extend before minting anything. Until that is decided, the
component goes in `structured_data.component` as text.

## Summary for design

- **Kinds.** Every claim type fits an existing `observation_kind`: `condition`, `work_record`, `provenance`, `ownership`,
  `specification`, `listing`, `sale_result`. No new kind is needed.
- **Descriptors.** 14 of the condition and provenance claim types have a real `condition_taxonomy` descriptor. 13 are MISSING
  (listed above).
- **Properties.** 3 property keys are MISSING: `title_status`, `title_state` and `locking_differentials`.
- **Junk keys.** About 110 `condition_taxonomy` keys are fragments parsed from service manuals (`interior.gauge.terminal_no`,
  `mechanical.fuel.seat_w_ith`, …), mostly under the `interior.electrical/fuse/gauge/hvac/wiring.*` and
  `mechanical.engine/fuel/steering/valve/wheels.*` prefixes. They should be deprecated (`deprecated_at`, never deleted) once a
  query confirms nothing references them.
- **The v0 rubric failed in a measurable way.** It scored `records` for 8/25 here but mixed it with manuals. It never captured
  lockers as a spec with grades (center versus triple versus air). It merged dated work with listing-date state. It scored
  `title_flag` against a field that, in 25 of 25 sampled descriptions, says "clean". Its two confirmed findings (lockers, poor paint)
  are the two claim types this catalog can key most cleanly.
