# Deep reading scope: owner's filed photos

Mechanism for `20261123220000_deep_reading_scope_owner_filed.sql`. This is a
scope switch, not a new reader.

The deep-reading and keyed-values stages already share one ledger
(`enqueue_image_stage_work`, `claim_image_stage_work`, the subscription
classifier in `scripts/photo-pipeline`). In-scope is decided by
`image_stage_scope_ok` against `platform_config` key
`image_stage_deep_reading`.

Until this change, that row listed only the 1966 Mustang
`67127bcb-1f2b-4472-ae4f-a2b86825027b` in `vehicle_ids`, with `max_open` 1
(migration `20261121071700`). The function already treats a missing
`vehicle_ids` key as every vehicle of the listed owners, minus
`exclude_vehicle_ids`. This change drops `vehicle_ids` and sets
`max_open` to 5 so the existing stage room can hold a small batch. The
`deep_reading` `backfill_daily_cap` stays 150.

The subscription path is unchanged: `subscription-frame-classifier.mjs` on
the owner's Claude Code login (`ANTHROPIC_API_KEY` refused), with
`--deep-limit` and `--keyed-limit`. No paid API key is added.

The migration does not enqueue work. After it is applied, the existing
reconciler offers the next in-scope gaps up to the daily cap and the stage
room. Privacy holds (empty `image_url`), sensitive, `rejected_personal`,
documents, unfiled photos, `9cf5b7a4`, and the two excluded vehicles stay
out through the existing eligibility rules.

Revert is `20261123220001_deep_reading_scope_owner_filed_revert.sql`. It
puts the first-car row back. It does not delete readings or receipts already
written.
