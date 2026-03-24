# iMessage as Transit: The Conversational Interface to Nuke

**Status:** Live
**Created:** 2026-03-22
**Files:** `scripts/imessage-bridge.mjs`, `supabase/functions/imessage-router/index.ts`

---

## The Transcript Thesis

SMS was born in 1992 as a signaling channel repurposed for humans. 160 characters. No multimedia. No internet. Just text over a control channel that was already there, doing nothing between calls. That constraint — borrowed bandwidth on borrowed infrastructure — is exactly what made it universal. It worked on every phone, every carrier, every country. No app. No account. No onboarding.

Texting succeeded because it reduced the cost of communication to near-zero friction. You didn't need to be in the same room, on the same call, or even awake at the same time. The message waited. The conversation accumulated. And that accumulation — **the transcript** — became the most valuable data structure in consumer technology.

Every major tech company of the last decade has been fighting to own the messaging layer: WhatsApp ($19B acquisition), WeChat (1.3B users), Telegram, Signal, iMessage. Not because messaging is hard to build, but because **whoever owns the transcript wins**. The conversation log contains:

- **Intent signals** — what someone wants to do, before they do it
- **Temporal patterns** — when they're active, how quickly they respond
- **Social graph** — who they talk to, how often, about what
- **Decision history** — what they chose, what they rejected, what they deferred
- **Media archive** — every photo shared is a document, every link is a lead
- **Trust relationships** — who they believe, who they question

This is why Apple guards iMessage with platform lock-in. This is why Meta paid $19B for WhatsApp's user-to-user transcript. This is why WeChat became the operating system of Chinese commerce. The transcript is the product.

---

## Why iMessage

For Nuke — a vehicle data system built on the principle that "the database IS the vehicle" — the owner's iMessage is the most natural ingestion point. It is the most barebone service aside from a phone call.

**Zero friction.** iMessage is already open. It's the default reflex. No context switch, no app to launch, no URL to remember. You just text.

**Full resolution.** iMessage photos are uncompressed originals. Telegram compresses. MMS compresses. iMessage preserves the EXIF, the GPS, the full sensor data. Every photo is a forensic-grade observation.

**Free.** Twilio SMS costs $0.0079/message + $0.02/MMS. iMessage costs $0. At 100 messages/day, that's $47/month saved on transport alone.

**Reactions as input.** Tapback (thumbs up, heart, question mark) is a natural approval/rejection mechanism built into the protocol. No buttons to build, no UI to maintain. The user already knows the gesture.

**The conversation already exists.** The owner already texts about vehicles — sharing photos, discussing deals, noting mileage. That data currently evaporates into the void between read receipts. We're just capturing what's already happening.

**Barebones.** iMessage is the most minimal service layer aside from a phone call. No feeds, no stories, no algorithmic timeline. Just messages. That simplicity maps perfectly to a database interface.

---

## The Philosophy: Interface Disappearance

The best interface is no interface. When you text a friend "check out this truck" and attach a photo, you're performing data entry — you just don't know it. The iMessage bridge makes that implicit data entry explicit. The user texts naturally. The database grows.

This follows Nuke's core architecture: every data point is an observation with provenance. An iMessage text about a vehicle is **testimony** from the owner (trust=1.0, the highest possible). A photo sent via iMessage is a **visual observation** with timestamp, GPS, and device metadata. The conversation IS the intake form.

The path from user intent to database record:

```
User thinks: "I changed the oil on the blazer today"
User texts:  "changed oil today"
Bridge reads: chat.db ROWID 30500
Router classifies: intent=data_entry, vehicle=active(blazer)
Observation created: source=imessage, kind=work_record, trust=1.0
Database grows: vehicle_observations += 1
```

No form. No dropdown. No save button. The message IS the record.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  iMessage (Messages.app on Mac)                         │
│  ~/Library/Messages/chat.db (SQLite, ~22K messages)     │
│  ~/Library/Messages/Attachments/ (photo files)          │
└────────────────┬────────────────────────────────────────┘
                 │ SQLite poll every 2 seconds
                 │ Read new messages by ROWID cursor
                 ▼
