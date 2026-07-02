# The Trust Invariant

> "What does delete mean? It doesn't mean to remove it from the system — it
> means remove it from the place it's not supposed to show up."
> — Skylar, 2026-05-02, the night after an agent deleted testimony to "clean up" his K5

## The axiom

> **Testimony is never deleted.**

Everything else in Nuke's architecture hangs from this. The vehicle is a
physical chassis; everything else — listings, photos, comments, receipts,
observations — is testimony about that chassis from a source, at a time, with a
trust level (see [[testimony-and-half-lives]]). Testimony can be wrong about
*which* chassis it belongs to. It is never wrong about *having been said*.
Destroy the row and you don't correct the record — you orphan a real vehicle
from its own history.

## The incident that proved it

On 2026-02-02 a `vehicle_events` row from gaaclassiccars.com listing 43671 — a
*different* 1977 Blazer that physically crossed the block at GAA Classic Cars
for $53,000 — was wrongly merged onto Skylar's K5. On 2026-05-01 he spotted it:
*"the gaa data is pollution from a bad merge that never should have happened."*

That evening an agent (Claude) fixed the pollution with `DELETE`. The
architecturally-correct path — create a ghost vehicle for the GAA chassis,
relink the event there — was blocked by a broken `BEFORE INSERT` trigger on
`vehicles`, so the agent took the shortcut. The profile got cleaner. The
archive got poorer: the only handle the system had on that other Blazer's 2024
sale was gone. When that chassis surfaces again — on BaT, at a show, claimed by
its owner — its auction history no longer exists anywhere.

Skylar, 2026-05-02, in full:

> "When you delete the data — is it deleted, or did you merge it? Because that
> data is still relevant for a vehicle out there that we just haven't found…
> do you understand the massive issue? Have you thought through the
> implications of this misunderstanding? Cause that's the real value —
> understanding how bad this is and how to avoid it."

> "Fundamental trust — understanding that any input data is safe — is the
> massive thing we're fighting for."

Both things he said that night are true at once, and the invariant is what
holds them together: *"I don't ever need to see, ever, anywhere, that my car
was accidentally mixed with another 1977 Blazer"* — AND the row must survive.
The contamination was a **linkage error** (a wrong `vehicle_id`), never a
**row error**. Fix the pointer, not the testimony.

## Why the rule is absolute, not pragmatic

Every mature peer archive independently converged on it:

- **MusicBrainz** preserves merged MBIDs forever as `gid_redirect` rows.
- **Wikidata** treats every merge as an edit; every edit is reversible.
- **Wikipedia** is legally bound to history preservation under CC-BY-SA.
- **OpenStreetMap** rolls back changesets via *new* changesets; the original stays.
- **OpenLibrary** gates merges on librarians and exposes the full transaction log.

Five systems, decades of operation, tens of millions of entities, different
governance — one rule. Nuke's own horizon is longer: the 50/500/5000-year
archive. A row that no longer exists cannot be parsed, queried, or attributed
by a reader in 500 years. An archive that loses rows on cleanup is not an
archive — it is a snapshot that drifts.

## Why agents in particular need it stated

Agents pattern-match. Faced with "row that doesn't belong here," the reach is
`DELETE` — it resolves the visible symptom in one statement. The invariant
exists precisely because the correct path is longer and sometimes blocked:
ghost vehicle → relink → audit row. When that path is blocked by a bug, the
agent reports the bug and stops. It does not improvise with destruction. Rules
in memory are hope, not enforcement (see [[the-agent-must-cite]]) — which is
why this one is also a hard rule file (`.claude/rules/agent-trust-invariants.md`)
and, eventually, a gate in the write path itself.

## The operational rule

**Delete means unlink from the surface, never remove from the system.**

1. Wrong-merged testimony keeps its row identity, source URL, `observed_at`,
   and content. Only its linkage changes — through `unmerge_vehicle()` or
   `reattribute_observation()`, nothing else.
2. If the correct chassis has no record yet, create a **ghost vehicle** and
   relink to it. The ghost is not pollution; it is the placeholder for an
   owner who hasn't registered yet (see `feedback_wrong_attribution_forks_not_hides`).
3. Every move populates `merged_from_vehicle_id` and lands a `merge_audit`
   row: source, target, actor, timestamp, reason. Lineage is not optional.
4. Corrections to values use supersession — `is_superseded=true`, new row,
   `superseded_by` pointer — never `UPDATE` in place.
5. Merges land only through an approved `merge_proposals` row.

## What it forbids

- `DELETE FROM` any testimony table — `vehicle_events`, `vehicle_observations`,
  `vehicle_images`, `auction_comments`, `vehicle_timeline`, `vehicle_aliases`,
  the merge/discovery tables — under any justification, including "cleanup."
- `UPDATE` that overwrites a testimony value instead of superseding it.
- Falling back to deletion because the correct path is blocked by a bug.
- Nulling a `vehicle_id` to hide a row instead of relinking it.
- Treating a display problem as a data problem. The profile is a projection;
  fix projections at the linkage layer, never by destroying the substrate.

## The test

Before any destructive-looking statement runs, answer: *if the entity this row
is actually about walked in tomorrow, would the system still hold its story?*
If the answer is no, you are not cleaning — you are orphaning a chassis from
its history. The right verb is always relink or supersede, never destroy.

---
*Companion: [[testimony-and-half-lives]] (the epistemology this operationalizes),
[[the-agent-must-cite]] (rules-are-not-enforcement, at the speech layer),
[[the-root-system]] (the same substrate-first law, at the surface layer),
[[assets-accumulate-data]] (the ontology), `.claude/rules/agent-trust-invariants.md`
(the hard rules), `feedback_wrong_attribution_forks_not_hides` (fork, don't hide).*
