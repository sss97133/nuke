# Org Definition and Vehicle–Org Claims

## Definition of an org

**An organization is any persistent entity that could, in theory, have a business license.**

- Dealers, auction houses, restoration shops, marketplaces: orgs.
- A BaT seller with 10+ listings: treated as an org (promoted seller).
- A named collection (e.g. “Smith Family Collection”): an org; collections are a **subset** of orgs, not a separate concept.
- Observation sources (BaT, Rennlist, Hagerty, etc.): each is an org; they have identity and produce data.

So: one concept (“org”), many ways to become one (source, seller, collection, dealer, etc.). The canonical table is **businesses**; we use it as the org table. Collections are orgs with a specific role/type, not a different table.

---

## Multiple orgs can “lay claim” to the same vehicle

One vehicle can have several orgs with different **roles** in its history:

| Role | Who | What they did / get |
|------|-----|----------------------|
| **Auction platform** | BaT, C&B, RM Sotheby’s | Ran the sale; made their cut. |
| **Dealer / consignor** | Dealer who consigned | Their cut; vehicle shows in their inventory/sold. |
| **Seller** | Entity that sold (may be dealer or private) | Got proceeds; vehicle shows in their “sold” list. |
| **Buyer** | Purchaser (person or org) | Paid fees to acquire; vehicle in their portfolio. |

So the same vehicle shows up in multiple org profiles, with **different relationship types**. Counts (“how many vehicles does this org have?”) must be defined per role or per “claim,” not as a single global “owner.”

---

## Where this lives today

- **businesses**  
  The org table. One row per org (dealer, auction house, promoted seller, observation source, collection, etc.).

- **organization_vehicles**  
  Links (org, vehicle, **relationship_type**). This is the table that should represent every “claim”: who had which role on this vehicle.  
  - **Trigger:** `total_vehicles` on `businesses` is updated from `COUNT(*)` of `organization_vehicles` for that org.  
  - So **if a claim isn’t in `organization_vehicles`, that org’s vehicle count is wrong.**

- **Current `relationship_type` (CHECK):**  
  `owner`, `consigner`, `service_provider`, `work_location`, `sold_by`, `storage`.  
  - No `auction_platform` (platform that ran the sale).  
  - No `buyer` (purchaser org).  
  - So auction-house and buyer claims aren’t modeled.

- **bat_listings**  
  Has `organization_id` (seller org) and `vehicle_id`.  
  - That does **not** automatically create `organization_vehicles` rows.  
  - So seller orgs from BaT often have **no** rows in `organization_vehicles` → their `total_vehicles` stays 0 or wrong.  
  - BaT-as-platform also never gets a row (no `auction_platform` type).

- **external_listings**  
  Same idea: `organization_id` exists but isn’t necessarily mirrored into `organization_vehicles`.

So: **the missing piece is not really “a missing table like businesses.”** The table is `organization_vehicles` (and `businesses` as the org table). What’s missing is:

1. **Relationship types** that cover all claims: e.g. add `auction_platform`, `buyer` (and keep `sold_by` / `consigner` for seller/dealer).
2. **Consistent writes** from every source of truth into `organization_vehicles`:  
   - When we have a listing (BaT, external, etc.), insert the right rows: e.g. seller org + `sold_by` or `consigner`; platform org + `auction_platform` if we want platform counts.
3. **Backfill** so existing `bat_listings` / `external_listings` create the corresponding `organization_vehicles` rows (and, if desired, platform rows).  
Then `total_vehicles` (and any role-specific counts) will reflect reality.

---

## Why org vehicle counts are wrong

- **Only `organization_vehicles` drives `total_vehicles`.**  
  So any org whose “claims” exist only in `bat_listings.organization_id` or `external_listings.organization_id` (and not in `organization_vehicles`) will show 0 or an undercount.
- **Multiple claims per vehicle aren’t fully modeled.**  
  Auction platform and buyer aren’t in the CHECK; so even if we wanted to, we can’t yet record “BaT ran this sale” or “this org bought it” in `organization_vehicles`.
- **No automatic sync** from listings → `organization_vehicles`.  
  So new listings don’t create claims unless something else (e.g. a trigger or job) does it.

Fixing this means: extend relationship types, add sync (trigger or job) from listings into `organization_vehicles`, and backfill. Then “a ton of orgs not showing the accurate amount of vehicles” should improve.

---

## Summary

- **Org** = anything that could have a business license. **Collections ⊂ orgs.** One org table: **businesses**.
- **One vehicle, many orgs:** auction platform, dealer/consignor, seller, buyer. Each is a **claim** with a **role**.
- **Canonical place for claims:** **organization_vehicles** (org_id, vehicle_id, relationship_type).  
  Missing: role set doesn’t include auction_platform/buyer; and listing tables don’t consistently write into `organization_vehicles`, so counts are wrong.
- **Next steps:**  
  1. Add relationship types (e.g. `auction_platform`, `buyer`) and any constraints.  
  2. Sync `bat_listings` / `external_listings` → `organization_vehicles` (seller + optional platform).  
  3. Backfill existing listings so every org’s vehicle count is accurate.
