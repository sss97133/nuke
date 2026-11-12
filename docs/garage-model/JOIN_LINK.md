# The garage join link

Status: **DRAFT, nothing applied or deployed.** JOIN lane, written 2026-11-12 against the SPEC lane's core draft
(`supabase/drafts/garage-model/migrations/20261112100000_garage_core.sql`). Spec: [`SPEC.md`](SPEC.md) (§3 membership and rank,
§8 step 4). Labels: **[repo]** = read from files in this branch; **[tested]** = proven by `supabase/sql/test_garage_join.sql` on a
disposable PG17; **[unverified]** = could not be run here (no Swift toolchain, no Mac, no live writes). Nothing here was measured on
production and no number in this document is a production count.

North star (owner): *he sends a link to his technicians and data begins to flow and exchange.* This is the link.

## The flow, end to end

1. **Owner mints.** In the app's Garage screen, a "People" section has **Invite a technician**. It reads `garage_my_garages()`,
   keeps the garages where the user is an *active* member of rank >= 80, and calls
   `create_garage_join_link(garage, 'technician', 10)` (ten uses, seven-day default expiry, approval required). The server returns
   the raw token **once**; only its sha256 is stored. The app hands `https://nuke.ag/join/<token>` to the share sheet
   (`UIActivityViewController`) with "Join <garage> on Nuke: <link>". The token lives only in memory on the way to the sheet. **[repo, tested server side]**
2. **Technician taps.** On a phone with the app, the universal link (`applinks:nuke.ag`) or the fallback `ag.nuke.capture://join/<token>`
   opens the app; `JoinLinkCoordinator` saves the token (UserDefaults, seven days max) and presents the Join sheet over whatever root
   is showing. Without the app the link opens `nuke.ag/join/<token>` in a browser: **that web page does not exist yet** (see "What remains"). **[repo; unverified on device]**
3. **Preview.** The sheet calls `preview_garage_join_link(token)` (anon-callable): "<Garage> invited you. You'll join as a technician."
   Nothing else is shown, because nothing else is returned: the function returns exactly garage name, role, `valid`, `reason`. A
   bad, expired, revoked or used-up link shows why in words. **[tested]**
4. **Sign in.** Signed out: the sheet says the invitation is kept; "Sign in to join" closes it onto the app's normal sign-in
   (Apple, email, ...: existing `SignInView`). The token stays saved. On sign-in (or the next launch while signed in) the sheet comes back and the preview repeats. **[repo; unverified on device]**
5. **Redeem.** "Join" calls `redeem_garage_join_link(token)`. It writes a `garage_members` row: `pending` (the default), or `active`
   only when the minter set `requires_approval=false` **and** the role is technician or lower. A manager-role link always waits for
   a person. Redeeming again returns the same row and counts no second use. It grants **no vehicle-level access**: a pending member
   has rank 0 (`garage_member_rank` counts active members only) and the join writers never touch vehicle tables or `organization_contributors`. **[tested]**
6. **Pending.** "Waiting for <garage> to approve you", with "Check again" (an idempotent redeem that returns the current state). The
   token is forgotten once the link has answered. Later, `garage_my_garages()` still lists the pending row with its status. **[repo]**
7. **Owner approves.** `decide_garage_membership(member, true, role?)`: manager+, role no higher than the approver's own rank, never `owner`,
   pending rows only, never one's own row. Approving records who and when and starts the membership; declining closes the row as
   `revoked` with an end time (the row stays as history). The roster read for managers shows pending rows (`garage_members_read`). **[tested]. There is no approval screen in the app yet.**
8. **Active.** The next "Check again" (or any `garage_my_garages()`) shows `active` and the sheet says "You're in at <garage>".
9. **Data starts to land.** *Joining is the permission and the rank; it is not what moves data.* After approval the technician has
   a rank, so the SPEC's read rules apply (technician sees cars currently here, not consignment media). Their photos and work reach the place
   through the PRESENCE lane, not through this link: a photo whose GPS falls inside a `garage_sites` circle becomes `site_photo` evidence
   with `originator_user_id` = the technician and affiliation = the garage; a work session likewise. So the technician's evidence is
   credited to them (originator) and affiliated to the garage (reaches the owner through his rank). **None of that is built by this PR**
   (`garage_now`, `garage_inbound_feed` are stubs in the core draft), and the technician's phone does not yet know the garage's site.

## Server contract (drafts, `20261112100200_garage_join_links.sql`)

