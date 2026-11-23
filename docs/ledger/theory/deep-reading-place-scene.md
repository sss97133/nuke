# Automatic reader: a place-named scene is the vehicle region

Mechanism for the thin agreement step in `scripts/photo-pipeline/deep-stage.mjs`
(`sceneForAutomatic`, `PLACE_SCENES`). No schema or data change.

The reviewed grammar allows `paint_booth`, `shop_context`,
`fabrication_in_progress`, `road_test` and `off_property` as `scene_type`.
Those words name the room, not the part of the vehicle in the frame. The
automatic reader may only post the admitted vehicle regions
(`body_exterior`, `body_interior`, `engine_bay`, `undercarriage`,
`wheel_assembly`). When both passes agreed on `paint_booth`, the merge
posted `scene_type=unknown`, and a reading that cannot name its scene
asserts no state, so agreed rust and paint were also posted as unknown.

Measured 2026-11-23 on 20 recent shop photos: seven Chevelle body
exteriors in a paint booth were answered `paint_booth` by both passes
(with agreed `aged` paint, and `surface` rust on three rear quarters
the sentences had already described). All seven posted as unknown on
every closed field.

The merge now treats a place token as `body_exterior` when that value is
admitted, and the state standard tells the model to name the vehicle
region, not the room. A VIN plate (`data_plate`), a document or a
printed picture is unchanged. The receipt still keeps the raw tokens
each pass used.

On the same 20 photos after the change, looked at against the frames:
known scene 10→17, rust 1→4, paint 4→11. The seven booth exteriors
posted `body_exterior` and `aged`; the three rear quarters with visible
surface rust posted `surface`. VIN close-ups and interiors stayed
unknown for rust and paint. No previously posted known value flipped.
