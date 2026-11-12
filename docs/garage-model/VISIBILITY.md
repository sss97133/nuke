# Garage model: visibility (who sees what, and the holes that break it)

Status: **DRAFT, nothing applied.** VISIBILITY lane, 2026-11-12, on top of `docs/garage-model/SPEC.md` (SPEC wins where the two differ).
Drafts: `supabase/drafts/garage-model/migrations/20261112100300 … 370`. Contract: `supabase/sql/test_garage_visibility.sql`
(85 assertions, passes; run `PG_BINDIR=<pg17 bin> bash scripts/ci/run-db-contracts.sh test_garage_visibility.sql`), which loads the live policy
text from `supabase/sql/helpers/garage_visibility_live_20261112.sql`.

Labels: **[live]** read from production on 2026-11-12 (catalog snapshot ~10:50 AM AST = UTC-4; row reads ~11:00 AM AST through the GET-only proxy).
**[test]** proven by the contract against the live policy text. **[repo]** repo only. **[unverified]** not in the snapshot; stated as such.
No person is named: ids, roles and counts only.

---

## 1. Verdict on the five reported holes (and the extra ones)

Numbering follows the task brief; "SPEC Hn" is the same hole in SPEC.md section 9.3.

| # | Reported | Verified live? | Differs from the report |
|---|---|---|---|
| 1 (SPEC H3) | `vehicle_images` INSERT lets any signed-in user add photos to any vehicle | **Yes** [live][test] | **Worse than described.** There are three permissive policies, not one: `Authenticated users can upload images to any vehicle`, `Logged in users can upload images` (any vehicle or none) and `Authenticated can upload vehicle images`, whose check is `uid = submitted_by OR (submitted_by IS NULL AND uid IS NOT NULL)`: it does not look at `user_id` at all, so a row can **name another user as the photographer** on any vehicle [test]. It also opens a chain: a photo on any car satisfies `enforce_user_vehicle_evidence`, so the user can then self-insert a `vehicle_user_permissions` 'contributor' row (`vup_insert_own`) and reach the car's UPDATE/DELETE policies (H8). |
| 2 (SPEC H2) | `organization_contributors` SELECT `true` | **Yes** [live][test]. Policy `organization_contributors_select`, roles `{public}` so anon too; 10 rows, all `active`, all `self_claimed` (exact read). | None. |
| 3 (SPEC H1) | Any active org member sees every image on every org-linked vehicle | **Yes** [live][test] | Role-blind and relationship-blind and includes **sensitive** images (title scans). `organization_vehicles.relationship_type` seen live: `service_provider`, `consigner`, `owner`, `sold_by`, `work_location`, `auction_platform` (function bodies); a 300-row recent sample was 299 `service_provider`, 1 `consigner`. |
| 4 (SPEC H6) | `work_order_assignments` has no SELECT policy | **Yes** [live][test]: RLS on, no policy row at all; 9 rows (exact). | **No web, iOS or edge-function source reads this table by name** (grep), so nothing depends on it being closed. The table carries payout terms (`payout_rate`, `payout_percentage`, `estimated_payout`, `actual_payout`, term hashes), so "let clients read it" would leak money: the draft adds a money-free view for clients. |
| 5 (SPEC H5) | `work_sessions` ignores org/garage membership | **Yes** [live][test]. Three SELECT policies: own user, `vehicles.owner_id/user_id`, `vehicle_user_permissions`. 1,925 rows (catalog estimate); `place_id` not null on 0 and `technician_id` on 1 (SPEC exact reads), so a `place_id` rule would match nothing. | Row carries `labor_rate_per_hour`, `quoted_price`, `final_invoice`, `profit_margin`, `total_*` costs; a policy cannot hide columns, so the garage arm is **owner only** (money rule), managers read through the inbound feed. |
| owner UPDATE/DELETE | Owner reaches images others uploaded | **Yes** [live][test] | **Eleven** policies (5 UPDATE, 6 DELETE), not two: owner/uploader columns, any `vehicle_contributor_roles` row, and any `vehicle_user_permissions` row of nine roles can UPDATE and DELETE **every** image on the car. One thing the report implied that is **not** a hole: moving a photo onto a car the mover does not own is already refused by the live policies (the new row must satisfy the same predicate) [test]. |
| storage | Bucket policies for the same images | Partly. `vehicle_images_upload` (INSERT, authenticated) checks only `bucket_id = 'vehicle-images'` [live]: any signed-in user can write an object under `vehicles/<any vehicle id>/…`. Read/update/delete are owner-only. Whether the bucket is **public** (public URLs bypass every storage policy) is not in the snapshot [unverified]. | |

