# Garage evidence and relationships

Status, 2026-10-07: the bounded private relationship/cover correction contract was
owner-approved, admitted and deployed through PR 876. Its web reader shipped in
PR 877. Native profile/source integration merged through PR 880, with
phone delivery and real-library verification still pending. The broader physical
identity contract remains incomplete. The private native album intake described
below is implemented and locally tested; its deployment is a separate stage.

The garage currently projects one winning relationship from ownership periods,
approved proofs and previous-owner discoveries. That projection cannot represent
several simultaneous roles, personal versus business custody, a disputed interest,
or an owner rejecting a mistaken vehicle association. Photo assignment and the
existence of a work session do not resolve any of those questions.

## Existing owners and the missing contract

Extend the existing substrates rather than creating another garage table:

| Evidence | Existing owner | Meaning |
| --- | --- | --- |
| Physical vehicle | `vehicles`, sanctioned attribution and merge writers | One physical identity; existing aliases must be followed. |
| Photographic source | Native `LibraryStore`/`LocalStore`; `vehicle_images` | Original bytes and source metadata, independent of current assignment. |
| Human grouping | Native album catalog; `album_sync_map`, `image_sets`, `image_set_members` | Group membership as observed, including overlapping albums and changes. |
| Autonomous reading | Native `LibraryIngest`; image/observation intake | Versioned reading of the source, not confirmation of its assigned vehicle. |
| Sourced testimony | `vehicle_observations`, `ingest-observation`, supersession/attribution functions | Exact statement, speaker, source, receipt time and event-time qualification. |
| Ownership period/proof | `vehicle_ownerships`, verification and transfer writers | Period testimony and corroboration; mailing a title is not a dated completed transfer. |
| Organization role | `organization_vehicles` | Business relationship attributed to the organization, not its operator's personal ownership. |
| Performed work | Work-record observations, work orders/lines and qualified sessions | Performer is separate from author, uploader and photographer. |

Live inspection on 2026-10-07 found `ownership_claim_v1` is admitted only as a
keyed auction-comment atom. `relationship_with` measures evidence breadth, volume
and recency; it does not fold ownership or custody. Neither contract is an owner
correction intake. The legacy `update_vehicle_relationship` writes discoveries
and supports only interested/discovered/curated/consigned/previously_owned; using
it would erase distinctions and leave conflicting current-owner periods intact.

The deployed `garage_relationship` property follows the schema proposal/review
workflow. `record_garage_owner_correction` admits exact account testimony against
an already identified terminal vehicle, or an account-scoped eligible cover choice.
It preserves supersession and unknown dates, separates speaker from service actor,
and requires explicit source authorization for service intake. Its restrictive
read policy, canonical-view exclusion and subscriber guard preserve privacy.
It changes neither legacy title/access records nor global image-primary flags.
It does not yet admit unresolved vehicle identities or general image/album claims.

## Required admission and grain

Keep three separate assertions, each with its own source and qualification:

1. **Identity:** which physical vehicle or candidate the statement concerns. An
   unresolved statement retains its label and candidates without minting a vehicle
   or assigning an approximate year/make match. Rejection of a photo association
   does not delete the photograph or prove another vehicle's identity.
2. **Participation:** person or organization × vehicle × role × period. Roles are
   nonexclusive: personal ownership, shared interest, claimed interest, consignment,
   business custody, sales representation, performed work and documentation.
   A denial of personal ownership is explicit testimony, not a deletion.
3. **Title:** asserted registration/title holder, transfer pending/completed and
   dispute qualification, corroborated by exact documents where available. An
   interest or role alone establishes neither legal title nor verification.

Every claim must retain the exact quote or source reference, authenticated speaker,
asserted party, identity certainty, role, positive/negative polarity, period bounds
and precision, statement receipt time, ingest time and method. Unknown dates stay
unknown. A later correction supersedes a specific assertion while retaining its
predecessor; ordering by ingestion alone cannot erase contradictory testimony.

Owner intake must bind the speaker to the authenticated account. Service intake
must identify the owner's explicit authorization and source receipt. It cannot
set a verified-title result. Existing auction-comment admission remains unchanged.
Private family, title and client details remain within the owner's existing
audience. Approval of the contract must specify its read policy; a client-only
filter is insufficient. No new public grant is implied by this proposal.

## Garage projection

Use one common fold for web and native readers, based on qualified canonical
evidence at an explicit as-of/known-at boundary. Return all roles with their source,
periods, title qualification and conflicts. Grouping is a display choice, never an
authority rank that discards other roles. Keep unmatched statements visible as
unresolved vehicles, outside identified-vehicle and asset totals.

| Evidence case | Required result |
| --- | --- |
| Current personal owner, exact vehicle supported | Current ownership; verification only from qualifying proof. |
| Owner says no longer owned; disposal day unknown | Previous ownership, unknown end date; stale approval cannot restore current ownership. |
| Claimed family interest, title not in speaker's name, disputed | Claimed interest with private title/dispute qualification; no registered-owner assertion. |
| Shared interest, physical vehicle unresolved | Unresolved shared interest; do not attach the closest existing model/year. |
| Consignment or sales intermediary | Consignment or sales representation; excluded from personal ownership/assets. |
| Business held and sold vehicle | Organization custody/sale, with operator role separately attributed; no personal owner inference. |
| Owner rejects personal ownership; other role unknown | Relationship review with the denial retained; remove the false ownership assertion from the projection. |
| Acquisition/title transfer in progress | Pending transfer, without a completed acquisition date. |
| Photographs or inferred sessions only | Documentation/work evidence awaiting qualification, not ownership or confirmed performed labor. |

