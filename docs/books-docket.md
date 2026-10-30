# Books docket

The owner's per-year answer to "what paper do the books still need from me, can I trust them, and what stands behind that?". It is the first block of the Books view of the
private accounting office (`/accounting`, page `FinanceDashboard`), above Finish your taxes, plus one owner-only door on the owner's profile.
It is not a new page and not a second copy of anything: each row reads one stored answer of the database and names it.

Public-safe: this file names views, functions and rules, never amounts, names or account numbers.

## What is on the page

One card per tax year (return drafts union stored gate runs union years that have deductions, from `books_gate_status` and `books_large_sum_rows`). Each card opens
with a verdict, then **the paper the books still need** (the first screen), then the rows that say what stands behind the verdict.

| Row | What it says | Owner of the number |
|---|---|---|
| Paid outside a linked bank line | Dollars of deductions with no bank line, no owner ruling and no structural rule (rule R10 part b), of the year's deduction dollars; how many deductions have no linked bank line in all. From the stored run, with its time | `books_gate_runs.context` (read by `books_gate_context` in the run's own transaction) and rule R10, through `books_gate_status` |
| Missing a document | Dollars of the head rows (the smallest set of the year's largest deductions that reaches 80% of its dollars) that lack the document their kind requires, of the head's dollars; by kind of paper; how many cite no document at all. From the stored run, with its time | rule R12 (`missing_doc`) and `books_gate_runs.context`, through `books_gate_status` |
| Large sums that need paper | The rows rule R12 flags, **live**, largest dollars first: date, payee and what was bought, amount, and what each still needs in plain words (contractor invoice, purchase agreement or bill of sale, receipt, lease, a bank line, a document where only the filed return supports it). A row a file can answer has a button that names the paper (Add the invoice). How many rows need which answer; the smaller deductions below the 80% line that also miss a document are counted, not listed. When the live count of rows missing a document differs from the stored run's, both numbers are said | `books_large_sum_rows` over `v_books_large_sums` |
| Verdict | **Trusted** only when the stored gate run passed every rule, is fresh, and no rule passed over a population of zero. Otherwise **Not trusted** with the reasons; **Not run**; **Did not finish** | `books_gate_status` (`run.trusted`, `rule_counts`) |
| Reconciliation gate | Passed or Last run passed, N rules failing, N rules not assessed, Not run, Did not finish (stopped at N s). When it ran and how long. Whether the return matches the books, from rule R9. The rules, in the database's order, each with failing out of checked | `books_gate_runs` through `books_gate_status` |
| How the deductions are supported | Tier C first, then B and A, each with dollars and the stored percentage of the year's deductions; excluded rows, tier B with no bank line, section 274 lines needing a receipt, and deductions with no payment proof and no owner ruling counted apart. Each number opens the decisions behind it | `v_books_audit_tier_years`; rows from `books_tier_records` |
| Ties to a statement line | Every Expense decision in exactly one class: linked both ways, cites a line we hold, listed by a line, cites lines that are not in the books, no bank citation; citations written and resolved; how many tied decisions equal their lines to the cent | `v_books_citation_links` |
| Paperwork | The state of the return: draft, prepared, mail-ready, on hold, mailed, filed, with form, pages, date and deadline; or "Filing state not recorded" | the facts register (`books_year_state`, facts with topic `filing`) |
| What is open | Return items open by who closes them (you, your CPA, the books agent, unassigned), the first "Closes with", and a button to that year's card in Finish your taxes | `books_gate_status` (counts), `books_year_state` (text) |

### Adding the paper

A row that misses a document (or rests only on the filed return, or has no cited basis) can take a file through the office's existing Add documents
flow: the same private upload, the same writer (`ingest-observation` mode `financial_evidence_v1`, which calls `ingest_financial_evidence`), with the
row as its **link target**. The file lands as an ordinary `financial_documents` row whose revision carries its capture and one cell,
`supports_record_<first 24 characters of the record's source key>`. The cell names the year, the record (`local_id`, `source_key`, the document that
holds it), what the owner said the file is (`doc_kind`, in the words the view reads: Invoice, Agreement, Purchase agreement, Bill of sale, Receipt,
Order confirmation, Lease) and the exact citation text (`ref`: kind, file name, start of its hash) that would clear the flag. A file the books
already hold is not uploaded again; one correction adds the cell to it. A cell counts only under the key of the record it names.

**The row stays on the list.** The view clears a row only when the decision's own `proof_links` cite a paper of the right kind, and the browser
cannot write that: the decisions of the flagged rows live in source documents of hundreds of records (a revision of one is far beyond the
writer's 250,000-character limit). So the row says "Document received, link pending", never "done".
`scripts/books/pending_attachments.py` reads the cells nobody cites yet and prints the corrections file the sanctioned writer takes
(`scripts/books/schedule_c_rulings.py correct`, `proof_links` merge); after it runs, record the gate and the row leaves the list.
Only paper goes in: the panel says nothing with a Social Security number, and the flow takes images and PDFs only.

The words for what a row needs, and the kinds of paper a file may be called, are tables in `booksDocketWords.ts` keyed by the view's own keys
(`required_doc_rule`, `required_doc_kind`, `proof_flag`); a test reads the newest migration that defines `v_books_large_sums` and fails when a rule
or flag has no words, or when a kind of paper offered would not satisfy the level the view requires by its keyword patterns. A key the table
does not know is shown humanized, never dropped.

The tier letters are the owner's definition (2026-10-28): **A** a bank line, a cited allocation basis and a document. **B** a bank line and a
cited allocation basis (or, counted apart, a cited asset register or owner ruling with no bank line). **C** the rest. A bank line needs no
explanation; its allocation does; a receipt on every line is needed only where section 274 says so. Nothing on this page is computed in the
browser: counts, classes, rule order, staleness and trust arrive decided, and a percentage is printed exactly as the view stores it.

## Why the gate is stored

`books_year_gate(owner, year)` takes 8 to 30 seconds a year (read-only measurements, 2026-10-29; 15.5 to over 30 s before the join rewrite of #2903) and the
authenticated role is capped at 15 seconds (`pg_roles`, 2026-10-29), so no page can reliably call it, and `authenticator`'s 60 s is not the page's. `scripts/books/books_year_gate_check.py --record` runs it per year in one repeatable-read transaction
under an explicit bound (120 s by default, 300 s at most, never 0), reads the book's signature (`books_book_signature`) and the gate's
definition hash (`books_gate_md5`) first, and files the attempt through `record_books_gate_run` into the append-only `books_gate_runs`.
In the same transaction it reads `books_gate_context` (the year's deduction dollars, the deductions with no bank line, rule R10 part b, and the head
rule R12 tests: rows, dollars, the year's dollars) and stores it beside the run, so the two totals at the top of a card have their denominators from the
book the gate saw. The run's clock stops when the gate returns, so the stored duration is the gate's own. A run that hits the bound or fails is filed as
`timed_out` or `error` in a second transaction, so the page says "Did not finish". There is no cron and no page button that runs it: the refresh path is
the script, under an explicit bound, after the last landing.

A stored run is **stale** when the books changed since it (the signature differs) or the gate's own definition changed since (the hash differs).
Any landing changes the signature, so land the filing state (`scripts/books/return_facts.py`) first and record the gate last. A stale pass reads
"Last run passed", never "Passed", and is never trusted.

## Who can see it (the database decides)

- `books_gate_status` raises 42501 for anyone but the owner (the accounting reviewer included); `books_gate_runs` has an owner-only SELECT policy,
  no anon grant and no write grant to authenticated; the writer is callable by `service_role` only. The reader never returns failing ids or detail text.
- `books_large_sum_rows` raises 42501 for anyone but the owner (the accounting reviewer included) and runs as the caller; `books_gate_context` is callable by
  `service_role` only. The supports_record cells are the owner's own documents under the book's row policies.
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
No stored run says "Not run"; the two totals then state the live readers' own figures for the same conditions (the large sums for R12, the audit tiers for R10 part b) and say "read live", and a stored run that kept no denominators says "Not recorded" and states none. The cheap gate read paints first and the large sums start with it (about 4 s on prod, one call
for every year); the deduction view starts 2.5 s later and the tie view 5 s later (they take 1.5 to 6 s each, and the first load of this page failed under load on
2026-10-29); none starts until the Books view is on screen, and each re-reads (settled for 1.5 s) when the book's revision changes. Adding a file re-reads the list, and **Read again** (beside the coverage line) re-reads the stored runs and the live rows; neither runs the gate. One read of each year's filing state serves both the docket and Finish your taxes.

## Known gaps, stated

- Two readers count a "bank line" in opposite directions: Finish your taxes counts only a statement line that lists the expense; the tier view
  counts only an expense that cites a line. The ties row prints the partition and its definition so neither is hidden. Choosing one definition
  moves numbers the owner has seen, so it needs a before and after table.
- Only bank-line citations are checked for existing in the books. Other proof links (owner rulings, register cells, files, mail, photos) are
  counted as written, not resolved, and the tier letters rest on them.
- Until `topic filing` facts are landed from the private runbooks, a year shows "Filing state not recorded", except that the older owner-ruling
  fact keyed `filing-hold` reads as on hold (matched on its key, never its text) until a filing fact is recorded. That bridge is removed with the
  first filing fact.
- A file added for a row is pointed at its record, not yet cited by it: the row leaves the list only after the books writer cites the file (above). A view
  that also counted a document pointed at the decision from the document side would clear the row at once, as `accounting_decision_proof` already does for
  receipts; that changes `v_books_large_sums` and rule R12, which are the books lane's, so it is a decision, not part of this page.
- The evidence dialog does not list an attached file yet (`accounting_record_evidence` does not read the supports_record cells).
- Rule R12 reads absolute dollars and the audit tiers read net dollars, so the year's two totals differ by the credits; each total names its own denominator.
- The ties row has no drill yet (its classes are not rows of a view); a failing rule has no drill to its records yet.
- `books_vehicle_citations` (service role only, migration `20261103140000`) is the existing reader for decisions that cite a vehicle. The next
  citation class (a decision citing a receipt, a message or a photo) extends the ties view the same way and reuses that reader for vehicles.

## Pieces

- `nuke_frontend/src/components/finance/BooksDocket.tsx`, `LargeSums.tsx` (the totals, the list, the add-the-paper panel), `DocketItem.tsx`, `booksDocketWords.ts` (the words), `filingState.ts`, `useRevisionRead.ts`
- `nuke_frontend/src/pages/user-profile/UserBooksDoor.tsx`
- `nuke_frontend/src/services/accountingCloseout.ts` (`readGateStatus`, `readLargeSums`, `readTierYears`, `readCitationLinks`, `readDrillRecords`),
  `financialEvidenceIntake.ts` (`processFinancialDocument` with a link target)
- `supabase/migrations/20261106100000` legacy views revoked, `…110000` gate runs and status, `…120000` citation links, `…130000` tier records, `…140000` large-sum rows and gate context
- contracts: `supabase/sql/test_books_gate_runs.sql`, `test_books_citation_links.sql`, `test_books_tier_records.sql`, `test_legacy_owner_views_revoked.sql`, `test_books_large_sum_rows.sql`
- writers: `scripts/books/books_year_gate_check.py --record`, `scripts/books/return_facts.py` (topic `filing`, optional `actor`);
  `scripts/books/pending_attachments.py` then `scripts/books/schedule_c_rulings.py correct` for the papers the owner added
