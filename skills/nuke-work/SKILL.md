---
name: nuke-work
description: Scope, resume, review, or ship Nuke work while preserving decisions and choosing an appropriate agent.
---

# Nuke work

Use the current request and existing pickup to choose a mode below. This workflow
does not change the active model, grant access, launch other agents, or authorize
unrelated work. Follow the selected checkout's `AGENTS.md`; its release and data
rules take precedence over old command recipes.

## Choose who does the next piece

| Work | Starting choice |
|---|---|
| Search, arithmetic, diffs, checks, known transformations | Existing deterministic tool; keep routine verification in the current session |
| Small edits, bounded extraction or triage with clear criteria | Luna, low effort, when a separate session is actually useful |
| Implementation, integration and ordinary debugging | Sol, medium effort |
| Gist, conflicting evidence, product structure, difficult diagnosis | Astra, medium effort; raise effort for a concrete unresolved question |

These are the owner's starting preferences, not measured guarantees of cost or
accuracy. Use the available account model; never silently fall back to a paid API.
A subscription is metered capacity, not free work. Preserve a deliberately selected
model. If model switching or delegation is unavailable, say so and continue useful
work with the current agent; do not pretend a prompt changes execution routing.

Astra should turn the owner's rough request into the intended outcome, constraints
and next useful slice, then revisit hard decisions as evidence changes. Avoid making
the owner translate their request into a task taxonomy. Do not turn deep iteration
into repeated audits or a new plan at every handoff.

Later owner corrections steer the original objective; they do not erase it. Carry
both the integrated outcome and the next bounded repair in the pickup. For codebase
orientation use `docs/architecture/CODEBASE_INVENTORY.md` when present, then inspect
the relevant owner; do not rebuild the inventory for each task.

## Modes

- **Scope**: identify the user's actual activity and failure, inspect the smallest
  relevant current evidence, and define a concrete acceptance case. State the next
  repair and its owner. Continue authorized implementation; a brief is not completion.
- **Continue**: read the latest pickup and its linked receipt, preserve prior answers
  and holds, refresh only the state the next action depends on, then resume that
  action. Prefer a dated current receipt over older contradictory status text.
- **Review**: inspect the exact diff, the relevant consumer and applicable checks.
  Give actionable findings or a supported clean review. Follow existing review
  authority; a review request alone does not authorize merge or deployment.
- **Ship**: carry authorized work through the repository's checked PR/CI path and
  verify the changed consumer. Do not substitute local tests or an empty checks list
  for completed CI. Keep implemented, tested, merged, deployed and runtime-verified
  separate. Stop only the effects outside scope or blocked by enforcement.
- **Handoff**: update the current lane's private pickup with the packet below. Keep
  completed receipts and superseded decisions linked, with one current next action.
  A handoff does not create a schedule or continue work in another account.
- **Status**: report the current outcome, remaining failure, next action and evidence
  stage from the current lane. Probe only stale facts that matter to that answer.

## Handoff packet

Use this when transferring substantial work; a small direct edit needs no ceremony.
Keep private evidence in the lane's private receipt directory, never public git.

```text
Outcome: the user's goal in plain language; preserve the original question.
Scope: owned files/subsystem, checkout/branch; other active owner boundaries.
Decisions: dated owner answers and constraints; specific holds and authorization.
Evidence: exact source/receipt paths or IDs; as-of time; unresolved contradictions.
Next piece: one concrete repair, suggested agent, and why that fit helps.
Acceptance: original user action and expected result; relevant negative case.
State: implemented / tested / merged / deployed / runtime-verified, with evidence.
Resume: next executable step; known failed approach and why it failed.
Stop: exact missing fact, permission boundary or failure requiring escalation.
```

After two similar failures, inspect the cause or change approach. Escalate the
specific failed question with evidence, not the entire conversation. Delegate only
substantial independent work that merits another context; never spawn a fresh agent
just to load instructions, run a check or summarize a tool result.

For accounting, preserve one shared book and independently named phases: source
reading, item identity, expense recognition, payment/refund and vehicle/job use.
Reuse admitted evidence and prior owner answers. A missing relationship is a task
for its existing writer/reader owner, not a reason to recreate a ledger or repeat OCR.
When another lane owns database work, give it the precise missing relation and
consumer acceptance case without overlapping its writes.
