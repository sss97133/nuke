### Framework samples (choose UI later, lock backend now)

These are patterns + concrete payload shapes to keep the system coherent while UI changes.

---

## 1) Message-as-command (what the user types)

**Raw message**

```json
{
  "type": "work_request",
  "text": "Need undercarriage patched. Budget ~800. Can do at my location. 5 days."
}
```

**Command extracted (agent output)**

```json
{
  "command": "draft_work_order",
  "vehicle_id": "…",
  "title": "Undercarriage patch work",
  "description": "Patch rusted undercarriage sections. Must include before/after photos and timelapse. Complete within 5 days.",
  "urgency": "high",
  "location_mode": "on_site",
  "budget": { "amount_cents": 80000, "currency": "USD" },
  "deliverables": ["before_photos", "after_photos", "timelapse"],
  "constraints": ["complete_within_days:5"]
}
```

**DB writes (authoritative)**
- `mailbox_messages(work_request)` (the raw)
- `work_orders(draft)` (structured)
- `mailbox_messages(work_order)` (links `work_order_id`)
- optional `mailbox_messages(funds_committed)` (money signal)

---

## 2) Event spine (every write produces an event)

Even if UI changes, we keep event semantics stable.

```json
{
  "event_type": "work_order_drafted",
  "actor_user_id": "…",
  "vehicle_id": "…",
  "work_order_id": "…",
  "created_at": "…",
  "metadata": {
    "source": "mailbox",
    "mailbox_message_id": "…"
  }
}
```

Mapping examples:
- `work_order_drafted` → timeline: `service`
- `quote_received` → timeline: `service`
- `quote_accepted` → timeline: `service`
- `funds_committed` → timeline: `custom`

---

## 3) State machine (only a few transitions are allowed)

Work order status transitions are explicit. UI is just a controller for those transitions.

```json
{
  "entity": "work_order",
  "from": "quoted",
  "to": "approved",
  "trigger": "accept_quote",
  "requires": ["quote_id", "actor_user_id"]
}
```

---

## 4) Technician matching (future-safe contract)

Matching is not “magic”: it is a scored query + a logged run.

```json
{
  "work_order_match_run": {
    "work_order_id": "…",
    "algorithm_version": "v1",
    "inputs": {
      "skill_keys": ["body_work.patch_panel"],
      "location": { "mode": "on_site", "lat": 47.6, "lng": -122.3 },
      "time_window": { "start": "…", "end": "…" },
      "budget_cents": 150000
    }
  },
  "top_candidates": [
    {
      "candidate_type": "user",
      "candidate_id": "…",
      "score_total": 0.86,
      "score_breakdown": {
        "skill_fit": 0.42,
        "availability_fit": 0.24,
        "distance_fit": 0.12,
        "trust_fit": 0.08
      }
    }
  ]
}
```

---

## 5) UI principle: avoid “extra pages”

UI should be:
- Message thread + workflow cards
- Right panel for “act on selected thing”
- Notifications drive navigation, not a sprawling dashboard


