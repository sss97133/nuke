# Worked example: three real photos, free-first (2026-11-23, read-only)

All values are real DB values unless marked *proposed* or *inferred*. Coordinates are rounded to 0.001°.

## A. `1a4a3b71-2a41-4a2b-8acd-b163dc6104b1`: 1966 Ford Mustang, exterior three-quarter
- **Origin:** `capture_relay_ios`, iPhone 15 Pro, 2026-11-03 01:09 PST, cell 35.973,-114.855. Filed to the 1966 Ford Mustang (the vehicle has a VIN on record).
- **Device tags stored:** machine, wheel, rim, tire, automobile, vehicle, car, structure, convertible, sportscar, wood_processed, outdoor. Phone verdict: is_vehicle = true, is_personal = false. No confidences, no has_person.
- **Free derivations:**

  | Fact | Rule | Confidence |
  |---|---|---|
  | photo_kind = vehicle | device gate | 0.8 |
  | session | 33 other photos within ±30 min in the same cell, all 33 filed to this Mustang | ~0.95, *proposed* |
  | place | the cell holds 4,103 of his photos across 55 vehicles: a shop/garage cohort, but no named place exists (0 rows) | *inferred* |
  | privacy | no person, not a document: show | |
  | VIN/plate | none on the photo. The paid read also found no VIN | |

- **Edges:** the vehicle; Ford, Mustang, 1966 Mustang (vehicle fold); 1 organization (via the vehicle); place cell; session (*proposed*); uploader as originator.
- **Paid pass:** ran gpt-4.1-mini, $0.0026, and answered make/model from the emblem. That was already known from the filing. Under the gate it would be asked only `vehicle_detail` (color, body style). Optional.

## B. `1284a017-414c-4d5b-bee5-e1516fb1d2b6`: same Mustang, engine bay, a person in frame
- **Origin:** same session, 2026-11-03 00:56 PST, same cell.
- **Device tags stored:**
  - `apple_ml_labels`: machine, engine_vehicle, vehicle, cord, material, dashboard, textile, **people**.
  - The phone verdict's list (`on_device_vision`) has no "people", and the person flag was never sent. The two lanes disagree.
- **Free derivations:**
  - photo_kind = vehicle (device gate, 0.8);
  - person_present (label `people`, 0.7, private);
  - session inheritance to the Mustang (33 of 33 neighbors);
  - privacy: a work photo with a person, shown to the owner and covered for others under the proposed rule.
- **Paid pass:** ran gpt-4.1-mini, $0.0028, and read "Edelbrock" and "1407". 1407 is *inferred* to be the Edelbrock carburetor part number. Device OCR (VNRecognizeTextRequest) would read the same text for free. A paid pass is needed only to name the part.

## C. `10554496-0932-4b29-b7bc-76aff4e1afff`: 1966 Chevrolet Chevelle, interior, a person in frame
- **Origin:** `capture_relay_ios`, 2026-11-03 19:17 PST, cell 35.973,-114.856 (7,647 photos, 56 vehicles there). 12 neighbors within ±30 min, all filed to this Chevelle. 3 organization links via the vehicle.
- **Device tags stored:** dashboard, seat, automobile, car, vehicle, textile, **people** (in `apple_ml_labels` only). Phone verdict: is_vehicle = true, is_personal = false.
- **Free derivations:**
  - photo_kind = vehicle;
  - person_present (private);
  - session to the Chevelle;
  - capture: an interior angle is *not* free. Apple's labels say "dashboard" and "seat", which is a reasonable *proposed* rule for an interior angle at 0.6.
- **Paid pass:** a subscription reader described the interior color and a floor shifter, then enqueued it for the deep pass. Those are real `vehicle_detail` questions. The free layer can't answer them.

## What this shows
For all three, the free reads plus time and place already answer: is it a car, which car, which session, which place, is a person in it. Paid vision added only detail (color, part names, interior features). The orchestrator spent the paid pass on "what is this", the question that was already answered.
