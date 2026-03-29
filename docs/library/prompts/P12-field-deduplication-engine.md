# P12: Powerplant Field Deduplication in Dossier

## Context
Read these before executing:
- `docs/library/technical/design-book/vehicle-profile-computation-surface.md` — "Do Not Show Aggregates Over Dirty Data"
- `nuke_frontend/src/pages/vehicle-profile/VehicleDossierPanel.tsx` — `FIELD_GROUPS` config, `FieldRow` component
- `nuke_frontend/src/pages/vehicle-profile/hooks/useFieldEvidence.ts` — field evidence query
- `docs/library/reference/dictionary/README.md` — "Field Evidence", "Provenance"
- `~/.claude/projects/-Users-skylar/memory/epistemology-of-truth.md` — "Claims → Consensus → Inspection → Scientific Test"

## Problem
Phase 3 grouped fields under semantic headings (Identity, Powerplant, Drivetrain, Appearance, Metrics). But within the POWERPLANT group, the same information appears in multiple rows:

```
POWERPLANT
  ENGINE TYPE    350ci SBC V8
  ENGINE SIZE    5.7L 350ci V8
  FUEL TYPE      Gasoline
  FUEL SYSTEM    Carburetor (Edelbrock 4bbl)
```

"350ci" appears in ENGINE TYPE and ENGINE SIZE. "V8" appears in both. "Carburetor" appears in FUEL SYSTEM but FUEL TYPE ("Gasoline") is implied by "Carburetor." This is not provenance-rich information — it's redundant noise that makes the panel feel like a data dump instead of a computed surface.

The computation surface principle says: the profile computes intelligence from raw data. Showing the same fact three ways is the opposite — it's showing raw data without computation.

## Scope
Client-side deduplication logic in VehicleDossierPanel. No new tables. No backend changes.

## Steps

1. After computing `visibleFields` for the POWERPLANT group, run a deduplication pass:

```typescript
function deduplicatePowerplant(fields: { field: string; value: string }[]): string[] {
  // Build a "seen tokens" set from the highest-priority field down
  const priority = ['engine_type', 'engine_size', 'fuel_system_type', 'fuel_type'];
  const seenTokens = new Set<string>();
  const hide = new Set<string>();

  for (const fieldName of priority) {
    const entry = fields.find(f => f.field === fieldName);
    if (!entry) continue;
    const tokens = entry.value.toLowerCase().split(/[\s,/()-]+/).filter(t => t.length > 1);

    // If ALL tokens in this field already appeared in a higher-priority field, hide it
    const newTokens = tokens.filter(t => !seenTokens.has(t));
    if (newTokens.length === 0 && tokens.length > 0) {
      hide.add(fieldName);
    }
    tokens.forEach(t => seenTokens.add(t));
  }

  return Array.from(hide);
}
```

2. Apply `deduplicatePowerplant` inside the POWERPLANT group rendering in `FIELD_GROUPS.map()`. Pass the computed `hide` set and skip any `FieldRow` whose field is in the set.

3. Rules for deduplication:
   - `engine_type` is the king. It stays. Contains the canonical powerplant description.
   - `engine_size` is hidden if all its meaningful tokens (displacement, configuration) already appear in `engine_type`. "5.7L 350ci V8" is fully contained in "350ci SBC V8" (350ci, V8 overlap).
   - `fuel_type` is hidden if `fuel_system_type` exists and is non-empty. "Gasoline" is implied by "Carburetor (Edelbrock 4bbl)".
   - `fuel_system_type` is hidden if `engine_type` contains the fuel system info (e.g., "350ci V8 / Edelbrock 4-bbl / HEI" already mentions Edelbrock).

4. The deduplication is cosmetic. Hidden fields still exist in the data. Expanding the provenance drawer on `engine_type` still shows all evidence sources including engine_size sources. The user can always see everything — the dedup just reduces visual noise in the summary view.

5. Add a tiny indicator when fields were collapsed: below the last visible POWERPLANT field, show "2 related fields collapsed" in 7px text, clickable to expand all.

## Verify
- K2500 profile — POWERPLANT section should show 2 rows (ENGINE TYPE + FUEL SYSTEM) instead of 4
- The "2 related fields collapsed" link appears
- Clicking it shows all 4 fields
- A vehicle with only `engine_size` and no `engine_type` should show `engine_size` (it's the highest-priority field that has data)
- A vehicle with no engine data at all: POWERPLANT header doesn't render (existing behavior)

## Anti-Patterns
- Do NOT merge field values. Do not concatenate `engine_type + fuel_system_type` into a single "POWERPLANT" row. Each field retains its identity and provenance.
- Do NOT apply deduplication to other groups. Identity, Drivetrain, Appearance, and Metrics fields don't have this overlap problem. Only POWERPLANT has redundant decomposed specs.
- Do NOT modify the underlying data. This is a view-layer optimization. The vehicles table still has all fields populated.
- Do NOT hide fields that have different provenance quality. If `engine_size` comes from VIN decode (high trust) and `engine_type` comes from AI extraction (lower trust), show both — the provenance difference is meaningful even if the surface values overlap.

## Library Contribution
After completing:
- Update `docs/library/technical/design-book/02-components.md` — add "Field Deduplication" subsection under Dossier Panel
- Update `docs/library/reference/dictionary/README.md` — add "Field Deduplication" definition (view-layer token overlap detection)
