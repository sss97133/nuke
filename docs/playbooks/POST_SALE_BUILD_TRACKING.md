# Post-Sale Build Tracking Playbook

**Origin:** Session 2026-03-26. User asked "update me on the Granholm build." System failed completely — couldn't resolve the name, the vehicle, the deal, or the work history. This playbook exists so that never happens again.

---

## The Problem Statement

When a user says "the Granholm truck" or "the blue truck" or "the K20 I was working on," the system must resolve that instantly from context. The user will never give you a UUID. They will never pull out receipts. The fact that they are talking to you IS the opportunity. One fumble and trust is gone.

## The Receptionist Model

The system is the receptionist. It already has:
- **iMessage history** — `~/Library/Messages/chat.db` (every text, every photo exchanged with every contact)
- **Gmail** — every receipt, every order confirmation, every invoice
- **QuickBooks** — every bank transaction across all linked accounts
- **Photos** — `~/Pictures/Photos Library.photoslibrary` (72+ albums, osxphotos CLI)
- **Claude Code sessions** — `~/.claude/projects/` (158+ session files with full conversation history)
- **The database** — vehicles, work orders, deal jackets, parts, labor, invoices

When a user has 5 vehicles and says a name, a color, or a nickname, the system has a **100% match denominator**. Cross-reference the name against contacts in texts, the vehicle against the 5 in the database, and resolve.

---

## What Must Exist (The Harness)

