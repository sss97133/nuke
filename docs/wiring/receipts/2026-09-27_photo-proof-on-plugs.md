# Receipt — Proof from the vehicle's own photos, on the plug cards

- **Date:** 2026-09-27
- **Change type:** data (10 observations through `ingest-observation`, 2 work-status flags) + frontend (MAP plug card and rollups)
- **Ask (owner, 2026-09-27):** "i likely submitted images of the engine that if processed youd see the parts and
  confirm their existence thats the value of having all data in the vehicle profile ... all images if properly
  observed will help indicate data depth". And from 2026-09-26: "at the end of the day you either have proof a part was
  lined up, bought, installed or you dont".

## What the profile held

- **Photos:** 3,716 photo rows on the K5, 1,486 after duplicates. All carry a deep-analysis verdict with
  `components_seen`, but that pass was never asked about the wiring devices. A keyword match of verdicts to the map's
  plugs found the throttle body, alternator, water pump, M130 and coils. It found nothing for crank, cam, knock, MAP,
  IAT, coolant or oil sensors, injector connectors, wideband, Dakota or starter.
- **Receipts:** 397 receipt observations. 378 have no line items read, and none names a wiring device.
- **Photos looked at by eye:** 10.
  - The "61-pin bulkhead" hit (`ac21f5a2…`, 2024-08-27) is a different vehicle: a white modern cowl with Amphenol
    MB5049 backshells and Raychem DR-25 boots. It is a reference shot on this profile, not proof. Not written.
  - The other 6 used below show this truck's parts or paperwork.

## Rows written (vehicle_observations, kind `specification`, domain `wiring`, property `device proof`)

Source `photo_pipeline`; `source_url` = the photo. `structured_data.plugs` lists the plugs covered and
`proof_level` the level. The method field says the photo was read by eye in session and the owner has not confirmed it.
The writer scored every row 0.90 ("high") from the source prior.

| Photo (vehicle_images) | Level | Plugs | What it shows |
|---|---|---|---|
| `b2f99f6a-fe06-4970-836d-51dc228954e9` | bought (2024-08-26) | TB | eBay order screen: purchased Aug 26 2024, throttle body 12699160, Schram Auto Parts, $99.00 |
| `772c8fff-923e-44aa-9d7c-8a3da6f98820` | on the truck | TB | electronic throttle body on the Holley intake, 2026-02-01; PN not readable |
| `772c8fff-923e-44aa-9d7c-8a3da6f98820` | on the truck | INJ-1…8 | Holley fuel rails on the intake; injectors under them not visible |
| `71a33780-0884-4df5-bbbd-582b1165d084` | on hand | INJ-1…8 | injectors on the bench, 2024-09-30 |
| `71a33780-0884-4df5-bbbd-582b1165d084` | on hand | COIL-1…8 | LS coils in two styles plus relocation brackets, 2024-09-30 |
| `95eafee3-72c4-4637-b9b0-65aeeae70fbc` | not on the truck yet | COIL-1…8 | valve covers bare on 2026-02-01 |
| `65777b50-7a51-4731-922e-83137a7d51b0` | on hand | M130-A, M130-B | MoTeC M130 in hand, 2024-08-28 |
| `95eafee3-72c4-4637-b9b0-65aeeae70fbc` | on the truck | ALTERNATOR-SENSE, ALT_FIELD | alternator on the Holley front drive, 2026-02-01 |
| `95eafee3-72c4-4637-b9b0-65aeeae70fbc` | question | WATER-PUMP | looks belt-driven on the engine; map lists an electric pump (#25) |
| `dd76538d-b8e4-4631-8807-02b56339d2b8` | question | PDM30_OUT_ACClutch, FAN | owner whiteboard 2024-08-28: trinary switch into the PDM; not on the map |

Work status set to `needs_owner` (assignee `owner`) on `WATER-PUMP` and `PDM30_OUT_ACClutch`. These are the two
questions the photos raised.

## Frontend

- `useWiringFacts.ts`: carries `proof_level`, photo URL/date and event date. A fact is indexed under every plug in
  `structured_data.plugs`.
- `map/WiringMap.tsx`:
  - Plug card gets "ON FILE FOR THIS PART". Each row: thumbnail (opens the full photo), level, dates, what the photo
    shows, and that the owner has not confirmed it. A plug with nothing on file says so.
  - Section rollups add "n/N WITH PROOF ON FILE".

## Verification

- `useWiringFacts` as a logged-out visitor reads 10 rows.
- Local dev server against the production database, logged out:
  - TB card: BOUGHT 2024-08-26 · PHOTO 2025-10-16, then ON THE TRUCK · PHOTO 2026-02-01.
  - M130-A card: ON HAND · PHOTO 2024-08-28.
  - WATER-PUMP card: NEEDS YOU, with the question.
  - Truck rollup: ENGINE 21/47 with proof on file, 1 needs you; POWERTRAIN / CHASSIS 1 needs you; all other
    sections 0.
- `tsc`: 0 errors. `eslint` on the changed files: 0 errors.

## Open

- The engine-bay photos need the map's own questions (which sensor, which connector, on the truck or not). That is
  the per-plug checklist for the photo pass, and it is not run yet.
- 378 receipts need their line items read before any of them can prove "bought".
- The Amphenol reference photo is filed on this vehicle but shows another one; reattribution is the owner's call.
