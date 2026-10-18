---
paths:
  - "docs/wiring/**"
---

# Wire Closure Protocol

> **First run the PRE-FLIGHT GATE in `.claude/rules/wiring-receipt.md`** (read state §1-4 + canon chapters 16/17/18, `library_search` every spec, cite-or-mark-unknown, stop on owner decisions, "would Dave shred this?"). The canon chapters are the cited knowledge a closure draws on; this protocol is the cited per-wire output.

The unit of value for K5 wiring work is one wire closed end-to-end with citations. Not paragraphs, not summaries, not visualizations. One wire, fully specified or honestly gapped.

## The rule

**One wire per turn. Stop when it's done. Don't chain.**

If you find yourself thinking "let me do #109 too while I'm here" — stop. Save it for next turn. Chaining is how slop happens.

## Primary deliverable: JSON, not markdown

**The receipt is a JSON file validated against `docs/wiring/schemas/wire-closure.schema.json`.** Markdown is optional and only rendered from the JSON if a human-readable view is asked for.

Why JSON: the schema enforces the "cited OR explicitly unknown" rule structurally. `cited` is a oneOf — either `{value, source}` or `{unknown: true, needs: <action>}`. There's no third shape. Drift into "let me just write a paragraph" becomes a validation error, not a habit I have to fight.

## The 14 fields

The schema's top-level required keys (and their sub-keys) enumerate every field. The schema is the authoritative list — the bullets below are a human summary, not the spec. **Always read the schema before filling a receipt.**

A wire is closed when every field is **cited to a source** (file:line, doc + page, or measurement record) OR **explicitly marked** `{"unknown": true, "needs": "<specific action>"}`. No third option. No vibes. No "probably."