┌─────────────────────────────────────────────────────────┐
│  imessage-bridge.mjs (local Mac launchd daemon)         │
│                                                         │
│  Reads chat.db → uploads photos → POSTs to router       │
│  Receives response → sends reply via AppleScript        │
│  Converts HEIC→JPEG via sips                            │
│  Persists cursor in DB + local file fallback            │
└────────────────┬──────────────┬─────────────────────────┘
                 │              ▲
     POST /imessage-router     │ {reply: "plain text"}
                 │              │
                 ▼              │
┌─────────────────────────────────────────────────────────┐
│  imessage-router (Supabase edge function)               │
│                                                         │
│  1. Load conversation (imessage_conversations table)    │
│  2. Classify intent via Haiku ($0.003/msg)              │
│  3. Route to existing Nuke handler                      │
│  4. Format response for iMessage (plain text, <500ch)   │
│  5. Update conversation state + message history         │
│                                                         │
│  Intent routing:                                        │
│  ┌────────────────────────────────────────────────────┐ │
│  │ "find me a 70 chevelle"    → vehicle search (DB)   │ │
│  │ [photo of truck]           → image-intake          │ │
│  │ "bringatrailer.com/..."    → import_queue          │ │
│  │ "status"                   → system brief          │ │
│  │ 👍 tapback                 → execute pending       │ │
│  │ "talk about the blazer"    → set active vehicle    │ │
│  │ "changed oil today"        → ingest-observation    │ │
│  │ "what should I do next?"   → coaching/ARS          │ │
│  │ "what's it worth?"         → market comps          │ │
│  │ "hey"                      → conversational (LLM)  │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

---

## Channel Comparison

| Dimension | iMessage | SMS/Twilio | Telegram | Email |
|-----------|----------|------------|----------|-------|
| Cost/msg | $0 | $0.0079+MMS | $0 | $0 |
| Photo quality | Full res + EXIF | Compressed | Compressed | Full |
| Latency | ~2s poll | Instant webhook | Instant webhook | ~2min poll |
| Reactions | 6 tapback types | None | Inline buttons | None |
| Setup friction | Zero | Phone number | Bot + /start | Email rules |
| Platform | Apple only | Universal | Universal | Universal |
| Infrastructure | Mac must be on | Cloud | Cloud | Local daemon |
| User persona | Owner (self) | Technicians | Technicians | Alerts |

---

## Tapback as Approval

iMessage tapback reactions map to chat.db `associated_message_type`:

| Type | Code | Nuke Action |
|------|------|-------------|
| Loved (heart) | 2000 | Approve + flag as notable |
| Liked (thumbs up) | 2001 | Approve pending action |
| Disliked (thumbs down) | 2002 | Deny/skip pending action |
| Laughed | 2003 | No action |
| Emphasized | 2004 | No action |
| Questioned | 2005 | No action |

When the router sends a message requiring approval (e.g., "Post this to BaT? 👍 to approve, 👎 to skip"), it stores the message GUID in `imessage_conversations.pending_action_message_guid`. The bridge detects tapbacks on that GUID and routes them back as approval/denial.

---

## Data Model

### imessage_conversations

One row per active chat. Stores conversation context, vehicle focus, pending approvals, and the bridge cursor.

| Column | Type | Purpose |
|--------|------|---------|
| chat_identifier | TEXT | iMessage handle (+phone or email) |
| active_vehicle_id | UUID | Currently focused vehicle |
| active_vehicle_name | TEXT | Cached display name |
| recent_messages | JSONB | Last 20 messages for LLM context |
| pending_action_type | TEXT | What's awaiting approval |
| pending_action_data | JSONB | Data to execute on approval |
| pending_action_message_guid | TEXT | Which outbound message to watch |
| last_processed_rowid | BIGINT | Bridge cursor in chat.db |

