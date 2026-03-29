# P15: Dossier Panel — Provenance Depth Indicators

## Context
Read these before executing:
- `docs/library/technical/design-book/vehicle-profile-computation-surface.md` — "Progressive Density"
- `~/.claude/projects/-Users-skylar/memory/epistemology-of-truth.md` — 4 layers of certainty (Claims → Consensus → Inspection → Scientific Test)
- `nuke_frontend/src/pages/vehicle-profile/VehicleDossierPanel.tsx` — FIELD_GROUPS, FieldRow, FieldProvenanceDrawer
- `nuke_frontend/src/pages/vehicle-profile/hooks/useFieldEvidence.ts` — field_evidence query
- `docs/library/reference/dictionary/README.md` — "Field Evidence", "Trust Score"

## Problem
The Dossier Panel shows source badges (VIN, BaT, AI, USER, ENRICH) and a provenance coverage bar. But it doesn't communicate the epistemological DEPTH of each field. A field verified by VIN decode (scientific test) and cross-confirmed by BaT listing (consensus) is qualitatively different from a field extracted by AI from one listing (claim).

The epistemology framework defines 4 layers:
1. **Claim** — single source, unverified (AI extraction, user input)
2. **Consensus** — 2+ independent sources agree (BaT + VIN, or BaT + user)
3. **Inspection** — physically verified (photo evidence, VIN plate photo matched to decode)
4. **Scientific Test** — measured (dyno results, compression test, paint thickness)

The panel today treats all fields the same. A VIN-decoded engine_type and an AI-extracted engine_type look identical unless you expand the provenance drawer. The computation surface should make truth depth visible at a glance.

## Scope
Visual enhancement to FieldRow in VehicleDossierPanel. No new tables. No new queries. Uses existing `field_evidence` data.

## Steps

1. In `FieldRow`, compute the epistemological layer for each field from its evidence sources:

```typescript
function computeEpistemologicalLayer(group: FieldEvidenceGroup | undefined): 'claim' | 'consensus' | 'inspection' | 'bedrock' {
  if (!group || group.sources.length === 0) return 'claim';

  const sourceTypes = group.sources.map(s => s.source_type.toLowerCase());

  // Scientific test: has physical measurement source
  if (sourceTypes.some(s => s.includes('dyno') || s.includes('measurement') || s.includes('inspection_report'))) {
    return 'bedrock';
  }

  // Inspection: has photo-verified evidence
  if (sourceTypes.some(s => s.includes('photo_verified') || s.includes('vin_plate_photo'))) {
    return 'inspection';
  }

  // Consensus: 2+ independent source TYPES agree on the value
  const distinctSourceTypes = new Set(sourceTypes.map(s => {
    if (s.includes('vin') || s.includes('nhtsa')) return 'vin';
    if (s.includes('bat')) return 'bat';
    if (s.includes('ai') || s.includes('vision')) return 'ai';
    if (s.includes('user')) return 'user';
    if (s.includes('enrich')) return 'enrich';
    return s;
  }));

  // Check that distinct source types agree on value
  if (distinctSourceTypes.size >= 2) {
    const values = group.sources.map(s => (s.field_value || '').toLowerCase().trim());
    const primaryVal = values[0];
    const agreeing = values.filter(v => v === primaryVal || v.includes(primaryVal) || primaryVal.includes(v));
    if (agreeing.length >= 2) return 'consensus';
  }

  return 'claim';
}
```

2. Render the layer as a subtle left-border color on each FieldRow:

| Layer | Color | Meaning |
|-------|-------|---------|
| claim | transparent (no border) | Single source, unverified |
| consensus | `var(--info, #3b82f6)` | Multiple sources agree |
| inspection | `var(--success, #10b981)` | Physically verified |
| bedrock | `var(--vp-brg, #006747)` | Scientifically measured |

```typescript
<div style={{
  borderLeft: layer !== 'claim' ? `3px solid ${LAYER_COLORS[layer]}` : 'none',
  paddingLeft: layer !== 'claim' ? '7px' : '10px',
}}>
```

3. Update the PROVENANCE COVERAGE summary at the bottom of the panel. Replace the simple "X/16 FIELDS WITH PROVENANCE" with a layer distribution:

```
PROVENANCE COVERAGE
████████████████████████████████░░░░░░░░  75%
2 CONSENSUS · 8 CLAIMS · 6 EMPTY
```

Show the distribution as a micro bar: consensus segments in blue, claims in gray, empty in dark.

4. Add a tooltip on hover of the left border: "Consensus: VIN decode + BaT listing agree" or "Claim: AI extraction from listing description" — one sentence explaining why this field has this trust level.

## Verify
- K2500 profile — fields with VIN decode + BaT data show blue left border (consensus)
- Fields with only AI extraction show no left border (claim)
- The provenance coverage section shows layer distribution
- Hover over a consensus border → tooltip shows which sources agree
- Vehicle with no field_evidence → no borders, summary shows "0 CONSENSUS · 0 CLAIMS"
- Performance: no additional queries — computed from existing `field_evidence` data

## Anti-Patterns
- Do NOT create a separate trust score system. Use the epistemological layers from the memory doc. They're simpler, more honest, and map directly to the existing source types.
- Do NOT show numeric confidence scores to users. "0.85 confidence" means nothing. "VIN + BaT agree" means everything.
- Do NOT color the field VALUE text. The left border is sufficient. Colored text implies the value itself is suspect — the color should indicate the depth of verification, not doubt.
- Do NOT add "Unverified" warnings. Most fields on most vehicles will be claims. That's the honest baseline. Only highlight fields that have risen ABOVE claims.
- Do NOT run new queries. The `field_evidence` hook already has all the data. This is pure render-side computation.

## Library Contribution
After completing:
- Update `docs/library/reference/dictionary/README.md` — add definitions for "Epistemological Layer", "Consensus (field verification)", "Claim (field source)"
- Update `docs/library/technical/design-book/02-components.md` — add "Provenance Depth Indicators" subsection with visual spec
- Update `docs/library/intellectual/papers/applied-ontology-vehicle-domain.md` — add "Implementation: Epistemological Depth in UI" subsection linking theory to practice
