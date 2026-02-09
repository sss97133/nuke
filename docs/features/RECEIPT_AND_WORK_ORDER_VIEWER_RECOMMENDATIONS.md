# Receipt & Work Order Viewer: What’s Wrong and What to Do

## Current state (why it “sucks”)

### 1. **Automotive‑first, one size fits all**
- **WorkOrderViewer** assumes every event is shop work: vehicle, labor rate, parts, labor tasks, “shop” tab.
- Non‑automotive orgs (e.g. Nuke Ltd with git commits) still hit this UI until we added the commit‑only day modal.
- **TechnicianDayReceipt** and **ComprehensiveWorkOrderReceipt** are also vehicle/labor/parts‑centric.
- Result: wrong mental model and empty or irrelevant sections for non‑shop activity.

### 2. **Fragmentation**
- **WorkOrderViewer** – org timeline day click, “Research Terminal,” tabs (overview / parts / labor / photos / shop).
- **ComprehensiveWorkOrderReceipt** – full forensic receipt (participants, parts, labor, materials, tools, quality).
- **TechnicianDayReceipt** – profile contribution timeline day click, day‑level summary.
- **UnlinkedReceipts** – vehicle_documents “receipt” type, link-to-vehicle flow.
- Same idea (“show the receipt/activity for this thing”) is implemented in multiple places with different data and UX.

### 3. **Stubbed / half‑baked**
- WorkOrderViewer **Parts** tab: “Parts list not available” (QuotePartsList removed, never replaced).
- **Labor** tab: “Detailed labor breakdown not available. Shop owners can add itemized tasks for transparency.”
- So two of the main tabs are placeholders, which makes the whole thing feel broken.

### 4. **Heavy and hard to extend**
- WorkOrderViewer is ~1.3k lines and mixes auction view + work order view.
- ComprehensiveWorkOrderReceipt is 2k+ lines.
- Adding a new event type (e.g. “invoice,” “delivery,” “compliance doc”) means more conditionals or another viewer.

### 5. **Data model mismatch**
- Viewer expects `work_order_parts`, `work_order_labor`, `work_order_collaborators`, `image_tags` (shoppable).
- Many timeline events don’t have these; they’re just `business_timeline_events` with `metadata` and maybe `image_urls`.
- So we either show “not available” or empty tabs.

---

## What to do about it

### Option A: **Event‑type–aware “activity detail” (minimal change)**
- **Idea:** One entry point (e.g. “Activity detail” or “Receipt” modal), but **content depends on `event_type`** (and maybe `event_category` / `metadata`).
- **Already done:** Commit‑only days on org heatmap → simple commit list; no WorkOrderViewer.
- **Next steps:**
  - Add more branches: e.g. `event_type === 'invoice'` → invoice-style (vendor, total, line items from metadata); `event_type === 'sale_listing'` → listing summary; etc.
  - When **all** events for the day are non‑work‑order (e.g. commit, invoice, listing), **never** open WorkOrderViewer; use a small, type‑specific card or list.
  - Keep WorkOrderViewer only for events that actually have vehicle + labor/parts (or explicitly “work_order” type).
- **Pros:** Reuses existing components, incremental. **Cons:** Branching can get messy if many event types.

### Option B: **One “Activity card” with pluggable sections**
- **Idea:** Single modal layout: **header (date, org, title)** + **list of sections**. Each section is a component chosen by event type and available data.
- **Sections (examples):**
  - **Commit:** message, link to repo/commit (like current commit-day modal).
  - **Work order:** vehicle, labor summary, parts (if tables populated), photos.
  - **Invoice/receipt:** vendor, total, line items (from universal receipt parsing or metadata).
  - **Auction:** lot, platform, bid/result, link to listing.
  - **Generic:** title + description + attachments/photos.
- **Data:** Prefer `business_timeline_events` + `metadata` as source of truth; optionally join `work_order_*` / `vehicle_documents` when present.
- **Pros:** One place to open “the receipt” from timeline, org heatmap, profile, etc.; easier to add new types. **Cons:** Requires a small “section registry” and refactor of where the modal is opened.

### Option C: **Fix the automotive path first**
- **Idea:** Don’t redesign everything; make the **shop** path good so at least that one doesn’t suck.
- **Concrete:**
  - Replace “Parts list not available” with either (1) real parts from `work_order_parts` + `image_tags` (you already load them) or (2) a clear empty state: “No parts recorded for this event. Add parts in the work order form.”
  - Replace “Detailed labor breakdown not available” with either (1) real labor from `work_order_labor` or (2) a single labor summary line (hours × rate) when only `event.labor_hours` + org labor rate exist, plus empty state: “Add itemized tasks for a full breakdown.”
  - Hide or soft-hide tabs that are empty (e.g. “Parts” only if there are parts or a clear CTA to add them).
- **Pros:** Quick wins, no new architecture. **Cons:** Still automotive‑only; non‑shop events still need a different path (which Option A/B address).

### Option D: **Unified “receipt” schema and one viewer**
- **Idea:** Define a single **receipt view model** (e.g. title, date, vendor/org, line items, attachments, optional vehicle, optional labor summary) and map every event type into it. One viewer component that only knows this schema.
- **Pros:** One UI, one place to polish. **Cons:** Bigger refactor; some event types don’t map cleanly to “line items” (e.g. commits).

---

## Recommended direction

- **Short term:** Do **Option A + Option C** together:
  - Route by event type so non‑automotive (commit, invoice, etc.) never see WorkOrderViewer; they see a small, type‑specific view (like the commit list).
  - Fix WorkOrderViewer’s stubbed Parts and Labor tabs (real data or clear empty states + CTAs) and hide/disable empty tabs so the automotive receipt doesn’t feel broken.
- **Medium term:** Move toward **Option B** (one activity modal with pluggable sections keyed by event type + data). That gives you a single “receipt” entry point and a clear place to add new types (e.g. compliance docs, deliveries) without more one‑off viewers.

If you want to prioritize one file: **WorkOrderViewer** is the one that runs when you click an org timeline day (for non‑commit events) and currently has the most visible stubs; fixing that plus the event-type routing (commit vs work order) will already make receipts feel a lot better.