| Function | Who | Does | Refuses with |
|---|---|---|---|
| `create_garage_join_link(p_garage, p_role, p_max_uses=1, p_expires_at=now()+7d, p_requires_approval=true)` -> `(link_id, token)` | active member rank >= 80 | 32-byte token (two `gen_random_uuid()` values, the repo's own method in `create_contributor_invite`, 244 random bits), base64url, 43 chars; stores sha256 hex only | `28000` no session; `22023` role `owner`/unknown, `max_uses` outside 1..100, expiry not in (now, now+30d], closed garage; `42501` rank < 80 or role above own rank; `54000` already 25 live links |
| `preview_garage_join_link(p_token)` -> `(garage_name, role, valid, reason)` | **anon**, authenticated | one row always; `reason` in `ok, not_found, expired, revoked, exhausted, garage_closed`; malformed and unknown tokens answer identically | never raises |
| `redeem_garage_join_link(p_token)` -> `(member_id, status)` | signed-in, not an anonymous Supabase session | row-locks the link; returns the caller's existing live (pending/active/suspended) row unchanged first; then checks removed-member, revoked, expired, exhausted, closed, <= 50 pending; inserts the row and counts one use | `28000`; `P0001` with `join_link_not_found / _revoked / _expired / _exhausted / _garage_closed / _garage_busy / _membership_revoked` |
| `decide_garage_membership(p_member, p_approve, p_role=null)` -> `(member_id, status, role)` | rank >= 80 of that garage | approve (optionally lower/equal role) or decline a pending row | `42501` rank, own row, role above own rank; `22023` owner/unknown role; `P0001` not pending / not found |
| `revoke_garage_join_link(p_link)` -> `boolean` | rank >= 80 of that garage | sets `revoked_at`; `true` if this call revoked it, `false` if it already was | `42501` (also for an unknown id, so ids are not probeable) |

Additive to CONTRACT.md: the fifth argument `p_requires_approval`, and the return shapes of `decide_*` and `revoke_*` (the contract named none).
Grants: only `preview` is executable by `anon`; the rest by `authenticated` and `service_role`. The tables stay write-closed: no client writes
`garage_join_links` or `garage_members` directly (core draft). All writers are `SECURITY DEFINER` with `search_path = public, pg_temp`.

### Abuse and rate limits

* **Guessing.** 244 random bits; unusable by brute force. A wrong token and a malformed one look the same to anon callers. **[tested]**
* **Mint ceilings.** 25 live links per garage; 100 uses and 30 days at most per link. **[tested for the 25]**
* **Pending ceiling.** 50 unanswered applications per garage (`join_link_garage_busy`) so a leaked link cannot bury the owner. [repo; not exercised in the test]
* **Anon preview load.** `PostgREST` has no per-IP limit of its own in these drafts. The draft edge function `garage-join` adds a
  per-IP window (30 requests / 60 s, in memory per isolate: a floor, not a global limit) for the web page. A global limit belongs to the platform's edge/WAF setting, which I did not touch.
* **Leaked link.** Revoke it; people already admitted stay and are managed as members. A used link cannot admit anyone after revoke (tested).
* **Declined or removed people** cannot walk back in on a link (`join_link_membership_revoked`); a manager decides. Someone who `left` may rejoin.
* **Anonymous sessions** cannot redeem. **[tested]**
* The raw token is a credential while the link is live: the app keeps it at most seven days and only until the link answers; it is never logged.

### How this relates to the existing doors (none is touched)

| Existing | Relation |
|---|---|
| `business_invite_codes`, `generate_invite_code`, `use_invite_code` (Telegram-era) | Redeems into `telegram_technicians`, never a membership. SPEC §3.2: superseded for new invites, left callable, nothing links to it. Different table, different token shape. |
| `vehicle_contributor_invites`, `create_contributor_invite`, `contributor-intake` | The per-vehicle narrow door (one car, no account): **stays and is first-class** (SPEC §3.2, §6). It uses a 64-hex token and the `/contributor` flow; the garage link is a 43-char base64url token on `/join`. A join link never hands out a vehicle. |
| Web `/invite/:token`, `/supplier-invite/:token` (`SupplierInvitePage`, `create_supplier_invite`) | Supplier invites for businesses. `/join/:token` is a new, separate route; nothing in `DomainRoutes.tsx` changes in this PR. |
| `organization_contributors` | Not written. A joined technician gains nothing through the H1 policy on `vehicle_images` (SPEC §10). |

## Phone side

Files (all in `apps/nuke-capture-ios`): `Sources/NukeCapture/Garage/GarageJoin.swift` (parsing, token store, error classifier, models),
`JoinLinkView.swift` (the screen), `GarageInvite.swift` (owner side, share sheet), the wiring in `NukeCaptureApp.swift` (`onOpenURL`,
`onContinueUserActivity`, a sheet, resume on sign-in), the "People" section in `GarageView.swift`, the `applinks:nuke.ag` entitlement in
`project.yml`, and `UnitTests/GarageJoinTests.swift`.

* **Custom scheme.** CONTRACT.md suggests `nukecapture://join/<token>`; the app's registered scheme is **`ag.nuke.capture`** (`project.yml`
  CFBundleURLTypes, also used for the OAuth callback and the `sync` door), so the fallback is `ag.nuke.capture://join/<token>`. No new scheme was added.
* **Not available yet.** A missing function (PostgREST `PGRST202`, `42883`, or HTTP 404) becomes the state "Garage invites aren't available yet"
  on the Join sheet, in the Invite row, and for a missing `garage_my_garages`. It is never a crash and never a success. The existing app uses the same classification (`JobReaders`).