### 1. User Context Layer (onboarding)
When a user is onboarded, process their entire archive:
- **iMessage backfill** — extract all conversations, identify contacts, link to discovered_persons
- **Gmail receipt mining** — parse all order confirmations (Amazon, Summit, AutoZone, O'Reilly, eBay, etc.) into itemized line items with prices
- **QuickBooks sync** — ALL accounts, ALL cards (BDCU, AFCU nuke, AFCU personal, any others)
- **Photos intake** — already partially working (osxphotos → user_photo_inbox)
- **Session mining** — grep all .jsonl session files for vehicle references, build session_narratives

This is ~100GB per user. It's the onboarding cost. After this, the user can say anything and the system resolves it.

### 2. Contact-Vehicle Resolver
Given a name (e.g., "Granholm"), resolve to a vehicle by:
1. Search `work_orders.customer_name`
2. Search `deal_contacts`, `discovered_persons`, `deal_jackets`
3. Search iMessage contacts → find conversations → identify vehicle references
4. Search Gmail for the name → find related transactions
5. With the user's vehicle list (5 vehicles), fuzzy match from any of the above

The resolver should return a result in <1 second for any reasonable input:
- Person name → vehicle
- Vehicle nickname → vehicle
- Color + type ("the blue truck") → vehicle
- Recency ("the one I've been working on") → vehicle with most recent activity

### 3. Parts Inventory Layer
Every purchase is an inventory event:
- **Ingest**: Gmail receipt → itemized parts with prices, vendor, date, order number
- **Link**: Match parts to intended vehicle (from context: what was being discussed that day in texts)
- **Stock**: Track what's on hand vs. consumed
- **Consume**: When a part is installed, debit from inventory, credit to vehicle build
- **Transfer**: When a part moves between vehicles (Blazer Borlas → K2500), create transfer record, flag reorder need
- **Reorder**: When consumed part was originally for another vehicle, auto-generate reorder list

Sources:
- Amazon order confirmations (Gmail) — item-level detail
- Summit Racing receipts (Gmail) — item-level detail
- QuickBooks bank feed — transaction-level (no item detail, needs Gmail cross-reference)
- O'Reilly/AutoZone/NAPA — bank feed + potentially Gmail receipts
- eBay purchases — Gmail confirmations

### 4. Daily Digest
Every night, automatically generate:
- **Per vehicle**: what work was done (from texts/photos), what parts were consumed, what money moved
- **Per deal**: current balance (invoiced vs. paid), work status, scope changes
- **Per user**: total spend across all vehicles, reorder needs, upcoming commitments
- **Alerts**: invoice unpaid >7 days, scope creep beyond original estimate, parts consumed from other vehicles

### 5. Deal Jacket Auto-Population
When a vehicle is sold:
1. Create deal jacket automatically from BaT/auction data
2. Link buyer as contact (from iMessage, email, or auction platform)
3. If post-sale work is contracted, create work order linked to deal
4. Track all subsequent communication (texts, emails) as deal activity
5. Track all parts purchases and labor as work order line items
6. Generate/update invoice automatically as work progresses

### 6. Session-to-Vehicle Logging
Every Claude Code session that discusses a vehicle should:
1. Identify which vehicle(s) were discussed
2. Write a session_narrative record linking session → vehicle
3. Capture key decisions, scope changes, pricing agreements
4. This is the "ground truth per day" — what happened, what was decided, what changed

---

## The Granholm Case Study — What Should Have Happened

### Day 1 (Feb 21): Dave texts from BaT auction
- System sees new iMessage from unknown number
- Parses: "Dave Granholm from your BaT auction" + references to parking brake
- Auto-creates contact: Dave Granholm, (845) 300-2345
- Resolves vehicle: the only active BaT auction = 1983 GMC K2500
- Links contact → vehicle
- Starts deal timeline

### Day 2-3 (Feb 22-23): Negotiation and parts discussion
- Texts about shocks, steps, hood insulation → captured as deal activity
- Dave sends Carr hoop step link → logged as proposed part
- Price agreements ($400 labor, $415 shocks) → logged as quotes
- Wire instructions, deposit discussion → deal jacket financial data

### Day 7 (Feb 27): Invoice session
- Claude Code session creates work order, invoice, parts list
- Session narrative auto-written linking to K2500
- Invoice sent to Dave via nuke.ag

### Day 10 (Mar 2): Scope change — steps
- Dave texts "hold off on hoop steps" → Carr hoops removed from WO
- Dave texts "ordered retractable steps from David Offroad" → new part added as customer-supplied
- Work order updated automatically

### Day 11-35 (Mar 3-26): Ongoing work
- Every text with photos → logged as build progress
- Every Amazon order with exhaust parts → linked to K2500
- Every Summit order → correctly linked to K2500 (not Blazer)
- Borla mufflers moved from Blazer → transfer event, Blazer flagged for reorder
- Daily digest shows Dave: invoice unpaid, work in progress, scope expanded

### Today (Mar 26): User asks "update me on the Granholm build"
- System instantly resolves: Granholm → Dave Granholm → K2500
- Pulls: work orders (3), parts consumed (all Amazon + Summit + Blazer transfers), labor done, photos sent, texts timeline, payments received, invoice status
- Presents: here's everything, here's what he owes, here's what's left

---

## Accounts to Link

| Account | Institution | Number | Status |
|---------|------------|--------|--------|
| Nuke LLC | AFCU | 45458288 | In QB — feeding transactions |
| Personal | AFCU | 40949604 | **NOT in QB — needs linking** |
| Personal | BDCU | ending 1502 | **NOT in QB — needs linking** |
| Second QB | unknown | unknown | **May exist — user to confirm** |

---

## Blazer Reorder List (from K2500 consumption)

Parts originally purchased for the 1977 Chevrolet Blazer (e04bf9c5) that were consumed on the K2500 Granholm build:

| Part | Source | Original Order | Est. Cost |
|------|--------|---------------|-----------|
| Borla mufflers (x2) | Blazer inventory | unknown date | TBD |
| 2.5" 304 SS tubing kit (1 box) | Blazer inventory | unknown date | ~$90 |
| Exhaust expanders | Blazer inventory | unknown date | TBD |
| Flange connectors | Blazer inventory | unknown date | ~$22 |

---

## Financial Tracking Gap (CRITICAL)

QB only pulls **Purchases** (2,712) and **Invoices** (49). **Zero deposits. Zero income. Zero payments received.**

The `qb-pull-purchases.mjs` script literally only queries purchases. Nobody built the income/deposit pull. Dave's Zelle payments to nukebank are invisible to the system.

### What we know from texts (testimony only):
- Bilstein Zelle received ~Mar 2 (confirmed in iMessage: "I just received the bilstein Zelle")
- $3,100 deposit discussed Feb 23 (10% of $31K sale)
- Additional Zelles sent — amounts unknown, need AFCU nukebank statement

### What we spent (post-sale work, confirmed):
- **Exhaust total: ~$1,812** (Amazon $454.50 + Summit QTP $617.48 + Borla transfer ~$420 + Blazer transfers ~$170 + dark card ~$150)
- **Bilstein shocks: ~$448**
- **Hood insulation: $45.99**
- **Master cylinder: $66.99**
- **Rear brake rebuild: ? (BDCU — wheel cylinders, pads, hardware, DOT 3)**
- **Window motor: ~$50 (comped)**
- **Tail shaft seal, belts, consumables: ? (BDCU)**
- **Confirmed parts spend: ~$2,423+**
- **Estimated total with dark card: ~$2,600-2,800**
- **Labor: 30+ days, daily work, not yet priced**

### To close the balance:
1. Pull AFCU nukebank (45458288) statement for incoming Zelles from Dave
2. Pull BDCU statement for all auto parts store purchases Feb 21 - present
3. Build QB income pull (deposits, sales receipts, payments received)
4. Reconcile: Dave's total payments - your total costs = balance

### Receipt photos
User took photos of physical receipts (O'Reilly, True Value, etc.) — likely in Photos library or iMessage thread. Need to find and OCR them. Image size issue reported — investigate iMessage attachment extraction for HEIC files.

---

## Exhaust BOM — Complete (from user testimony + Gmail + Summit)

| # | Part | Source | Cost | Status |
|---|------|--------|------|--------|
| 1 | Collectors (header) | Amazon (different email?) | ? | Receipt missing |
| 2 | Bolts/plugs | True Value (BDCU) | ~$15 | Dark card |
| 3 | Gaskets | O'Reilly (BDCU) | ? | Dark card |
| 4 | Pipe kit (1) — original nicer set | Blazer inventory | ~$150+ | Transfer |
| 5 | Flex/expanders x2 (~$40 ea) | Blazer inventory | ~$80 | Transfer |
| 6 | Pipe holding kit | ? | ~$60 | Unknown source |
| 7 | TIG rod ER308L 1/16" SS | Amazon 3/11 | $16.99 | Gmail confirmed |
| 8 | Tacking bands | Amazon 3/11 | $69.95 | Gmail confirmed |
| 9 | Hangers (4 total) | Amazon 3/16 + 3/26 | $42.58 | Gmail confirmed |
| 10 | QTP cutout kit QTEC50CP + turndowns | Summit 3/17 #6242597 | $617.48 | Summit + Gmail confirmed |
| 11 | Borla 40842S mufflers x2 + tax | Blazer inventory (eBay 2023) | ~$420 | Transfer — reorder needed |
| 12 | 2.5" SS tubing kit (1 box) | Blazer inventory | ~$90 | Transfer — reorder needed |
| 13 | Flange connectors 3-bolt | Amazon 3/11 | $21.99 | Gmail confirmed |
| 14 | 45° mandrel bends | Amazon 3/11 + 3/26 | $39.98 | Gmail confirmed |
| 15 | 90° mandrel bends 8pk | Amazon 3/26 | $26.99 | Gmail confirmed |
| 16 | Pie cuts (2 packs) | Amazon 3/11 + 3/26 | $47.76 | Gmail confirmed |
| 17 | DNA Motoring tubing kit 8pc | Amazon 3/11 | $90.23 | Gmail confirmed |
| 18 | Straight pipe 2.5" x 48" (2pc) | Amazon 3/11 | $61.97 | Gmail confirmed |
| 19 | Pipe kit (2) — Amazon reorder | Amazon 3/26 | $98.02 | Gmail confirmed |
| | **TOTAL** | | **~$1,812** | |

Note: NOT a Y-pipe. It's straight piping. User corrected this.

---

## Blazer Reorder List (from K2500 consumption)

| Part | PN | Est. Cost | Original Source |
|------|----|-----------|----------------|
| Borla S-Type Muffler 2.5" x2 | 40842S | ~$420 w/tax | eBay 2023 |
| 2.5" 304 SS tubing kit | ? | ~$90 | Unknown 2023 |
| Exhaust expanders/flex x2 | ? | ~$80 | Unknown |
| Flange connectors | ? | ~$22 | Unknown |
| **Total reorder** | | **~$612** | |

---

## Summit Racing Account (full order history saved)

Saved to `/Users/skylar/Downloads/Order History.html` — 10 orders from Sep 2024 to Mar 2026.
No Borla on Summit. Borlas were eBay 2023 on different email/card.

---

## Implementation Priority

1. **Contact-Vehicle Resolver** — so "Granholm" works instantly
2. **Gmail receipt mining → parts inventory** — so Amazon/Summit orders auto-itemize
3. **QB income/deposit pull** — so payments received are visible (currently ZERO income in QB)
4. **iMessage backfill pipeline** — so text history is searchable and linked to vehicles
5. **QB multi-account sync** — BDCU + AFCU personal feeds
6. **Parts inventory with cross-vehicle transfers** — so Blazer→K2500 moves are tracked
7. **Daily digest cron** — automated nightly reconciliation
8. **Session-to-vehicle auto-logging** — every Claude session links to vehicles discussed
9. **Receipt photo OCR** — physical receipts photographed → itemized into parts ledger
