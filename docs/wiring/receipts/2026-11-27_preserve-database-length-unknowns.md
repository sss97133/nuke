# Preserve unknown circuit lengths

Change type: reader correction. The circuit record owns its planned length and basis. A complete, dated browser route model previously supplied a substitute when PostgreSQL held no planned length. This made the sidebar, wiring schedule and Excel workbook disagree with the database for primary circuits including `ODY_NEG` and `ISO_OUT`.

Remove that fallback from the shared length reader and use the same database value for the selection card, connector wire list, schedule and workbook. A missing or non-finite recorded value stays blank; a recorded finite value, including an explicit zero, is preserved with its recorded basis. The route model remains available for spatial inspection.

Data path: `vehicle_wiring_overlays.id` → `vehicle_custom_circuits.overlay_id`; `planned_length_ft`, `planned_length_kind`, `planned_length_basis` and `measured_length_ft` are read by `useWiringMap`, then rendered/exported through the shared schedule reader. These circuit planning claims do not establish a physical segment's cut length or construction release.

Verification: the new schedule/workbook regression fails against the old fallback and passes after removal; all 22 focused schematic/worksheet checks, including the shared trade-gauge export case, and the enforced repository gate pass. A fresh anonymous browser reconciled the selected connector row, selected wire card and downloaded workbook against three actual database records: both unknown primary lengths stay blank, while a recorded planned value is preserved. There were no page errors. No source record or length is written by this change. Normal checked release and live verification remain required. Full order-to-assembly acceptance remains open.
