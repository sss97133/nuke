# Preserve aught wire size in canonical catalog keys

Change type: code repair of existing catalog-key construction. No vehicle design,
wire gauge, stock, measured length, route, source observation or order is admitted.

The existing `harness_schematic_model` constructs expected parts only for positive
integer AWG. The existing `key_harness_segments` concatenates the integer directly.
For the established AWG index convention,0 means1/0 and-1 means2/0. The sourced
M22759/16 size tokens are01 and02; ordinary1AWG remains1. Chapter16 §1.4 and §4.1,
and the cited Thermax datasheet printed page41, establish that distinction.
The already retained document is81e85839-b5ba-464f-bbfe-3290af0f634d. This repair
does not choose any of those gauges for the truck.

Extend the two existing functions consistently: preserve ordinary positive-size
tokens; support0/-1 only for/16 using01/02; leave other nonpositive indices
unsupported. A catalog identity still requires an exact existing part match.
Every key change applies only to uncut, unmeasured physical pieces whose
current circuit belongs to the same vehicle and has no recorded physical progress.
Colour tokens use the same trimmed, ordered all-token rule as the reader. A
partially unknown colour is not silently shortened into a different stock code. Existing measured/cut identity stays
unchanged and the reader can expose a mismatch rather than silently rekey it.
No new function, mapping table or source writer is introduced. Existing loader,
source invalidation, model logic fingerprint and fold remain the owners.

Implementation validation covers1AWG versus1/0 versus2/0, family boundaries,
exact existing stock/missing stock, unsupported size, cut/measurement/build-history
preservation for positive and aught sizes, complete/partial/striped colour handling,
foreign-circuit refusal, idempotency, public/private grants, and the actual evaluated reader
after keying. The current production atlas/preflight request times out; no live
schema, writer or source changes are authorized by this local proof. Release must
still use the checked PR/CI path and actual refreshed schema/function/lock checks.

References: `chapters/16-wire-and-protection-canon.md` §1.4/§4.1;
`receipts/2026-06-19_canon-external-ingestion.md` correction1;
`K5_WIRING_STATE.md` §1 aught-spec reversal. The old receipt-format/rule files and
local library search manifest referenced by the historical wiring rule are absent
from current main; no index rebuild, physical choice or invented citation is used.