### Additional holes found in the same tables (not all drafted)

| # | Hole [live] | Effect | Drafted? |
|---|---|---|---|
| H8 | `vehicle_user_permissions` INSERT `vup_insert_own` is `WITH CHECK (user_id = auth.uid())` (and `Vehicle owners can manage permissions` has `auth.uid() = user_id` as its ALL check); SELECT is `true` (`Public read access to vehicle permissions`) | Anyone can self-grant a role on a vehicle (guarded only by `enforce_user_vehicle_evidence`, which for non-owner roles asks for **any prior photo on the car** or an approved verification) and the whole permission table is public (who holds which role on which car). Of the 116 rows (exact, 11:03 AM AST): 59 active 'contributor' rows with `granted_by` null (legacy), 15 active 'contributor' rows self-granted, 4+1 `previously_owned`/`consigned` self-granted, 31 inactive or revoked. | **No.** Its writers are not in the snapshot (the grantor stamp trigger body is missing); needs a read of the live writers first. The garage helper ignores self-granted rows (`granted_by` null or equal to the user), so the garage model does not inherit it; `vehicle_image_steward` **does** trust them (preserves today's access) and the test pins that as the residual [test]. |
| H9 | `work_sessions` INSERT `WITH CHECK (user_id = auth.uid())`, no vehicle standing | Anyone can write a session on any vehicle. A session is a claim, not proof of presence. | No; PRESENCE must not let one start a stay. |
| H10 | `organization_vehicles` SELECT `true` twice (`Anyone views org-vehicle links`, `organization_vehicles_select`) on a table with `cost_basis`, `asking_price`, `sale_price`, `internal_notes` | If column grants do not hide them, anon reads cost basis and internal notes. 15 rows have a non-null `cost_basis` (exact, 11:03 AM AST). Column grants are not in the snapshot and the proxy's role is unknown: **[unverified]**. | No. Probe as anon first. |
| H11 | `users_can_update_own_images` / `Users can update own…` let an originator UPDATE `vehicle_id` of their own photo to **any** vehicle [test] | An uploader can re-file their own photo onto another car. Trigger `a05_trg_enforce_vision_gate_filing` fires on `vehicle_id` updates but its body is not in the snapshot. | No (reported). |
| H12 | `capture_relay_default_vehicle_fn` (BEFORE INSERT, SECURITY DEFINER) files a NULL-vehicle row to a default vehicle; **body not in the snapshot or the repo migrations** (drift) | The RLS WITH CHECK of migration 310 sees the row *after* this trigger, so if the default vehicle is one the uploader has no standing on, the capture insert would now fail. | Must be read before 310 applies. |

---

## 2. The matrix

Relationship = `garage_vehicle_stays.relationship`. "Here" = open stay, last seen within 365 days, no newer `left` / `not_here` assertion.
Rank = `garage_role_rank` of the viewer's **active** membership (owner 100, manager 80, technician 50, staff 40, photographer 30, customer 20, viewer 10).
**F** = full (media, evidence, work); **S** = summary (the car is in the place; no media, no money); **-** = none. Implemented by
`garage_vehicle_visibility(vehicle, user)` (migration 300) and proven cell by cell in the contract's matrix (9 viewers × 8 cars) [test].

### 2.1 Media (photos of a car) and evidence through a garage

| Viewer | owned | dealer_inventory | consignment | customer_work | storage | passing_through | unknown | left / stale |
|---|---|---|---|---|---|---|---|---|
| owner 100 | F | F | F | F | F | F | F | F |
| manager 80 | F | F | F | F | F | F | F | F |
| technician 50 | F if here | S; **F with a grant** | S; **F with a grant** | F if here | F if here | F if here | S; **F if assigned** | S |
| staff 40 | F if here | S; F with a grant | S; F with a grant | F if here | F if here | F if here | S | S |
| photographer 30 | - ; **F with a grant** | - ; F with a grant | - ; F with a grant | - ; F with a grant | - ; F with a grant | - ; F with a grant | - ; F with a grant | - |
| customer 20 | **F on their own car** | - | **F on their own car** | **F on their own car** | **F on their own car** | **F on their own car** | **F on their own car** | - |
| viewer 10 | - (counts only through `garage_now`) | - | - | - | - | - | - | - |
| originator (any rank) | always their own row, on any car, via the row's own policy (not through the garage) |

* **Grant** = an active, unexpired, unrevoked `vehicle_user_permissions` row **someone else** gave (`granted_by` not null and not the user). A self-granted row and a legacy row with no grantor do **not** count (the 59 + 15 live rows above grant nothing through the garage; that is deliberately conservative and fails closed). **Assigned** = a non-declined `work_order_assignments` row on a work order for that car reaching the user through `technicians.user_id` or `accepted_by_user_id`.
* Grant and assignment still need a stay in a garage the viewer belongs to (rank ≥ 30; assignment rank ≥ 50).
* Customer on their own car: `vehicles.user_id/owner_id` or an active `owner`/`co_owner` permission; never `dealer_inventory`.
* **Differs from SPEC 9.2:** the matrix there says customer `consignment = never`, while its own "Consignment / pre-auction" row says the consigning customer sees their own car. This draft follows the second (own car, any relationship except dealer inventory). Question Q-V1.
* **Summary** is given to rank ≥ 40 only: a technician may know the car is in the place, not see its media (Q-V2: or should pre-auction cars be invisible even as a row?).

### 2.2 Roster

| Viewer | Garage roster (`garage_members`) | Org roster (`organization_contributors`), after migration 320 |
|---|---|---|
| owner / manager | all rows incl. pending, left, revoked | members, active owners and admins of that org read the whole roster |
| technician / staff / photographer (≥ 30) | active rows through `garage_members_read` (ids and roles) | own row, own org's roster |
| customer / viewer | own row only | own row |
| outsider, anon | nothing | nothing; public pages use `org_public_contributors()` (role, count, since; no user id) |

### 2.3 Work (sessions, orders, assignments)

| Viewer | `work_sessions` on a car in the garage | `work_order_assignments` (payout terms) | assignment parties (no money) |
|---|---|---|---|
| garage owner 100 | all (migration 350) | if he owns the order's org, or runs the garage that operates/hosts it | via `work_order_is_accessible` |
| manager 80 | through the inbound feed only (no money columns); not the table | no | via `work_order_is_accessible` |
| assigned technician | own sessions (existing) | own assignment (migration 340) | same |
| client (order's customer) | sessions on a car they own (existing) | no | yes, `work_order_assignment_parties` |
| anyone else | no | no | no |

### 2.4 Money and receipts

Owner only by default (SPEC 9.2): cost basis, asking, receipts, labor rates, payout terms. Migration 340/350 never widen money beyond the owner. A
manager's operational view of quotes and work orders is open question Q5 in SPEC.

---

## 3. Before / after, per migration

| Mig | Before (live text, test-proven) | After | Preserved paths [test] |
|---|---|---|---|
| **300** helpers | `can_see_vehicle_via_garage` is a stub returning false | `garage_member_rank` (indexed), `garage_vehicle_visibility` full/summary/none, `can_see_vehicle_via_garage` = (visibility = full). SECURITY DEFINER, STABLE, `search_path = public, pg_temp`, anon revoked. | Rank ladder unchanged |
| **310** insert | any signed-in user attaches a photo to any vehicle, or names another photographer | one policy: `(user_id = uid OR submitted_by = uid) AND can_attach_vehicle_image(vehicle_id)`; attach = no vehicle (library), owner/uploader, active permission or contributor-role holder, active member of an org linked to the car, or a garage member who sees the car in full | library uploads; owner uploads; org member to org-linked car; garage technician to a car that is here; grant holder; photographer with a grant; ghost-photographer import by a signed-in uploader; service role; SECURITY DEFINER intake writer (contributor link) for an anonymous link holder |
| **320** roster | anon reads every roster | own rows, own org's roster (member, owner, admin); `org_public_contributors()` for public pages | pending self-claim insert; 34 policies on 23 other tables that subselect `organization_contributors` (every one is constrained to the caller's own row) |
| **330** org image scope | any active member of any role reads every image of every linked car, incl. sensitive | stewards (owner, co_founder, manager, board_member) read all; other roles read non-sensitive images of `service_provider` / `work_location` links only | public-vehicle policy untouched (public photos stay public); car owner unchanged |
| **340** assignments | no policy; everyone denied | own technician, org owner (and garage owner of the hosting garage) read the table; the order's parties read a money-free view | writes stay closed (no INSERT/UPDATE policy) |
| **350** work_sessions | garage owner sees only sessions he owns or has a permission for | + garage owner (rank 100) sees sessions on any car with a stay in his garage | own sessions; car owner's view; no manager/outsider/photographer access |
| **360** owner rights | 11 policies: owner, any contributor-role holder or permission holder updates and deletes every image | 4 policies: originator updates/deletes own; steward updates the car's media (stays on cars they steward) and deletes only rows nobody else authored | owner deletes own and scraper/listing rows; owner still edits/supersedes others' photos; technician deletes own |
| **370** storage | any signed-in user writes under any vehicle's path | `vehicles/<id>/…` needs the same attach predicate; `users/<uid>/…` and `temp/title-scan/<uid>/…` need your own uid; flat legacy names unchanged | owner and org member under their car; service role; `vehicle-photos` bucket |

Contract findings that changed the drafts: (a) a policy written with `(SELECT auth.uid())` has sublinks and makes the live `organization_contributors` INSERT policy fail with "infinite recursion", so migration 320 uses bare `auth.uid()`; (b) `AND` does not short-circuit, so a non-uuid folder in a storage path would raise a cast error instead of refusing: migration 370 uses `CASE`; (c) an UPDATE needs the SELECT policy to see the row, and no live SELECT policy lets a `vehicle_user_permissions` holder read a private car's images, so the "contributors can update" policies were already partly moot on private cars.

---

## 4. Live callers affected (found by grep, 2026-11-12; repo only unless stated)

**310 / 370 (vehicle_images insert, storage upload)**
* Web inserts as the signed-in user: `nuke_frontend/src/services/imageUploadService.ts:544` (user_id = self, vehicle optional: passes for owners; **fails** for a user uploading to a car they do not own and the org does not link), `services/unifiedImageImportService.ts:447` (**sets `user_id: photographerId`, a ghost user**; needs `submitted_by: <signed-in user>` added **before** 310, or those imports fail), `services/dataRouter.ts:391`, `components/images/ImageGallery.tsx:1237`.
* iOS `apps/nuke-capture-ios/.../SupabaseService.swift:602,614` and Mac relay `apps/nuke-capture-mac/.../SupabaseService.swift:159` insert `user_id = self` with **no** `vehicle_id`: unaffected unless `capture_relay_default_vehicle_fn` (H12) sets one. `SupabaseService.swift:250` comment says "vehicle_images RLS already lets any authed user attach an image to any vehicle, so an org contributor needs NO server change": **that is the hole**; after 310 the contributor path works only for cars linked to the contributor's org through `organization_vehicles`. The doc comment should be corrected when 310 ships.
* Service-role writers (bypass RLS; unchanged): `supabase/functions/extract-broad-arrow`, `extract-mecum`, `extract-bonhams`, `_shared/vehicleImageWrite.ts`, `_shared/craigslistImages.ts`, and the `scripts/` importers (inferred: they run with the service key).
* `contributor_intake_file` (SECURITY DEFINER, owner role) inserts with `user_id` null and `submitted_by` = the recorder: bypasses RLS, unchanged [test via stand-in].
* Storage paths used by the web: `vehicles/<id>/…`, `users/<uid>/unorganized/…`, `temp/title-scan/<uid>/…` and flat names (`imageUploadService.ts:387`, `ReceiptManager.tsx`, `EnhancedTimelineEventForm.tsx`, `uploadManager.ts`, `aiDataIngestion.ts`).

**320 (roster)**: one reader of another user's rows: `nuke_frontend/src/pages/OrganizationProfile.tsx:1722` (`id, user_id, role, contribution_count, created_at` for an org): **move it to `org_public_contributors()` before 320**. The other 12 web/iOS readers filter by the caller's own `user_id` (`deriveModes.ts`, `VehicleComments.tsx`, `RestorationIntake.tsx`, `AddOrganizationRelationship.tsx`, `ownershipService.ts`, iOS `fetchActiveOrgMemberships`, …); the edge functions `extract-vin-from-vehicle`, `auto-merge-duplicate-orgs`, `work-session`, `api-v1-business-data` read by org or by user (service role, inferred). `logged-out-live.mjs` after applying.

**330 (org image scope)**: any signed-in org member reading images of org-linked cars they do not own: vehicle profile gallery (`ImageGallery.tsx`), `OrganizationInventory.tsx`, `ServiceVehicleCardRich.tsx`; iOS `GarageActivityReader` (photos by `taken_at`). Non-steward members lose consignment/inventory cars and sensitive images. The public-vehicle policy keeps public cars public.

**340**: none (no reader exists). **350**: shop-owner reads of `work_sessions` (web profile receipts, iOS `WorkDaySignView`/`VehicleDetailView` confirm flows) return more rows, never fewer.

**360**: owner "delete photo" actions (ImageGallery, ProImageViewer, BulkImageUploader, VehicleEditModal) fail on photos another person uploaded; supersede/flag (UPDATE) stays. `AttributionEngine` re-files via the `attribute_image_session` RPC (its body is not in the snapshot [unverified]).

---

## 5. Rollout order and risk

Each migration is one commit, one push, applied alone (AGENTS: CI applies only the last commit's new files), verified live after; **nothing here is applied**.
`vehicle_images`, `organization_vehicles` and `vehicles` are public-read tables: run `node scripts/ci/logged-out-live.mjs` after **330, 360** and say "live" only with its output.

| Order | Step | Risk | Gate before applying |
|---|---|---|---|
| 0 | Core garage migration 00 (SPEC) | low | Skylar's approval |
| 1 | **300** helpers | none for clients (additive; tiny-table indexes) | the SPEC tables exist |
| 2 | **340** assignments | low (no reader) | none |
| 3 | **350** work_sessions garage owner | low (adds rows) | a stay exists for his shop (needs PRESENCE data) |
| 4 | Code first: `unifiedImageImportService.ts` sets `submitted_by`; `OrganizationProfile.tsx` reads `org_public_contributors()` | | web PR merged and live |
| 5 | **320** roster | medium (public org page) | step 4; `logged-out-live` |
| 6 | **310** insert | **high** (capture and upload paths) | read the live body of `capture_relay_default_vehicle_fn` (H12); probe a signed-in owner, an org member and the iOS capture insert on a staging-like copy; count signed-in inserts that would fail (the last 30 days of `vehicle_images` rows where `user_id` has no standing) before applying |
| 7 | **370** storage | medium | 310 live |
| 8 | **330** org image scope | medium (gallery reads) | measure how many distinct org members currently read images they would lose (rows where role is not a steward and relationship is not work); `logged-out-live` |
| 9 | **360** owner rights | medium (delete buttons) | UI copy for "superseded, not deleted"; confirm `attribute_image_session` is SECURITY DEFINER |
| later | H8 (permission self-grant), H9, H10 (anon column probe), H11, bucket public flag | | read the live writers first |

Rollback for each is the commented block at the bottom of its file. Policy changes are reversible without data loss; no migration touches rows.

---

## 6. Open questions for Skylar

* **Q-V1** Consigning customer: sees their own consigned car through the garage (this draft) or never (SPEC matrix cell)?
* **Q-V2** Should a technician see that a pre-auction / consignment car is in the place at all (`summary`), or nothing?
* **Q-V3** Managers and work sessions: policy gives the owner the rows (they carry labor rates and invoices); managers get a money-free feed. Change to rank 80 in migration 350 if managers may see money (SPEC Q5).
* **Q-V4** The org steward roles (owner, co_founder, manager, board_member) come from the live link policies. Is a `board_member` allowed to see a consignment car's images?
* **Q-V5** May an owner **delete** a customer's or technician's photo, or only supersede it? 360 chooses supersede.
* **Q-V6** Legacy permission rows with no grantor (59 live) grant nothing through the garage. Backfill `granted_by` after review, or leave?
* Problems found in SPEC.md (not edited): its H3/H4 describe fewer policies than exist (3 permissive INSERT policies of 6 total, 11 UPDATE/DELETE policies); its 9.2 matrix and 9.2 "Consignment" row disagree on the consigning customer; and SPEC says `my_visibility` is "VISIBILITY's call": the full / summary / none rule is section 2.1 here.
