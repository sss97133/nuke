# Books docket

The owner's per-year answer to "can I trust these books, and what stands behind that?". It is the first block of the Books view of the
private accounting office (`/accounting`, page `FinanceDashboard`), above Finish your taxes, plus one owner-only door on the owner's profile.
It is not a new page and not a second copy of anything: each row reads one stored answer of the database and names it.

Public-safe: this file names views, functions and rules, never amounts, names or account numbers.

## What is on the page

One card per tax year (return drafts union stored gate runs, from `books_gate_status`). Each card opens with a verdict and holds five rows.

| Row | What it says | Owner of the number |
|---|---|---|
| Verdict | **Trusted** only when the stored gate run passed every rule, is fresh, and no rule passed over a population of zero. Otherwise **Not trusted** with the reasons; **Not run**; **Did not finish** | `books_gate_status` (`run.trusted`, `rule_counts`) |
| Reconciliation gate | Passed or Last run passed, N rules failing, N rules not assessed, Not run, Did not finish (stopped at N s). When it ran and how long. Whether the return matches the books, from rule R9. The rules, in the database's order, each with failing out of checked | `books_gate_runs` through `books_gate_status` |
| How the deductions are supported | Tier C first, then B and A, each with dollars and the stored percentage of the year's deductions; excluded rows, tier B with no bank line, section 274 lines needing a receipt, and deductions with no payment proof and no owner ruling counted apart. Each number opens the decisions behind it | `v_books_audit_tier_years`; rows from `books_tier_records` |
| Ties to a statement line | Every Expense decision in exactly one class: linked both ways, cites a line we hold, listed by a line, cites lines that are not in the books, no bank citation; citations written and resolved; how many tied decisions equal their lines to the cent | `v_books_citation_links` |
| Paperwork | The state of the return: draft, prepared, mail-ready, on hold, mailed, filed, with form, pages, date and deadline; or "Filing state not recorded" | the facts register (`books_year_state`, facts with topic `filing`) |
| What is open | Return items open by who closes them (you, your CPA, the books agent, unassigned), the first "Closes with", and a button to that year's card in Finish your taxes | `books_gate_status` (counts), `books_year_state` (text) |

The tier letters are the owner's definition (2026-10-28): **A** a bank line, a cited allocation basis and a document. **B** a bank line and a
cited allocation basis (or, counted apart, a cited asset register or owner ruling with no bank line). **C** the rest. A bank line needs no
explanation; its allocation does; a receipt on every line is needed only where section 274 says so. Nothing on this page is computed in the
browser: counts, classes, rule order, staleness and trust arrive decided, and a percentage is printed exactly as the view stores it.

## Why the gate is stored

`books_year_gate(owner, year)` takes 15 to 30 seconds a year or more (read-only measurement, 2026-10-29) and the authenticated role is capped at
15 seconds, so no page can call it. `scripts/books/books_year_gate_check.py --record` runs it per year in one repeatable-read transaction
under an explicit bound (120 s by default, 300 s at most, never 0), reads the book's signature (`books_book_signature`) and the gate's
definition hash (`books_gate_md5`) first, and files the attempt through `record_books_gate_run` into the append-only `books_gate_runs`.
A run that hits the bound or fails is filed as `timed_out` or `error` in a second transaction, so the page says "Did not finish".

A stored run is **stale** when the books changed since it (the signature differs) or the gate's own definition changed since (the hash differs).
Any landing changes the signature, so land the filing state (`scripts/books/return_facts.py`) first and record the gate last. A stale pass reads
"Last run passed", never "Passed", and is never trusted.

## Who can see it (the database decides)

- `books_gate_status` raises 42501 for anyone but the owner (the accounting reviewer included); `books_gate_runs` has an owner-only SELECT policy,
  no anon grant and no write grant to authenticated; the writer is callable by `service_role` only. The reader never returns failing ids or detail text.
- The tier and tie views and `books_tier_records` run as the caller over the same row-policy-bound base as every older accounting reader.
  **Known limit:** the accounting reviewer grant (`accounting_access_grants`) reads those by design. The docket hides itself in a shared book
  and reads nothing there; narrowing the reviewer is the owner's decision.
- Routes: `/accounting` and `/publishing/finance` are both behind `ProtectedRoute`. `scripts/ci/logged-out-live.mjs` fails when a visitor is not
  sent to `/login` from `/accounting`, `/publishing/finance` or `/profile`, when a books reader is called from the page load, or when a private
  heading is in the text.
- The profile door (`UserBooksDoor`) renders for the owner's own profile only, with no heading and no request for anyone else. The profile
  itself stays public. Migration `20261106100000` revokes three legacy owner views that gave every signed-in account SELECT.

## States

Loading is a caption, not a spinner. A read that fails is retried once, then says it could not load and offers a retry; it never shows zero.
No stored run says "Not run". The cheap gate read paints first, then the deduction view starts 1.5 s later and the tie view 3 s later (they take 3 to 6 s each on prod, and
the first load of this page failed under load on 2026-10-29); none starts until the Books view is on screen, and each re-reads (settled for
1.5 s) when the book's revision changes. One read of each year's filing state serves both the docket and Finish your taxes.

## Known gaps, stated

- Two readers count a "bank line" in opposite directions: Finish your taxes counts only a statement line that lists the expense; the tier view
  counts only an expense that cites a line. The ties row prints the partition and its definition so neither is hidden. Choosing one definition
  moves numbers the owner has seen, so it needs a before and after table.
- Only bank-line citations are checked for existing in the books. Other proof links (owner rulings, register cells, files, mail, photos) are
  counted as written, not resolved, and the tier letters rest on them.
- Until `topic filing` facts are landed from the private runbooks, a year shows "Filing state not recorded", except that the older owner-ruling
  fact keyed `filing-hold` reads as on hold (matched on its key, never its text) until a filing fact is recorded. That bridge is removed with the
  first filing fact.
- The ties row has no drill yet (its classes are not rows of a view); a failing rule has no drill to its records yet.
- `books_vehicle_citations` (service role only, migration `20261103140000`) is the existing reader for decisions that cite a vehicle. The next
  citation class (a decision citing a receipt, a message or a photo) extends the ties view the same way and reuses that reader for vehicles.

## Pieces

- `nuke_frontend/src/components/finance/BooksDocket.tsx`, `booksDocketWords.ts` (the words), `filingState.ts`, `useRevisionRead.ts`
- `nuke_frontend/src/pages/user-profile/UserBooksDoor.tsx`
- `nuke_frontend/src/services/accountingCloseout.ts` (`readGateStatus`, `readTierYears`, `readCitationLinks`, `readDrillRecords`)
- `supabase/migrations/20261106100000` legacy views revoked, `…110000` gate runs and status, `…120000` citation links, `…130000` tier records
- contracts: `supabase/sql/test_books_gate_runs.sql`, `test_books_citation_links.sql`, `test_books_tier_records.sql`, `test_legacy_owner_views_revoked.sql`
- writers: `scripts/books/books_year_gate_check.py --record`, `scripts/books/return_facts.py` (topic `filing`, optional `actor`)