* **Pending token.** Saved in UserDefaults when the link is tapped, kept across sign-in and relaunch for seven days, removed when the link answers (pending, active, invalid, not available, blocked). Network failures keep it.
* **Link kinds it ignores.** `https://nuke.ag/invite/...`, `/supplier-invite/...`, `ag.nuke.capture://sync`, `login-callback` and anything that is not exactly `/join/<43 base64url chars>` fall through to the existing handlers (unit-tested).

## What I could and could not check

| Check | Result |
|---|---|
| `PG_BINDIR=/workspace/claude-swarm/pgbin bash scripts/ci/run-db-contracts.sh test_garage_join.sql test_garage_core.sql` | pass, pass (2026-11-12). A deliberately failing assertion appended to the join test made the runner report `fail`, so the runner does execute it. |
| Swift build and `GarageJoinTests` | **Not run: no Swift or Xcode on this Linux box.** The Swift is hand-checked only. |
| Universal link on a device | Not run. |
| Live production | Not touched. The functions do not exist there; I made no write and no outbound call. |

Must be verified on a Mac / in CI (`.github/workflows/ios-build.yml`: `xcodegen generate`, then `xcodebuild test`):
1. It compiles (new files are picked up by `sources: Sources` and `UnitTests` automatically). Likely trouble spots: main-actor isolation of the `onTerminal` closure in `JoinLinkView.init`, the `Group { Button; switch }` rows in `GarageInviteRow`, `PostgrestError`/`HTTPError` usage in `JoinError.from` (copied from `JobReaders`).
2. `GarageJoinTests` all pass; `NukeCaptureUITests` still pass with the extra "People" section in `GarageView` (a UI test that counts rows or taps by position could shift).
3. `project.yml` generates the entitlements file with `com.apple.developer.associated-domains`; the **Associated Domains capability must be enabled on the `ag.nuke.capture` App ID** in the developer portal, or signing fails.
4. On a device: tapping `https://nuke.ag/join/<token>` opens the app (needs the AASA, below), the custom-scheme link opens it without the AASA, signed-out resume works.

## What remains after this PR

1. **Apply the server drafts** (Skylar's approval; one migration per commit per push, `view_write_guard` not relevant, no views). The core draft (`...100000`) must land first. Until then the app shows "not available yet".
2. **AASA on nuke.ag**: `supabase/drafts/garage-model/web/AASA.md` (+ the file). Needs the Apple Team ID and a header rule to serve it as `application/json`. Without it the https link opens Safari; the custom-scheme link still works.
3. **Web fallback page `/join/:token`** (frontend PR) using the draft edge function `garage-join` (GET `?token=`); the SPA has no such route today.
4. **Approval UI**: the owner needs a screen listing pending members (`garage_members_read`) with approve / decline / role (`decide_garage_membership`), and a push or badge when someone is waiting. Today approval is possible only by calling the RPC.
5. **Roster and link management UI**: list live links, revoke (`revoke_garage_join_link` exists), remove or suspend a member (no function yet), change an active member's role (SPEC §3.1 says "approve / change role"; only pending rows are decided here), a member leaving.
6. **Data landing** (PRESENCE / VISIBILITY lanes): `garage_now`, `garage_inbound_feed`, `can_see_vehicle_via_garage` are still stubs in the core draft; the technician's phone needs to know the garage site for GPS-in-site capture; the originator-vs-affiliation reads in SPEC §5.
7. **Telemetry**: no funnel event for mint / open / redeem / approve yet. Per `production-engineering.md` (silent failure), add counters on `garage_join_links.uses_count` vs `garage_members` rows by link before this is relied on.

## Open questions for Skylar

1. **Manager links.** SPEC lets a manager mint up to manager (rank equality). Should only the owner be able to mint a `manager` link? (The code follows SPEC; a one-line change.)
2. **A declined person.** Declined rows become `revoked`, which blocks re-entry on any link, so a mistaken decline cannot be undone through a link. There is no "re-admit" function. Should `decide_garage_membership` be allowed to approve a `revoked` row?
3. **Does a use count when declined?** Yes today (the use is consumed at redeem). With `max_uses = 1`, a declined applicant burns the link.
4. **Technician default.** "Invite a technician" mints 10 uses / 7 days / approval required. Is one link per technician, or one link for the crew, the intended habit? (If one link for the crew, 10 may be too few or too many.)
5. **Approval waiver.** `p_requires_approval=false` lets a technician-or-lower link admit people at once; the app never sets it. Keep it server-side only?
6. **Customers.** `customer`/`viewer` links exist server-side (rank 20/10) but the app only mints technicians. Customers likely belong on the per-vehicle contributor link instead; confirm.
7. **CONTRACT vs app.** The contract's `nukecapture://` is not the app's scheme (`ag.nuke.capture`); I followed the app. The contract also did not name the extra argument and return shapes above.
