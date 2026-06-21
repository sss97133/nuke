# dT Operator Fan-Out Results — 2026-05-31

Per-vehicle results of the dT (delta-state) operator fan-out: each vehicle's projection event was operated (proposed change_type + confidence) and then independently re-verified against the pixels by an adversarial verifier.

## Results

| Vehicle | change_type | confidence | supported_by_pixels | owner_confirm? | projection_event_id |
|---|---|---|---|---|---|
| 1983 GMC K2500 | surface_prep | 0.55 | true | yes | b8300d21-5e1b-4c1d-bb2c-97f9f4b99496 |
| 1966 Ford Mustang | none | 0.35 | true | yes | e6afb0ac-1b16-4097-a52d-63d318736b7f |
| 1983 GMC K2500 Sierra Classic | interior | 0.60 | true | yes | 85757001-863e-48f6-9e33-4bfc6e066772 |
| 1989 Chevrolet R3500 Cheyenne | none | 0.62 | true | no | d837b138-2d5c-42aa-8066-99a09ff33dcd |
| 1995 Chevrolet Suburban 2500 | diagnosis | 0.55 | true | yes | 5fd38908-11cb-48a5-9274-dd76b32c3ed3 |
| 1980 Chevrolet K10 | none | 0.60 | true | yes | 00dcee10-dba6-48af-a73f-701b108577b4 |

## Counts

- **Total events operated:** 6
- **Real transitions** (change_type != none): **3** — surface_prep (K2500), interior (K2500 Sierra Classic), diagnosis (Suburban 2500)
- **'none'** (no value-accruing labor / use or transport / cross-vehicle): **3** — Mustang, R3500 Cheyenne, K10
- **Failed-submit** (non-empty submit_error): **0**
- **Overclaimed** (supported_by_pixels=false): **0** — every verifier agreed the claim was pixel-supported, though several flagged zone-level overreach within an otherwise-correct label (see below)

### Zone-level overreach inside pixel-supported claims (not full overclaims)
- **K2500 surface_prep:** the `bed` zone is not supported — ev1 (0ab21b7c) is the bed-floor shot showing original paint + surface rust + a wiring lead, reads as wiring routing/documentation, not sanding. Doors and fender/cowl edge ARE supported.
- **K2500 Sierra Classic interior:** ev3 (IMG_8316) is the truck on a two-post lift (underbody/chassis), not interior — an off-zone image folded into an interior event.
- **Suburban diagnosis:** ev3 (IMG_9190) is a finished exterior glamour walkaround, not work — must not inflate this into a completed-work claim.

## Flagged for owner confirmation

5 of 6 events were flagged `recommend_owner_confirm: true`:

- **1983 GMC K2500 (surface_prep):** real bare-metal sanding labor plausible; confirm zones and whether ev1 (bed/wiring) belongs in the event.
- **1966 Ford Mustang (none):** after-photos appear mis-attributed — they show a *different* vehicle (a squarebody truck in fresh paint), not the Mustang. Owner should resolve the cross-vehicle attribution rather than silently accept zero change.
- **1983 GMC K2500 Sierra Classic (interior):** real upholstery labor (stripping, cutting/staging foam + material) plausible; per the photo-intent rule the foam/material could be parts_sourcing vs labor — confirm scope and that ev3 (lift/underbody) doesn't belong.
- **1995 Chevrolet Suburban 2500 (diagnosis):** wheel-off multi-zone brake/underbody inspection is plausibly billable; borderline inspection-vs-start-of-brake-job — confirm intent before value accrues.
- **1980 Chevrolet K10 (none):** after-cluster mixes a non-subject red vehicle and a separate towed truck; confirm because of cross-vehicle mixing and borderline (0.6) intent, even though no labor on the K10 is shown.

The only event **not** flagged was the **1989 R3500 Cheyenne (none)** — an unambiguous vehicle-in-use sequence (towing, then desert driving/recreation), no labor shown, no confirmation needed.

## Gaps still open (for engineers)

- **(a) Cluster / work_session discovery missing in `find_subjects_needing_atoms`.** The subject-discovery path in the mcp-connector (`index.ts` ~line 3344) does not surface photo clusters or work_sessions, so the operator can't natively walk a session's photo set when projecting a transition.
- **(b) `vehicle_images.work_session_id` is unpopulated.** There is no reliable session→photo link, so evidence/before-photo windows are assembled heuristically. Need a session→photo resolver / RPC that populates or resolves `work_session_id`.
- **(c) BYOK `state_observations` coverage is sparse.** Before/after state is thin for many vehicles, which is why several verdicts lean on ad-hoc before-session photo windows rather than recorded state.
- **(d) Owner-confirmation wiring before value reaches the `work_sessions` ledger.** 5 of 6 events need owner confirmation, but there is no plumbed path to capture that confirmation and gate value accrual into the `work_sessions` ledger. Until this exists, no confirmed labor should accrue value.
