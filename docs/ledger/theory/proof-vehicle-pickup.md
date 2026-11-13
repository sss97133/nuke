# Proof vehicle pickup: one page for every lane

Owner, 2026-11-13: "i need all my agents working on the firebird and adjacent code to start
collaborating". This is the shared pickup for the proof vehicle (`20d21fb0-4651-4469-a0ba-e751309a1e54`,
named in `data-machine.md`) and the code around it. Read it before you write to that vehicle or change a
reader, writer or gate it passes through. It holds what is true for every lane; the detail and the
measurements are in C17 of [`data-machine-cases.md`](data-machine-cases.md).

It is a dated record, not live state. Every count below carries its read time. Before you act on one,
run the reader it came from.

## What done means

Two readers, both service role, both read-only. Nobody says the vehicle is done; these say it.

```sql
select public.visual_work_gate_report('20d21fb0-4651-4469-a0ba-e751309a1e54');  -- work records
select public.image_stage_coverage('20d21fb0-4651-4469-a0ba-e751309a1e54');     -- photo readings
```

- Work records are done when `failing` is 0. Read 2026-11-12 23:03 UTC: 31 current records, 2 passing, 29
  failing (18 system key, 26 part key, 25 cited claims, 26 numbers). Newest record 2026-11-11 16:43 UTC.
- Photo readings are measured by `model_gain`: keyed, folded, connected, proven. Same read: 467 photos, 1,004
  witnessed observations, 468 keyed, 196 folded claims, 77 carried by two or more rows, 0 cited by a work
  record, 0 proven. Proven is zero by construction until a store records agreement, a receipt's support or
  the owner's decision.

Report these two before and after any change you make to the vehicle, with the read time.

## What the database refuses, and the legal move for each

One insert trigger on `vehicle_observations`, `guard_visual_work_keys_insert`, for `visual_work_v1` records.
Stored rows are not re-checked; a rewrite is.

| Refusal | Legal moves |
|---|---|
| `unregistered_system_key` | a `subject_taxonomy.category` in use, or declare it in `key_proposals` (kind `system`, key, nearest existing or `none`, reason) |
| `unregistered_part_key` | every cost line carries `part_key`: a `subject_taxonomy.subject_key` in use, `not_a_part`, `cannot_tell`, or a declared draft (kind `part`) |
| `uncited_keyed_claim` | a cited photo that has keyed claims lists at least one of them in `keyed_claim_ids` |
| `unsourced_number` | a price cites `pricing.catalog_part_id` or `pricing.source_snapshot_id`; hours cite a `labor_operation` or `stage_row`; the rate is `resolved_default`; otherwise the line is unpriced and says so |

The message of each refusal names these moves. If a refusal has no legal move for your case, that is a
defect in the gate: say so here and in C17, do not route around it.

## The lanes seen on this vehicle

Named by what the database and the pull requests show, 2026-11-11 to 2026-11-13. If your lane is missing
or wrong, correct this table in your next pull request.

| Lane | Evidence | What the others need from it |
|---|---|---|
| Work records and cost ledger | `visual_work_v1` records; #3348, #3355, #3415, #3420 to #3423 | rewrite the 29 failing records through the gate; cite keyed claims, so the photos connect |
| Component evidence | proposals by `codex-component-evidence`; #3363, #3364, #3462 | the part's place on an observation (`component_subject_id`), so the gate and the cost lines can use it |
| Drivetrain and body-tag decode | methods `cowl_tag_decode_v1`, `engine_block_decode_v1`, `trans_id_stamp_decode_v1`, `physical_transcription_v1`; #3401, #3428, #3456 | keyed readings on the 20 properties approved 2026-11-12 16:21 UTC; the rest of its rows keyed or waiting on a filed proposal |
| Photo keys | method `photo_map_harvest_v1`, 446 rows landed 2026-11-11 | the keyed claims the work records must cite; the decisions memory, which has no store but a file |
| Receipts and catalog | `receipt_work_lines`; #3360 to #3362 | stored catalog rows a price can cite; a zone for the 114 lines that have none (read 2026-11-12 00:12 UTC) |
| Profile readers | `vehicle_profile_read`, `vehicle_build_log_public`; #3393, #3429, #3433 | readers that show what the lanes above land, on web and phone |
| Gates and scoreboards | #3365, #3373, #3405, #3410, #3436, #3443, #3470 | the two readers above; refusals that name their legal move |

## Open collisions, each needing one decision

1. **Two places for a part.** The gate reads `part_key` on a cost line (text, a `subject_taxonomy.subject_key`).
   The component lane proposes `vehicle_observations.component_subject_id` (open `add_column` proposal filed
   2026-11-12 16:17 UTC). They name the same registry. Converge on it: observations take the column once it
   is approved, cost lines keep `part_key` with the same keys, and the gate keeps one lookup. Nobody mints a
   third.
2. **Who records an approval.** The card says an agent files and never approves. On 2026-11-12 16:21 UTC an
   agent wrote 20 `schema_proposal_reviews` rows on the owner's chat word. Nothing in the database tells his
   own act from an agent's row. The owner has been asked whether to enforce it or change the card. Until he
   answers: record nothing for him that he did not say about that specific proposal, and quote his words in
   the row.
3. **Numbers in rows.** The gate refuses a typed price, hour range or rate (a ruling made by the building
   agent under the owner's delegation, C17). `fixed_service_fee` (#3355) stores a fee with its source URL and
   hash in the record and is left to the cost fold. The two are not yet one rule.
4. **Hand-applied changes.** #3462 records 11 functions and 3 columns applied directly to production on
   2026-11-12 after a deploy failed. `AGENTS.md` says never. When a deploy fails, fix the deploy and say so
   here; a second lane cannot build on objects the repository does not hold.
5. **Photo days that say "pending analysis".** `timeline_events` holds one `pending_analysis` placeholder per
   photo day and nothing resolves it. `vehicle_profile_read` serves them as the record's events (6 on this
   vehicle, read 2026-11-13 02:04 UTC), so the phone shows "pending analysis" for days whose photos were all
   read. No lane owns this yet.
6. **Thin citations.** 75 of the 467 photos are interior views; the work records cite 3 of them (read
   2026-11-12 23:06 UTC). The page can only show what a record cites.

## How to work together here

- Read this page and run the two readers before you start. Run them again when you finish and put both
  reads in your pull request.
- One writer per record family. If you need another lane's rows changed, say what and why in your pull
  request and in the lane list; do not rewrite them yourself.
- A key is decided once. Look in the registry and in the open proposals first; if a lane has already
  proposed your place, use its key and add your readings to its proposal.
- When you hit a refusal, the message names the move. When you add a refusal, give it a move and a
  contract in `supabase/sql/`.
- Tell the others before you push a migration (`AGENTS.md`, "Writes and deploys"), and never hand-apply one.
- When this page is wrong, fix it in the pull request that made it wrong.