### observation_sources entry

`imessage` registered with trust=1.0 (owner category). All iMessage text and photos flow through `ingest-observation` with full provenance — the observation system doesn't need to know it came from iMessage specifically, just that it's owner-provided testimony at maximum trust.

---

## Integration Map

| When user sends... | Intent | Existing handler | What happens |
|---------------------|--------|-----------------|--------------|
| Photo(s) | photo_submission | `image-intake` | Upload to storage, AI classify, match to vehicle |
| Vehicle listing URL | url_submission | `import_queue` INSERT | Queued for extraction at priority 7 |
| Vehicle data ("mileage 45000") | data_entry | `ingest-observation` | Observation created with source=imessage |
| "status" | status_check | `ralph-wiggum` brief | Queue health + vehicle count |
| "find me a blazer" | vehicle_search | Direct DB query | Numbered list of matches |
| "1" (number after list) | number_selection | Context from recent_messages | Sets active vehicle |
| "what should I do next?" | coaching | Photo/data gap analysis | Missing fields list |
| "what's it worth?" | market_query | Comparable sales query | Price range + avg |
| 👍 on pending message | tapback | Pending action execution | Post approved / import confirmed |
| 👎 on pending message | tapback | Pending action cancellation | Action skipped |
| Casual text | general | Haiku conversational | Short friendly response |

---

## Cost Model

| Operation | Model | Cost/msg |
|-----------|-------|----------|
| Intent classification | Haiku | ~$0.003 |
| Simple response | Haiku | ~$0.003 |
| Vehicle search/query | Sonnet | ~$0.015 |
| Photo analysis (via image-intake) | Sonnet vision | ~$0.02 |
| Data entry parsing | Haiku | ~$0.003 |
| URL import | No LLM | $0 |

**At 100 messages/day:** ~$0.76/day, ~$23/month
**Versus Twilio SMS at same volume:** $47/month just for transport

---

## Operations

### Start the bridge

```bash
# Single run (process pending, exit)
dotenvx run -- node scripts/imessage-bridge.mjs --chat "+17029304818"

# Daemon mode (continuous 2s poll)
dotenvx run -- node scripts/imessage-bridge.mjs --daemon --chat "+17029304818"

# Dry run (log what would happen, don't reply)
dotenvx run -- node scripts/imessage-bridge.mjs --dry-run --chat "+17029304818"
```

### Install as launchd daemon

```bash
cp scripts/com.nuke.imessage-bridge.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.nuke.imessage-bridge.plist
```

### Check status

```bash
dotenvx run -- node scripts/imessage-bridge.mjs --status
tail -f /tmp/imessage-bridge.log
```

### Reset cursor (skip all existing messages)

```bash
dotenvx run -- node scripts/imessage-bridge.mjs --reset --chat "+17029304818"
```

---

## Prerequisites

- **Full Disk Access** granted to Terminal.app (System Settings > Privacy > Full Disk Access)
- **better-sqlite3** npm package installed (`npm i better-sqlite3`)
- **Messages.app** running (chat.db must exist)
- **Mac must be on** — this is a local bridge, not cloud infrastructure

---

## How It Fits Into Nuke

iMessage joins the existing intake family:

| Script | Source | What it captures |
|--------|--------|-----------------|
| `photo-sync.mjs` | Camera Roll | Vehicle photos via Apple ML labels |
| `mail-app-intake.mjs` | Mail.app | Vehicle listing URLs from email alerts |
| `iphoto-intake.mjs` | Photos Library | Organized album photos → vehicle records |
| `fb-marketplace-local-scraper.mjs` | Facebook | Vintage vehicle listings nationwide |
| **`imessage-bridge.mjs`** | **iMessage** | **Everything: photos, URLs, data, commands, approvals** |

iMessage is the first **fully conversational** interface. The others are unidirectional data capture. This one talks back.
