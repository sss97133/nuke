# Message handling audit (2026-11-18)

Measured 2026-11-18 between 14:35Z and 16:00Z by a chat session, through the owner's Supabase and GitHub
connectors and a clone at `fe4a6e0`. Reads ran as `postgres`; `anon` and `authenticated` were simulated with
`SET LOCAL ROLE` (and `request.jwt.claims` for a signed-in account). Read-only except the containment in §3.
Counts are exact and carry this date; re-measure before acting on them. No personal data is in this file:
rows are referred to by table, source and count.

## The outcome this serves

The owner's stated outcome (chat, 2026-11-18, paraphrased): a content-completion delivery metric for a
production, measured from the moment an image is taken to the approval of the media package, defined in the
ledger during the production, with messages as the measuring points and their keyed values. His order of
operations: permission for a user, then the targeting of which messages matter, then the metric. Standards come
first (CRM, KPI, marketing and communication standards) and nothing is built ahead of them.

## The answer

**Holding a person's messages already has an owner here for every part except two: an inbound message store
and the media package.** Extend the owners in §1. Do not mint a messages table.

## 1. What exists

| Part | Owner | State on 2026-11-18 |
|---|---|---|
| A person's own statement, one row per message, private, uninterpreted | `record_owner_statement` on `vehicle_observations` (20261117150000); speaker-only read policies | live |
| Permission record (scope, evidence, revocation) | `user_consents` | 0 rows |
| Identity for a handle | `external_identities` (platform x handle) | 11 platform values, none for phone, WhatsApp, iMessage or email |
| Sending to a person (email, SMS, WhatsApp, iMessage) | the gate in `supabase/functions/_shared/outbound.ts`, outbox `outbound_messages` (20261113160000) | 0 rows |
| Citing a message thread as evidence | books rule (20261105190000): the cite names the medium and locates it by a date or an id | live |
| Capture clock and image approval | `vehicle_images.taken_at`, `approval_status`, `approved_at`, `approved_by`; `image_capture_time_claims`; capture sets | live |
| Gates of a delivery | `transfer_milestones` with `transfer_communications` (8 rows: a message linked to a milestone), `concierge_fulfillment_milestones`, `production_stages` (0 rows) | three patterns; choose one, do not add a fourth |

Not present:
- An inbound message store at message grain for any channel. `telegram_message_log` (71 rows) belongs to the
  retired Telegram capability; `contact_inbox` (266 rows) is inbound email.
- A media package entity. No table, function or document described one before this note.

## 2. What the 2026-04-11 load did

A one-off load with no writer in the repository wrote account records into `public.timeline_events`, none
attached to a vehicle:

| source | event_type | rows | rows with user_id |
|---|---|---|---|
| `call_history` | communication | 1,736 | 0 |
| `apple_health_export` | daily_movement | 1,517 | 0 |
| `whatsapp_ingest` | communication | 135 | 135 |
| `call_history_lead_pattern` | other | 73 | 0 |
| `imessage_thread` | communication | 9 | 0 |
| total | | 3,470 | 135 |

- The `whatsapp_ingest` rows are one per chat (135 chats, 46 of them groups). Each is a summary of a chat; the
  `total_messages` values sum to 7,972. Their metadata keys include `contact_name`, `contact_phone` and
  `contact_jid`. They hold no message text, message id or media, so they cannot be the measuring points of a
  delivery.
- `timeline_events` carries the permissive policy "Public can view all timeline events" (`USING (true)`) and
  `anon` holds SELECT, so all 3,470 rows were returned to `anon` and to any signed-in account.

## 3. Containment (#3566, migration 20261118160000)

One RESTRICTIVE select policy, `timeline_events_private_source_read`, in the form of
`owner_statement_private_read`: a row from one of the five sources is readable through the API only by the
account on the row. Applied by Supabase Deploy run 44339617456. Live after the run:

| Reader | Before | After |
|---|---|---|
| `anon` | 3,470 | 0 |
| another signed-in account | 3,470 † | 0 |
| the account on the `whatsapp_ingest` rows | 3,470 † | 135 |

† Not measured before the change; it follows from the same `USING (true)` policy and the SELECT grant to
`authenticated`. The `anon` figures and every "after" figure were measured.

Other rows with no vehicle returned to `anon`: 28,295 before and after. Rows stored: 3,470 before and after.
`logged-out-live` run 44339711339, triggered by the deploy, passed.

## 4. Open

1. **The rows still sit in `timeline_events`.** They belong in a private store. That is a designed move, not a
   DELETE: `tr_delete_timeline_event_image`, `trg_completion_enqueue_timeline_del` and
   `trigger_timeline_events_feed_refresh` fire on delete from this table.
2. **The policy names five sources.** A later load under another source name would be public again. The fix is
   the store, not a longer list.
3. **`search_timeline_events_fulltext`** is SECURITY DEFINER, executable by `anon`, and has no visibility test.
   It fails with 42P01 on every call: its `search_path` is `''` (20260927190000) and its body names
   `timeline_events` unqualified. It returns nothing today. `nuke_frontend/src/services/fullTextSearchService.ts`
   calls it. Give it the visibility test on `vehicles` when it is repaired.
4. **`publishing_contacts`** holds two rows that are a messaging service's notification senders, not people
   (`is_noise` false): the email-archive extractor let service senders through.
5. **Before the metric:** consent rows in `user_consents`; a handle platform for phone and WhatsApp in
   `external_identities`; one gate table chosen; the media package and its approval designed.

## 5. Practice adopted for other people's messages

Agent judgment, adopted at the owner's direction to follow standard practice (2026-11-18); not an owner ruling.

- Keep the derived signal and a pointer: who (a resolved identity), when, what kind (media drop, approval,
  blocker), and the thread by medium and date or id, as the books rule already cites one. Do not store the text
  of other people's messages. The account's own statements keep the verbatim private pattern.
- A personal WhatsApp account has no read API; the route is the person's own export. A WhatsApp Business app
  number can be linked to the provider's Cloud API for a live feed, with a limited history import for
  one-to-one chats and none for groups (provider documentation, read 2026-11-18). 46 of the 135 loaded chats
  were groups.

## How it was measured

```sql
-- the load, by source
select source, event_type, count(*), count(user_id)
from public.timeline_events where vehicle_id is null group by 1, 2;

-- what a reader is returned (run as anon; as a signed-in account set request.jwt.claims first)
set local role anon;
select count(*) filter (where source in ('whatsapp_ingest', 'call_history', 'call_history_lead_pattern',
                                         'imessage_thread', 'apple_health_export')),
       count(*)
from public.timeline_events where vehicle_id is null;
```