1. **Circuit ID** — from `K5_cut_list_v2.txt`
2. **ECU/PDM pin + function name** — pin from cut list, function name from `K5_connector_schedule.txt` AND `chapters/appendix-g-diagram-requirements-spec.md` (triangulate; they sometimes disagree)
3. **Signal type + expected wire count** — signal type from `chapters/05-build-manifest.md`. Wire count rule from same chapter (e.g. `analog_5v` = 3, `analog_temp` = 2, `low_side_drive` = 2, `logic_coil_drive` = 4)
4. **Gauge** — from cut list
5. **Wire spec** — M22759/32 (12-20 AWG), M22759/16 (22 AWG and 4-10 AWG; 22 moved to /16 on 2026-09-26, canon ch.16 §1.5), or M27500-series (shielded/twisted-pair)
6. **Color** — from cut list (post-Tefzel amendment; check 3-color stripe remap if applicable per `K5_wire_spec_and_costs.md` §"Three-Color Stripe Problem")
7. **Shielding** — yes/no, per `chapters/05-build-manifest.md` (crank, cam, knock = shielded)
8. **Fuse rating** — N/A for sensors; PDM channel ampacity or inline fuse per `K5_pdm30_channel_plan.md`
9. **Routing landmark path** — from `K5_wire_paths.yaml` (list of L## landmarks)
10. **Total length** — measured if `K5_landmarks.yaml` has values; otherwise mark explicitly as "estimate from `harnessConstants.ts` zone distance, +15% body / +20% engine pad"
11. **Device PN at non-ECU end** — from `K5_shopping_list.md` or `K5_connector_shopping_list.txt`
12. **Physical mount location of device** — cited to LS3 service manual page, K5 service manual page, or measurement record. "Front of engine" or "on the firewall" is not citable — needs specifics.
13. **Terminal PN both ends** — MoTeC datasheet for ECU side; vendor doc for sensor side. If using a pigtail (e.g. WPCTS30), note whether it pre-terminates both pins.
14. **Companion wires per signal type** — for `analog_temp` (2 wires) the ground return wire ID and its target SEN_0V pin. For `analog_5v` (3 wires) the 5V ref + ground IDs. For shielded the drain wire. If a companion wire is missing from the cut list, flag it.

## Source files to grep (in this order)

Open the cut list, find the row, then triangulate against every doc below:

```
K5_cut_list_v2.txt                          # canonical row
K5_connector_schedule.txt                   # pin function (often stale — flag mismatches)
K5_pdm30_channel_plan.md                    # PDM channel + ampacity
K5_wire_paths.yaml                          # landmark path
K5_landmarks.yaml                           # measured distances (often null)
K5_harness_build_sheets.md, _v2.md          # bundle assignment
K5_wire_labels.md                           # label text + general location
K5_shopping_list.md                         # device + pigtail PNs
K5_connector_shopping_list.txt              # terminal PNs by pin
K5_cross_reference_check.md                 # known inconsistencies
K5_wire_spec_and_costs.md                   # Tefzel spec, color remap
docs/wiring/chapters/appendix-g-*           # M130/PDM30 authoritative pin maps
docs/wiring/chapters/appendix-d-k5-build.md # this build's overall config
docs/wiring/chapters/05-build-manifest.md   # signal type → wire count rule
docs/wiring/chapters/06-compute-engine.md   # derivation rules (gauge from amperage, etc.)
reference_documents/component_drawings/motec_m1_hardware_techspec.pdf   # MoTeC pin function ground truth
```

If two sources disagree (e.g. cut list says B04 = CLT, connector schedule says B04 = UNUSED), **the cut list and shopping list are more current**; the connector schedule and cross-reference check are typically stale. Always flag the disagreement as a substrate inconsistency.

## Surface substrate inconsistencies — don't fix them inline

If you find that doc A and doc B disagree, write the disagreement into the receipt's "Open unknowns" section. **Do not silently update doc A or doc B inside this wire's closure.** Substrate corrections are separate receipts (`change_type: substrate_correction`) so the audit trail stays clean.

## Receipt format

**Primary:** `docs/wiring/receipts/YYYY-MM-DD_wire-NNN-<slug>-closure.json` validating against `../schemas/wire-closure.schema.json`. `NNN` is the cut-list wire ID, `<slug>` is the device label (e.g. `wire-110-clt-closure.json`).

The JSON must include `"$schema": "../schemas/wire-closure.schema.json"` as the first key so editors can lint it live.

**Optional (human render):** `docs/wiring/receipts/YYYY-MM-DD_wire-NNN-<slug>-closure.md` — only generate if explicitly asked. Derive it from the JSON, do not author it independently.

Reference examples:
- `docs/wiring/receipts/2026-05-13_wire-110-clt-closure.json` — the canonical format
- `docs/wiring/receipts/2026-05-13_wire-110-clt-closure.md` — the human render (pre-schema; future renders should derive from JSON)

## Validation

Before considering a receipt done, validate:

```bash
python3 -c "
import json, sys, jsonschema
schema = json.load(open('docs/wiring/schemas/wire-closure.schema.json'))
data = json.load(open(sys.argv[1]))
jsonschema.validate(data, schema)
print('VALID')
" docs/wiring/receipts/YYYY-MM-DD_wire-NNN-<slug>-closure.json
```

If `jsonschema` isn't installed: `pip install jsonschema` (or `pip3 install --user jsonschema`).

If validation fails, fix the receipt. Do not ship invalid JSON.

## Closure status definitions

Set `closure.status` in the JSON:

- **COMPLETE** — every field has a `value` + `source` or a justified `not_applicable`. Zero `{unknown: true}` objects in the receipt.
- **PARTIAL** — most fields cited, some gapped. The default state for a wire on first pass. Every gap appears in `open_unknowns` with a specific `needs`.
- **BLOCKED** — cannot proceed without a prior dependency (e.g. an architectural decision Skylar hasn't made). State the dependency in `open_unknowns` with `blocks: ["this_wire"]`.

## After the receipt

Update `K5_WIRING_STATE.md` if (and only if):
- A new general substrate inconsistency was surfaced (not just a per-wire gap)
- A locked decision changed
- The closure ratio shifted the overall completion estimate

Don't update the state file just to log that a wire receipt exists.

## What you do NOT do

- Generate a second wire's receipt in the same turn
- Author the markdown receipt before/instead of the JSON (markdown is render-only)
- Speculate on terminal PNs without reading the MoTeC datasheet
- Pick the device's physical mount location from training data ("typically on the driver-side head" is not a citation — the LS3 service manual page is)
- Fix substrate inconsistencies inline. Surface them in `substrate_inconsistencies` and file a separate `substrate_correction` receipt.
- Add `{"unknown": true}` without a `needs` field — the schema will reject it, but more importantly: an unknown without a close path is a hand-wave.
- Invent fields not in the schema. `additionalProperties: false` blocks this at validation time.
- Mark a wire COMPLETE while `open_unknowns` is non-empty. The status must match reality.

## The KPI

The build's completion is **(cited fields) / (123 wires × 14 fields = 1,722 cells)**. Wire count is a vanity metric. Field count is the real one.

Aggregate across all closure receipts with a one-liner:

```bash
python3 -c "
import json, glob
total_cited = total_fields = 0
for path in sorted(glob.glob('docs/wiring/receipts/*-closure.json')):
    d = json.load(open(path))
    total_cited += d['closure']['fields_cited']
    total_fields += d['closure']['total_fields']
target_total = 123 * 14
print(f'Closed: {total_cited}/{total_fields} cells across receipts = {100*total_cited/max(1,total_fields):.1f}%')
print(f'Build target: {total_cited}/{target_total} ({100*total_cited/target_total:.1f}% of all 123 wires × 14 fields)')
"
```

Target: 95% cited = 1,636 cells. First wire (#110) established 6/14 baseline. Each new receipt automatically rolls into the metric.
