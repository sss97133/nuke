---
change_type: substrate_correction
scope: avoid an impossible segment-binding lookup for non-segment checks
unknowns: []
---

The scheduled structural fold following the recorded-plan rule deployment hit
the unchanged statement timeout while persisting direct check-input edges. The
existing PostgreSQL phase log retained the failure and the prior evaluation;
no partial current result was published. The source/compute phases were also
slower on that cold attempt, so timeout location alone does not establish a
foreign-key or guard defect.

This bounded compute optimization changes one expression in the existing
`harness_model_compute(jsonb)` owner. A check with NULL segment_id cannot match
`s.x->>'id'=c.segment_id::text`; its existing scalar lookup always contributes
an empty binding object. Skip that impossible scan explicitly. The nonnull
lookup remains byte-for-byte the same, including its cardinality errors for
duplicate matching source keys. Predicate verdicts, exact field fingerprints,
array ordering, source visibility, row guards, foreign keys, counts, worker
controls and statement/lock timeouts retain their existing contracts.

Grounding: data-machine-cases.md section13.12 criteria7-8, canonical structural
evaluation migration20261125233922, direct field bindings20261126182000, and
recorded plan agreement20261126231500. K5_WIRING_STATE.md sections1-4 and canon
chapter16 continue to govern physical decisions; this change supplies no
device law, material specification, route, rating or manufacturing quantity.

Private native PG17 replay uses the exact current canonical input, not a
hand-authored replacement. Its complete output hash is unchanged. Versioned
regressions compare full results across current source and existing source
patch/scale cases, and preserve malformed-input error behavior. Native timings
are a local diagnostic; production acceptance still requires the normal
scheduled fold under unchanged limits. This receipt closes only the compute
expression change, not runtime throughput or the builder-facing product.
