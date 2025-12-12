### Vehicle Work Pipeline (Release Prep)

This document defines the **mailbox-first** workflow for getting work done on a vehicle.

#### Core principle
- **All user work starts as a message**.
- The system’s job is to convert raw language into a structured workflow with minimal friction.

---

### Entities (DB)

#### Mailbox (communication layer)
- **`public.vehicle_mailboxes`**: 1 mailbox per vehicle.
- **`public.mailbox_access_keys`**: relationship + permission model for who can read/write in a vehicle mailbox.
- **`public.mailbox_messages`**: the inbox stream (human + workflow events).

**Mailbox message types (workflow vocabulary)**
- **Human**: `user_message`, `comment`
- **Work pipeline**: `work_request`, `work_order`, `quote`, `acceptance`, `status_update`, `work_completed`, `receipt`
- **Money signal**: `funds_committed` (aliases allowed, but canonical in UI/agent is `funds_committed`)
- **Service synonyms**: `service_request`, `service_order`, `service_completed` (allowed synonyms)

#### Structured work request (routing layer)
- **`public.work_orders`**: a structured service/work request (draft → pending → quoted → approved → …).
  - This is the canonical “service ticket” record for routing to orgs/technicians.

#### Work items (vehicle planning layer)
- **`public.vehicle_work_items`**: the owner’s “things to do” list per vehicle (status, budget, hold intent, visibility).
- **`public.vehicle_work_item_holds`**: optional hold indicator per work item (provider integration can come later).

---

### Pipeline (end-to-end)

#### 1) User writes a message (raw)
- UI: Vehicle mailbox composer
- DB write:
  - Insert `mailbox_messages` row with `message_type = work_request` (or `user_message` for generic notes)

#### 2) Agent drafts a work order (structured)
- Goal: the user should not have to fill forms.
- DB writes:
  - Insert `work_orders` row with `status = draft`, `request_source = mailbox`
  - Insert `mailbox_messages` row with `message_type = work_order` and `metadata.work_order_id`

#### 3) Optional: funds committed signal
- DB write:
  - Insert `mailbox_messages` row with `message_type = funds_committed` and `metadata.amount_cents/currency/work_order_id`

#### 4) Optional: extract “work items” for planning
- DB write:
  - Insert 1+ `vehicle_work_items` rows derived from the message/work order

#### 5) Routing + quoting (future wiring)
- The system proposes relevant technicians/orgs and collects quotes.
- DB writes (planned):
  - `mailbox_messages` `quote` messages referencing quote ids
  - `mailbox_messages` `acceptance` when approved
  - `mailbox_messages` `status_update` during execution
  - `mailbox_messages` `receipt` with proofs + receipts attached

---

### Release checklist (minimum shippable)
- **Mailbox composer can create a draft work order** (no manual job desk required).
- **Access control**: mailbox access keys define who can write the mailbox and create work items.
- **Terminology**: user-facing language uses **work/service**, not “job”.


