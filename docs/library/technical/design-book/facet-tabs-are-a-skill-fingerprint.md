# Facet Tabs Are a Skill Fingerprint

**Doctrine** — user profile, timeline filter pills, and any future facet row.
Source: Skylar, 2026-06-10 ("the tab row is a skill fingerprint, not navigation").

## The rule

A tab (facet pill) renders **only when the user has data behind it**, and it renders **with its count**:

```
PHOTOS (20978)   WORK (292)   VEHICLES (14)   AUCTIONS (2)
```

A user who has never commented gets **no COMMENTS tab**. Not a greyed-out tab, not an
empty tab that opens "No comments yet" — no tab. The row is computed from the ALL-events
map (`filterCounts`, vehicle pattern: `BarcodeTimeline.tsx:285-291`), and a pill exists
iff `count > 0`.

## Why: tabs render what the user IS

The conventional reading of a tab row is navigation chrome: a fixed menu of places the
app can take you. That reading produces empty shells — five hardcoded pills regardless
of data, three of which dead-end. The design book already bans empty shells for widgets;
this page extends the ban to navigation itself.

The correct reading: **the facet row is the user's skill fingerprint.** It is the
compressed, glanceable answer to "what does this person actually do?" A profile with
`PHOTOS (20978) / WORK (292)` and no COMMENTS pill says: this is a builder who documents,
not a commenter. The absence of a tab is as much signal as its presence. Rendering an
empty facet would be lying about identity — the one thing a worth-proof profile must
never do.

This is the GitHub-contribution-graph move applied to navigation. GitHub's graph earned
its iconic status because it renders only what happened — green where commits exist,
blank where they don't, and the blank is honest. The profile is the same instrument
pointed at physical work: a contribution graph for the real world, where the profile is
**proof of worth to the assets the user touches** (Skylar, 2026-06-10). The tab row is
that graph's legend: each pill a proven competency, each count the receipt.

## The facet set is open

Facets are `kind` values on contribution events, not UI constructs. Today the kinds are
automotive: `image_upload`, `timeline_event`, `work`, `auction_activity`, `comment`.
Nothing in the rendering layer knows that list — it counts kinds and renders pills for
nonzero counts.

Consequence: when art, fashion, or content data lands, those practices appear as new
`kind` values — `artwork`, `garment`, `post` — and the tab row grows **with zero UI
rework**. An art-world user's fingerprint reads `ARTWORKS (340) / SHOWS (12)` from the
same component that renders a mechanic's `PHOTOS / WORK`. No per-vertical tab bars, no
feature flags, no redesign.

This is the seam where **asset-contribution mapping generalizes**: the platform's core
claim is that a person's worth is provable from their documented contributions to assets.
Vehicles are the first asset class, not the last. The facet row is the one UI surface
that must stay asset-class-agnostic so the claim scales.

## Implementation invariants

1. **Counts come from the ALL set, never the filtered set.** Filtering re-colors the
   timeline; it must not change which pills exist or their counts (no self-erasing tabs).
2. **Pill exists iff count > 0.** No disabled states, no placeholders.
3. **Label format:** `KIND (N)` — ALL-CAPS, `--fs-8` token, count in the same pill.
4. **New facets are data migrations, not UI changes.** Adding a kind = mapping its events
   into the contribution stream. If the tab row needed code to show a new kind, the seam
   is broken — fix the seam, not the symptom.
5. **An empty profile shows zero pills.** That is the honest state, and (GitHub-style)
   the empty graph is the invitation to build.

## Anti-patterns

- Hardcoded pill lists (the round-2 bug: 5 fixed pills, auctions/comments unmapped).
- "Coming soon" tabs for verticals with no ingested data.
- Per-vertical tab components (`ArtProfileTabs.tsx` must never exist).
- Counts computed from the filtered map (tabs that change as you click them).
