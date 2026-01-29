### Tool Release Plan: Vehicle Mailbox “Work Pipeline”

This is the **single release plan** for shipping the mailbox-first work pipeline as a usable “tool” (not a prototype).

---

## Release goal (what “done” means)

The user can open a vehicle mailbox and reliably execute this loop without broken paths:
- **Message → Draft work order → Publish → Quote → Accept → Proof → Completion request → Finalize**
- The system produces correct DB writes, correct permissions, and correct timeline ingestion.

**No extra workspaces.** Mailbox is the console.

---

## Current status (where we are right now)

### What’s done (end-to-end, with tests)
- **Mailbox-first work pipeline** wired through Phoenix + UI:
  - draft work order
  - publish gating (timeline begins at publish)
  - quotes (create/list) + accept
  - proof upload (creates `work_order_proofs` + timeline event)
  - completion request (tech → owner) (no status change)
  - finalize completion (owner-only) + deliverables gating
- **Permission correctness**
  - quote acceptance grants time-bounded proof access
  - finalize completion auto-revokes proof access (no lingering permissions)
- **Simulation tests**
  - controller-level simulation covers request completion, owner-only completion, deliverables 409, publish gating, and missing access.

### What’s still incomplete (blocked or intentionally deferred)
- **Payments** (real holds/escrow + release on completion)
- **Technician discovery** (matching, notifications, invited visibility)
- **Receipt parsing + line item analysis** (beyond “proof link” MVP)
- **Full “work browsing/search” UI** (we intentionally kept UI minimal)

---

## Visual progress board (you can use this as a “we are on track” checklist)

| Track | Milestone | Done? | Evidence |
|------|-----------|------|----------|
| Core pipeline | Draft → Publish → Quote → Accept | ✅ | API routes + mailbox UI + tests |
| Timeline correctness | Timeline events only on publish/proof/completion | ✅ | Controller logic + tests |
| Permission correctness | Grant proof access on accept | ✅ | `grant_proof_access!` |
| Permission correctness | Auto-revoke on finalize completion | ✅ | `revoke_proof_access!` + tests |
| Deliverables | Completion blocked unless required proofs present | ✅ | 409 + `missing_deliverables[]` |
| UI confidence | Work order panel shows “Progress” stepper | ✅ | Mailbox right panel |
| Payments | Funds committed becomes real escrow | ⏳ | Next major system |
| Technician discovery | Invite + marketplace feed | ⏳ | Next major system |

---

## Demo script (the “tool release” smoke test)

Run this sequence and verify the expected outcomes:

1) **Draft**
- Action: Draft work order from a message
- Expect: `work_orders.status=draft`, `mailbox_messages.work_order` exists

2) **Publish**
- Action: Publish work order
- Expect: `work_orders.is_published=true`, timeline event “Work order published”

3) **Quote**
- Action: Post quote
- Expect: `work_order_quotes` row + `mailbox_messages.quote` (no timeline event)

4) **Accept**
- Action: Owner accepts quote
- Expect:
  - `work_orders.status=approved`
  - `vehicle_user_permissions(role=mechanic, context=work_order:{id})`
  - `mailbox_access_keys(service_provider, conditions.work_order_id=id)`

5) **Proof**
- Action: Tech posts proof
- Expect: `work_order_proofs` row + timeline “Work proof uploaded”

6) **Completion request**
- Action: Tech requests completion
- Expect: `mailbox_messages.work_completed` with `completion_request=true` (no status change)

7) **Finalize**
- Action: Owner finalizes completion
- Expect:
  - deliverables checked (409 if missing)
  - `work_orders.status=completed`
  - timeline “Work completed”
  - proof access revoked (VUP inactive + mailbox key expired)

---

## Near-term release milestones (what we build next)

### Milestone A — “Owner can finish work cleanly” (next)
- Add a small system message on finalize: “Access revoked”
- Add a minimal “Proof list” in the right panel (not just upload inputs)

### Milestone B — “Payments tool” (next major)
- Replace `funds_committed` message with real ledger rows + hold provider integration
- Release on owner finalize completion

### Milestone C — “Technician tool” (next major)
- Invite routing + notifications based on interests
- Minimal technician view of invited work orders (no clutter)


