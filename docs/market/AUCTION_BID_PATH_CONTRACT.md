# Source-keyed bid paths

The existing order-book owner has a separate request overload:

```sql
lot_order_book_read(p_auction_event_id uuid, p_request jsonb)
```

The one-argument legacy reader and scheduled stored-fold writers are unchanged. The new method computes a bounded path on read, with exact source keys and both input clocks. It creates no tables and writes no source, inference, fold, or scheduling rows. Deployment and anonymous runtime access are separate from local contract and candidate SELECT verification.

## Inputs and knowledge

One canonical BaT auction must resolve to a public, undeleted, unmerged vehicle. Its source URL and finite recorded close must be established. Competing public bindings for its slash-normalized URL refuse. Every keyed source row must have the same parent and a compatible source locator; missing comment URLs retain their typed lot relation with an explicit basis.

The lower event bound is recorded close minus fourteen days, matching the existing order-book convention, not an observed opening. Current mode caps event time at the earlier of read time and the recorded close, and database recording time at read time. Reconstruction requires an explicitly zoned cutoff:

```json
{"knowledge_mode":"recorded_input_reconstruction","cutoff":"2026-11-25T21:00:00Z"}
```

Both clocks must pass before a bid enters the state calculation. Filtering the already computed stored states would be wrong: a bid recorded later could already have changed the price, participant count and depth of every later stored state. Reconstruction therefore recalculates the whole requested input set. Selection of a bid chooses a posted-order prefix within those known inputs; it does not itself change the knowledge cutoff.

Inputs remain current mutable testimony. Later corrections to an old row are not its historical value. The currently recorded final close is not an original scheduled-close receipt. This method establishes neither a feature served at the time nor an actual historical forecast.

## State mathematics

Eligible bid-marked rows have a known nonnegative amount, finite posted and database clocks, and satisfy both cutoffs. Order is posted time, native comment ID (zero when absent), then comment UUID in C collation. Other labels, missing amounts and unknown clocks remain coverage gaps.

A validated `bat` identity is one entry. Each bid without a validated platform identity is its own unresolved entry; equal handles are never merged. At state i, the running price is the maximum eligible amount through i. Each entry's revealed level is its own maximum through i. Depth at 90% and 75% counts entries at or above those fractions of the running price. Second-best is the second-highest entry level, including ties. It is null with fewer than two entries. The top-two gap is running price minus that level; price change is the change in the running high bid and is null at the first state.

These are observed bids and conditional book statistics. A bid is a lower bound on willingness to pay; this is not an intrinsic-value estimate, human population count, demand forecast or profit calculation. The final sale amount is not a feature input.

Each state includes its source comment key, native source anchor when known, event and database clocks, participant key when validated, numeric state fields and coverage. Selecting `selected_bid_comment_id` returns that state's book with all supporting eligible comment keys. Each entry names its first, last and earliest highest bid, its bid count and inclusive depth at its revealed maximum. Equal levels share the same inclusive depth. These values are calculated in SQL; the consumer does not rebuild entry statistics or choose the maximum's source. A selected bid absent from the requested known inputs refuses rather than silently selecting another one.

## Amounts, bounds and consistency

All amount values are exact decimal strings. Current canonical lot currency, its citation and price-basis/kind fields are returned as current context; absent or uncited currency stays unknown. A recorded currency claim is not a verified historical qualification. No currency, fee, settlement or dollar basis is invented or converted.

The reader refuses more than 5,000 keyed source rows, more than 500 eligible bid states, or more than 4 MiB of source-locator text. Numeric representation is limited to absolute values at most 10^18 and scale at most six; unsupported representation refuses before hash/state work. Negative eligible amounts refuse. These are work/representation bounds, not claims about vehicle values.

The snapshot binds method/version, episode, source/close, current financial qualifications, both cutoffs, and the bounded retained source projection. A pinned selection carries that hash plus the initial event/recorded cutoffs in current mode, or its original reconstruction cutoff. A changed source refuses with `evidence_snapshot_changed`. The hash is a consistency token, not a signed or frozen witness. Source coverage includes retained rows outside the requested cutoff; those hindsight coverage counts are not feature inputs.

## Verification and remaining work

The disposable PG17 contract preserves the old body/ACL, invoker grants and caller budgets. It checks hand-calculated prices/depth/selection, delayed-arrival reconstruction, exact trailing-window boundaries, wrong parents and URLs, aliases, private/deleted/merged/nonvehicle gates, unsupported numbers, source/qualification changes, final-result exclusion, malformed controls, and 500/501-bid, 5,000/5,001-row and byte limits. An independent imperative reference walks 32 source patterns under current and reconstructed input modes, comparing every state across 64 simulations.

The initial 500-bid case exposed a nested scan of a large intermediate book. Carrying its running price directly into the depth aggregation removed that repeated join. With the same three-second caller limit, the slowest local statement fell from about 2.7 seconds to about 0.18 seconds. No timeout or planner setting was raised or forced. CI and production timing remain separate evidence.

The candidate calculation CTE was executed read-only for four real public lots in current and ten-minutes-before-close modes. All 163 current states matched the stored fold on source keys, sequence, amounts, prices, entry/identity/unresolved counts, second-best and both depths. Plymouth retained 28 known bids at its ten-minute cutoff and identified eight additional posted bids recorded later; Sprinter retained 44 and identified two later arrivals. Currency qualification was unknown for all four sampled episodes. These samples do not establish population coverage or deployed RPC access.

The deployed anonymous reader, existing curve consumer, qualified cross-vehicle comparisons, calibrated cohort baselines and outcome evaluation remain required. No stored fold was forced, no new intake or inference was run, and no financial qualification was backfilled.