## Human and autonomous photo passes

The app observes native album identifiers, names, folder paths and memberships.
That human organization is a prior. Several albums can share a photo; an album can
contain several vehicles. Limited access means album coverage is unknown.

Analyze original local bytes independently, including previously assigned images.
Retain input hash, source/method versions, raw OCR and visual readings separately
from album context and owner verdicts. Classic serials must survive even when they
do not fit the modern VIN detector. Unavailable originals remain pending. Reuse a
reading only when its source and method still qualify. Existing cloud assignment
cannot serve as the autonomous pass's answer key.

The local implementation retains the whole accessible photo snapshot, overlapping
group history, Apple Vision labels and raw OCR, with album-first bounded progress.
Limited access preserves selected-photo coverage while album coverage stays unknown.
The own profile consumes exact serial candidates, account relationship statements,
conflicts and unknown dates from this record and opens the original source viewer.
These candidates are not canonical bindings. Remaining work includes independent
appearance-based identity, owner confirmation of unresolved candidates and cloud
retention of complete independent readings. It does not yet recognize every vehicle from appearance.

### Native grouping intake (implemented 2026-10-08)

`bulk_add_to_image_set(p_native_album, p_readings)` extends the existing album
writer. One immutable `image_sets` row retains an observed source album state:
native identifier, name, folder path, source kind, presence, exact local photo
references and source versions. `source_capture_id` is the account-scoped replay
key; `source_predecessor_id` is its typed predecessor; `source_observed_at` is the
app's grouping-observation clock. It is neither album creation nor photo capture
time. Source references remain even when no corresponding cloud image exists.

The actual authenticated account admits its own private capture. Native source
groups have no vehicle parent. An existing restrictive policy prevents reading
another account's group through legacy public-album rules. `album_sync_map` holds
the latest selector in an installation-specific `ios-source:` namespace, separate
from the older Mac importer's approximate vehicle mapping. Explicit predecessor
checks and immutable request content prevent delayed retries from restoring an
older state. Removed albums append an absent state; limited Photos access never
implies removal. The web personal-album reader uses this current selector while
historical captures remain addressable by ID.
Native source inserts also require the typed writer's definer context and actual
account identity; ordinary direct album inserts cannot masquerade as this intake.

Independent byte witnesses add `image_set_members` links only when a current
local read identifies the same source reference/version and exactly one eligible
uploaded original belongs to this account with that PhotoKit UUID and SHA-256.
The source-image witness is retained in member notes; existing member writers
cannot insert an unqualified link or edit it. This confirms source context, not
the image's assigned physical vehicle. Unknown versions, missing uploads,
documents and ambiguous cloud leaves remain unlinked. Source and unlinked counts
are returned alongside linked membership. The RPC accepts at most 50,000 source
references / 25 MB per source capture and 200 byte witnesses per call; larger
captures remain locally retained and pending rather than being called complete.

The native account-scoped outbox starts a new account at the current catalog,
then drains later offline source changes in order. A stable request retries until
its landed receipt; a failed network attempt cannot advance it. Bounded foreground
and existing background passes rotate pending byte witnesses and retry after
the tail wraps. This transport exports grouping metadata and byte witnesses;
raw OCR/labels and source pixels retain their existing local/upload boundaries.
It does not add a paid job or restart held analysis.
Only native source albums enter this grouping writer. Unorganized accessible
photos remain in the local full-library record and independent pass; the transport
does not invent an album for them or claim cloud source coverage is complete.

Hero selection must use an eligible image whose identity supports this vehicle:
an explicit owner choice first, then independently supported whole-vehicle views.
Parts/work/detail frames are gallery evidence, not automatic main images. Rejecting
a hero preserves it in the log. Show the unresolved state when no eligible image
exists; do not substitute an unrelated photo. Present model and trim separately.

## Release evidence and remaining work

Before calling the garage repaired: test the cases above against retained sources,
verify web/native agreement, demonstrate offline album rendering with zero network,
and compare runtime results with the owner corrections. Full accessible-library
coverage, unresolved identities, unread images and inferred work must be visible.

Sixteen native ledger/projection/outbox tests demonstrate actual SQLite reopening, account
isolation, source/method invalidation, unalbumed coverage, duplicate-serial conflicts
and correction-role/cover persistence, stable retries, offline grouping history and
limited-access removal safety. The Simulator build passes; native source
navigation renders using actual simulator Photos. Apple Vision fails to initialize
in that simulator, so complete independent readings there remain pending. No
real-phone, full-library or Airplane Mode/zero-network proof is implied.

The isolated PostgreSQL fixture `scripts/tests/native-album-source.sql` exercises
source retention, same-account byte qualification, ambiguous originals, typed
lineage, historical replay, privacy and immutability against the actual migration.
Run it through `scripts/test-garage-owner-corrections.sh native-album-source`;
the harness uses installed PostgreSQL and a disposable local Unix socket.

The approved bounded production correction support and the website deployment
have separate receipts. Private correction excerpts and identifiers stay outside
this public repository. New paid analysis, held jobs and public disclosure remain
outside this implementation.
