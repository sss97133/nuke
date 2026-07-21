# presence axis

**Type:** measurement anti-pattern
**Supersedes:** any scoring axis defined as `<column> IS NOT NULL`
**Related:** `progressive-extraction` (status is derived, never set) · `numbers-carry-source-dna` · memory `feedback_valuation_block_when_not_defensible`

**An axis is meant to measure an ACHIEVEMENT. `X IS NOT NULL` measures EXISTENCE. Conflating the two scores borrowed, placeholder, and self-serving data as if the entity earned it.** The moment an axis's definition is mere presence, the fastest way to raise the score is to put *anything* in the column — which is exactly what noisy pipelines and hostile sources already do.

## The rule

> A scoring axis must be defined by what the content PROVES, and must net out rows whose presence is known to be borrowed, placeholder, or self-serving. If the only definition you can write is `col IS NOT NULL`, it is not yet an axis.

## Cases (measured 2026-07-20, project qkgaybvrernstplzjaam)

- **`ax_mark` = `organizations.logo_url IS NOT NULL`.** Scored **603** L'Officiel-concierge orgs as having an authenticated mark. But **344** of those wear a *borrowed* mark — an identical image binary shared across 3+ unrelated orgs (an agency favicon or platform default; 306 St Barth villas all wore Sibarth's "S"). Honest authenticated-mark count = **603 − 344 = 259**. The fix is not deletion (marks are owner-only to null) but the additive `metadata.mark_quarantine` flag written by `lofficiel-concierge/scripts/mirror_org_marks.mjs --quarantine` (reason `shared_binary` / below-pixel-floor), so the axis can be recomputed honestly. A white-on-transparent knockout is the same defect from the other side — it renders as nothing yet scores `ax_mark=true` (`scripts/concierge/repair-blank-marks.mjs`).
- **`ax_story` = "the org has an associated story."** Scores an org's OWN shutdown notice as vitality: Air Antilles' story is its cessation-of-service announcement. Presence of a story is not evidence the subject is alive.

## The executable guard

`scripts/entity/foundation-check.mjs` check `[7] axis.mark-presence-is-not-authentication` reports the presence count, the borrowed count, and the honest difference every run (`npm run foundation:check`). It does not silently pass — it prints the inflation with the defect and date. A NEW axis defined as `IS NOT NULL` must be added there, so it too cannot be scored silently. No axis in the checked set may be defined as mere presence.

## Why net-out, not delete

Presence is real testimony — the logo binary exists, the story exists. Deleting it destroys a fact (`agent-trust-invariants`). The correct move is a second, additive observation (`mark_quarantine`, a superseding row) that the honest metric subtracts. Existence is preserved; achievement is measured separately.

## See also

`progressive-extraction` (coverage = yield/fillable, never yield/total — the same "don't let the denominator lie" discipline) · `foundation-check` (the guard type) · memory `feedback_no_fabricated_or_mixed_data_in_design_surfaces`.
