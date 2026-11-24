# Library privacy: server drafts (NOT APPLIED)

These were found during the Library privacy audit on 2026-11-23. Nothing in this folder is applied, and applying it needs the owner's explicit yes.

| # | Leak | Skylar's rows | Draft |
|---|---|---|---|
| 1 | The "Organization members can view org vehicle images" policy has **no privacy filter**. Any active contributor of an org linked to the vehicle reads `is_sensitive` and `rejected_personal` rows, including their `image_url`. | **245** private photos, readable by 4 distinct member sets | `01_org_member_image_policy.sql` |
| 2 | Private photos' files sit in **public buckets**. Row security hides the row, but a saved URL still loads. | **627** `is_sensitive` rows, all with `/object/public/` URLs | #3212 (Codex lane, open draft). Unchanged here |
| 3 | `is_document` rows that aren't `is_sensitive` are readable by anon on public vehicles. | 13 (none are title, registration, insurance, receipt or invoice) | No change proposed. They're factory references or unnamed papers. Listed so the owner can decide |
| 4 | Two privacy verdicts disagree: `is_sensitive` (627) vs `vision_gate_status = rejected_personal` (1,255). 717 are rejected_personal but not is_sensitive, and 89 are the other way round. | 806 | No change. Both now block in the iOS Library (#3741) and in the public read policy. Reconciling them is a pipeline decision |

The iOS side fails closed whatever is decided here (#3741).
