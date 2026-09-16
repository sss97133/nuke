# Observation as Schrödinger (atoms latent until queried)

**Status:** Stub — reconciles a dangling citation. Captures the one idea the citing code relies on; not a full essay.
**Cited by:** `supabase/functions/_shared/cockpit/attribute-registry.ts` (~line 25), as `project_observation-as-schrodinger.md`, glossed inline: *"atoms latent until queried; registry is the materialization checklist."*
**Related:** `image-to-atom-taxonomy.md`, `cockpit-unified-interface.md`, encyclopedia ch. 5 (*Image as Butterfly Node*).

---

## The one idea

A captured artifact (an image, a document, a VIN) contains far more facts than have been *extracted* from it. Those un-extracted facts are **latent** — real and inherent in the artifact, but not yet recorded as atoms in the graph. They exist in superposition: the photo *does* show the rust on the rocker panel and the era-correct wheels and the shop lighting, but until something asks the question, none of that is a row anyone can query.

An atom **materializes** only when a caller runs the corresponding attribute's prompt and submits the answer through `submit_attribute_value`. The act of asking is the act of collapsing one latent fact into a recorded `projection_event` atom. Before the query, the fact is in the artifact but not in the graph; after, it is a citeable, weighted, auditable atom.

## Why this matters for the registry

This is the exact framing the citing comment names: **the registry is the materialization checklist.** The L1–L5 attribute registry is not a description of what Nuke *has already extracted* — it is the enumerated list of questions that *could* collapse latent facts out of an artifact. Each `AttributeDefinition` is a measurement waiting to be taken.

Two consequences the registry depends on:

1. **Thin substrate is not absence of fact — it is absence of *query*.** A photo with three atoms isn't a photo that only contains three facts; it's a photo whose other ~17 facts are still latent. This is why `find_subjects_needing_atoms` exists: it surfaces subjects with thin `projection_event` coverage so callers can collapse more of the latent superposition. Low coverage is *our* intake gap, never a verdict that the artifact is empty.

2. **Extraction is monotonic and re-runnable.** Because the artifact is archived ("fetch once, extract forever"), any latent fact can be materialized later by running its prompt — without re-capturing anything. The registry's job is to make the full set of collapsible questions explicit and ordered (per `layer-dependencies.md`), so the harness can hand a caller the next un-asked question for any subject.

## Scope of this stub

This file exists to resolve the dangling citation at `attribute-registry.ts:25` and to record the load-bearing idea (latent-until-queried; registry-as-materialization-checklist) so the contract is honest. If a fuller treatment is warranted, it should be developed as a contemplation in `docs/library/intellectual/contemplations/` and this stub updated to point at it — not duplicated here.
