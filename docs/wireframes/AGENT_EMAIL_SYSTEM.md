# Agent Email System – Wireframe & Interaction Model

## Concept
- Email-style threads with an AI agent that executes secure actions.
- Think “Cursor-like” requests via messages; replies are instant.
- Vehicle profiles behave like files; garages/organizations behave like repos.
- Ownership can transfer between garages (orgs) similar to repo ownership.

## Core UX (Gmail-style)
### Layout
- **Left Sidebar**: Folders (Inbox, Action Required, Approved, Archived), Filters (Org, Vehicle, Type, Risk).
- **Thread List**: Subject, snippet, timestamp, unread badge, risk/priority pill.
- **Thread View**: Stacked messages (user + agent), action cards, attachments (vehicle cards, work items, documents).
- **Composer**: Plain text box + quick chips (“Approve all high confidence”, “Show pending ownership claims”).
- **Assistant Panel (optional)**: Suggestions, batch actions, summaries.

### Message Types
- **User Message**: Free text (“Approve all Viva work >90%”, “Here’s my title, claim this vehicle”).
- **Agent Response**: Status + actions + proof:
  - Action buttons: Approve / Reject / Forward / View Details / Start Biometric.
  - Cards: Vehicle card, Work approval card, Ownership claim card.
  - Status: success / needs approval / blocked (permission) / needs biometric / low-confidence.

### Sample Thread (Ownership Claim)
1. **User**: “Here’s my title, claim this vehicle. VIN 1GKE…”
2. **Agent**: “Processing… extracted name/VIN, no conflicts, authenticity 92%, ready for biometric.”
3. **User**: “Confirm with Face ID” (future: biometric step).
4. **Agent**: “✅ Ownership approved. Timeline + audit log created.”

### Sample Thread (Work Approvals Batch)
1. **Agent**: “12 work approvals found (Viva). High (>90%): 5, Medium: 4, Low: 3.”
2. **User**: “Approve the high, queue the medium for review, reject the low.”
3. **Agent**: “✅ Approved 5, ⏳ Queued 4 for review, ❌ Rejected 3. Audit + notifications sent.”

## Security & Permissions
- Agent runs with **service role** but enforces checks before mutating:
  - Permission check: owner/contributor/org role.
  - Risk check: confidence thresholds; high-risk needs user confirmation or biometric.
  - Conflict check: existing verified owner, pending claims, fraud patterns.
  - Audit: every intent, decision, and action logged.
- High-risk gates: ownership approval, ownership transfer, destructive edits, financial ops.
- Medium-risk gates: batch approvals, medium-confidence work matches.
- Low-risk: reads, summaries, drafts.

## Data Model (proposed)
### Threads
`system_email_threads`
- id, user_id, subject, category (`ownership`, `work`, `org`, `system`), risk_level, is_archived, last_message_at.

### Messages
`system_email_messages`
- id, thread_id, parent_message_id, sender_type (`user`, `agent`, `system`), sender_id, body_text, body_html?
- intent JSONB (parsed action), executed_actions JSONB (what actually happened), risk_level, is_read, created_at.

### Attachments (inline JSONB)
- Vehicle card: { vehicle_id, vin, year, make, model, org_id }
- Work card: { work_id, confidence, org_id, vehicle_id, reasons[] }
- Ownership claim card: { verification_id, doc_auth_score, name_match_score, vin_match, conflicts[] }

### Intent → Action Router (edge function)
Input:
```json
{ "message": "approve all viva work >90%", "user_id": "...", "context_thread_id": "..." }
```
Output:
```json
{
  "action": "approve",
  "target": "work_approvals",
  "filters": { "organization": "Viva", "confidence": { "gt": 90 } },
  "risk": "medium",
  "requires_confirmation": true
}
```
- Router executes only after: permission check + risk policy + optional confirmation/biometric.

## Frontend Wireframe (components)
- `AgentInboxPage`
  - `ThreadListPane` (filters, folders)
  - `ThreadView` (message stack, cards, action buttons)
  - `Composer` (input, quick chips)
  - (Optional) `AssistantPanel` (suggestions, batch actions)

- Card components (reuse existing card styles):
  - `VehicleCardCompact`
  - `WorkApprovalCard`
  - `OwnershipClaimCard`
  - `ActionBar`: Approve / Reject / Forward / View / Start Biometric

## Flows (step-by-step)
### Ownership Claim
1) User sends title + license + VIN.
2) Agent OCRs, matches name/VIN, checks conflicts, scores authenticity.
3) If low/medium risk → ask for biometric; if high risk → require human review.
4) On approval: set ownership, create timeline event, log audit.

### Work Approvals
1) Agent summarizes pending approvals grouped by org/confidence.
2) User responds with batch instruction (“approve >90, queue 80-90, reject <80”).
3) Agent executes with permission checks, logs results, updates timelines, sends notifications.

### Org / Garage Transfers (repo → garage analogy)
1) User: “Transfer 1979 GMC from Garage A to Garage B.”
2) Agent checks permissions on both orgs, ownership status, outstanding liens/claims.
3) If clean and permitted → prepare transfer; require confirmation (and biometric for high value).
4) Execute transfer, log, notify both orgs.

## Staging the Build
1) Ship wireframe page backed by mock data (no writes) to validate UX.
2) Add intent parser edge function (strict, scoped intents).
3) Add thread/messages tables + basic RLS (user sees own threads).
4) Integrate real actions incrementally: start with read-only summaries, then safe writes (mark read), then gated writes (approvals).
5) Add biometric/final confirmation later (WebAuthn/Passkeys or device-native).

## Guardrails Checklist
- ✅ Permission check before any write.
- ✅ Risk-based confirmations.
- ✅ Conflict checks (existing owner, pending claims).
- ✅ No destructive default actions; require explicit user approval.
- ✅ Full audit trail for every step.


