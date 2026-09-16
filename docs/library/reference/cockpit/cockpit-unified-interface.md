# The Cockpit Unified Interface

**Status:** Live contract (load-bearing)
**Cited by:** `supabase/functions/mcp-connector/index.ts`
- `submit_attribute_value` (~line 834) — "records the result in `projection_event` with full audit envelope per cockpit-unified-interface.md"
- `project_invoice` (~line 889) — "writes the result to `projection_event` with audit envelope per cockpit-unified-interface.md"
**Substrate:** the `projection_event` table (one row per recorded atom). Live: ~770 atoms as of 2026-06-17.

---

## The single interface

Everything Nuke knows about a subject is recorded the same way, through one shape, into one table. Whether the atom came from:

- a **walk-in caller** running its own model and submitting an answer (`submit_attribute_value`), or
- a **deterministic-SQL adapter** composing an artifact from existing atoms (`project_invoice`, `project_work_log`, `project_money_flow`), or
- an **owner confirmation** turning an inferred work-session into a fact (`confirm_work_session`),

…the result is **one `projection_event` row with the same audit envelope.** That uniformity is the "unified interface": the cockpit doesn't care who computed the atom or how — it cares that the atom arrives with full provenance and lands in the one place atoms live. This is the laser-tag model made concrete: *Nuke owns the harness and the landing zone; the caller owns the compute* (per `feedback_vision_is_caller_byok_laser_tag.md`).

The read side (`get_subject_atoms`, `project_attribute`, `vehicle_wiki`) reads the same table. **The same row that records a submission is the row that renders the product.** There is no separate "display" store — the projection *is* the rendering.

## The audit envelope (the contract)

This is the heart of the interface — the shape every `submit_attribute_value` writes, distilled from the live handler (`mcp-connector/index.ts:2599–2708`). A row in `projection_event` carries:

### Top-level columns
| Column | Source | Meaning |
|---|---|---|
| `request_envelope` | constructed | what was asked: `{audience, subject_id, subject_kind, attribute, as_of}` |
| `result_envelope` | constructed | the answer + full provenance (detailed below) |
| `result_kind` | **`def.result_kind` from the registry** | `substrate` or `projection` — stamped from the registry, *never* the caller's claim (see `observation-projection-boundary.md`) |
| `model_id` | `model_registry` lookup/insert | which model produced this |
| `model_caller` | `walkin:<token_hash>` | caller identity tag |
| `prompt_sha256` | `sha256(attribute:version:prompt)` | the exact prompt run, for survival-rate analytics |
| `observation_ids` | caller-supplied | substrate rows the caller cited as basis |
| `observed_at` | caller-declared or now | when the model produced the answer |
| `evidence_class` | validated against admissible set | `image \| vin_decode \| document \| owner_claim \| context_atoms` |
| `evidence_ref` | caller-supplied, required non-empty | the actual citation (`{image_ids}`, `{rule, vin}`, `{document_id}`, `{statement}`) |

### Inside `result_envelope`
```jsonc
{
  "label": <the answer value>,
  "confidence": <0..1>,
  "candidates": [<alternates considered>],
  "basis": {
    "signals": [<signals the caller fired on>],
    "agent_version": "walkin:<model_slug>:<version>",
    "applied_priors": ["walkin_caller", "model_slug:<slug>"]
  },
  "envelope": {
    "model_id": "...",
    "model_version": "...",
    "model_caller": { "kind": "walkin", "walkin_token_hash": "..." },
    "prompt_sha256": "sha256:...",
    "observed_at": "...",
    "submitted_at": "...",
    "signature": {
      "algorithm": "attestation-token",
      "value": "att:<token_hash>:<observed_at>",
      "signed_at": "<submitted_at>"
    }
  }
}
```

Every field exists so a future reader can answer **"who said this, from what evidence, with what prompt, how sure, and when?"** without leaving the row. A bare value with no envelope is a schema failure (`feedback_numbers_carry_source_dna`).

## The write path (`submit_attribute_value`)

The sequence, in order, from the live handler:

1. **Validate the attribute exists** — `getAttribute(attribute)`; reject unknown names. The subject_kind must match `def.subject_kind`.
2. **Validate the value's shape** — `validateSubmission(attribute, value)` against `expected_shape` / `enum_values`.
3. **Evidence-class gate (anti-laundering)** — `evidence={class, ref}` is **required**. `validateEvidenceClass(attribute, evidence.class)` rejects any class not admissible for the attribute. *A photo-cited horsepower claim dies here* (`"image"` ∉ `admissible(vehicle.horsepower)`). `evidence.ref` must be non-empty.
4. **Register the prompt** — upsert `prompt_template_registry` keyed by `prompt_sha256`, so prompt drift is observable and survival rates are computable per exact prompt version.
5. **Register the caller's model** — look up `model_registry` by `slug`; if new, auto-insert at `caller_kind='walkin', base_trust=0.30`. Reputation accumulates over time; the caller is never gated up-front.
6. **Build the envelope** — request + result envelopes as above, including an attestation-token signature derived from `sha256(model_slug:observed_at)`.
7. **Insert one `projection_event` row** with `result_kind` stamped from the registry.
8. **Return** `projection_event_id`, `recorded_at`, the caller's `base_trust`, and the resolved `result_kind`/`evidence_class`.

### Recordable, never gateable
The cockpit's discipline is the **substrate's, not the gate's** (`mcp-connector/index.ts:836`). A walk-in submission is *always recorded* — a bad model accumulates retraction history; a good model accrues trust. Truth is resolved downstream by weighted consensus (`project_attribute`, L4 dialectic synthesis), not by refusing the write. This is why the interface is a single recording surface rather than a validation wall: the gate would have to be omniscient; the ledger only has to be honest.

## The deterministic-SQL adapters share the envelope

`project_invoice` / `project_work_log` / `project_money_flow` are not vision callers — they compose an artifact deterministically from existing substrate atoms (work_orders + labor + parts + payments + receipts). But they write the **same** `projection_event` row with the **same** audit envelope (`mcp-connector/index.ts:889–890, 909, 927`). Consequences:

- The composed artifact (an invoice, a journal page, a money-flow) is itself an auditable, re-projectable atom — it re-projects when the underlying substrate changes, and the `projection_event` row is the durable record of what was composed and when.
- `audience` in the `request_envelope` selects the field set: `client` / `irs` / `internal` for invoices; `public` / `owner` / `counterparty` for work-logs. The *same atoms* are projected through different redaction lenses — there is no parallel per-audience store.

## Why "cockpit"

The cockpit is the **instrument panel over the substrate**: a fixed set of tools (the MCP connector surface — `get_attribute_checklist`, `submit_attribute_value`, `get_subject_atoms`, `project_attribute`, the `project_*` composers) through which every read and write of derived knowledge passes. The interface is *unified* because adding a new attribute, a new caller model, or a new composed artifact does not change the cockpit's shape — it adds a registry entry or a row, never a new pipe. One envelope, one table, one set of tools, for every atom the system records.
