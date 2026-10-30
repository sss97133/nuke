# Books docket

The owner's per-year answer to "what paper do the books still need from me, can I trust them, and what stands behind that?". It is the first block of the Books view of the
private accounting office (`/accounting`, page `FinanceDashboard`), above Finish your taxes, plus one owner-only door on the owner's profile.
It is not a new page and not a second copy of anything: each row reads one stored answer of the database and names it.

Public-safe: this file names views, functions and rules, never amounts, names or account numbers.

## What is on the page

One card per tax year. The years are the database's (`books_gate_status`: the return drafts, the stored gate runs and the years that have Expense decisions); the page
adds none. Each card opens with a verdict, then **the paper the books still need** (the first screen), then the rows that say what stands behind the verdict.

| Row | What it says | Owner of the number |
|---|---|---|
| No bank line, no owner ruling, no rule | Dollars of deductions that rule R10 part b counts (no payment proof, no owner ruling, no structural rule), of the year's deduction dollars, **net of credits**. **Live**: the same rows the number opens to. The label says what is counted and no more: a deduction resting on an owner ruling or the asset register is counted apart | `v_books_audit_tier_years` (`no_pay_no_ruling_usd`, `deduction_usd`); rows from `books_tier_records` |
| Large deductions missing their document | Dollars of the head rows (the smallest set of the year's largest deductions that reaches 80% of its dollars) that lack the document their kind requires, of the head's dollars, in **absolute** amounts (credits counted positive, as rule R12 reads them); how many cite no document at all; by kind of paper. **Live**, over the rows listed below it. It counts missing paper, not unreconciled money: a row's bank line is a separate flag | `books_large_sum_rows` over `v_books_large_sums` |
| (a line, only when they differ) | What the stored gate run counted for the same two things when it ran, beside what the books say now, both numbers the database's. The headline and the rows are always one answer; the stored run only says that the books have moved since it ran | `books_gate_runs` (rule R12 `missing_doc`, `context.no_pay_no_ruling`) through `books_gate_status` |
| Large sums that need paper | The rows rule R12 flags, **live**, largest dollars first: date, payee and what was bought, amount, and what each still needs in plain words (contractor invoice, purchase agreement or bill of sale, receipt, lease, a bank line, a document where only the filed return supports it). A row a file can answer has a button that names the paper (Add the invoice). How many of the head are flagged and how many need which answer (a row can need more than one); the smaller deductions below the 80% line that also miss a document are counted, not listed; a row the page could not read is counted and said | `books_large_sum_rows` over `v_books_large_sums` |
| Verdict | **Trusted** only when the stored gate run passed every rule, is fresh, and no rule passed over a population of zero. Otherwise **Not trusted** with the reasons; **Not run**; **Did not finish** | `books_gate_status` (`run.trusted`, `rule_counts`) |
| Reconciliation gate | Passed or Last run passed, N rules failing, N rules not assessed, Not run, Did not finish (stopped at N s). When it ran and how long. Whether the return matches the books, from rule R9. The rules, in the database's order, as the office's chips, each with failing out of checked | `books_gate_runs` through `books_gate_status` |
| How the deductions are supported | Tier C first, then B and A, each with dollars and the stored percentage of the year's deductions (net of credits); excluded rows, tier B with no bank line, section 274 lines needing a receipt (of the year's section 274 dollars), and deductions with no payment proof and no owner ruling counted apart. Each number opens the decisions behind it | `v_books_audit_tier_years`; rows from `books_tier_records` |
| Ties to a statement line | Folded away until the owner rules which direction defines a bank line. Every Expense decision in exactly one class: linked both ways, cites a line we hold, listed by a line, cites lines that are not in the books, no bank citation; the citations written and resolved on their own line; how many tied decisions equal their lines to the cent | `v_books_citation_links` |
| Paperwork | The state of the return: draft, prepared, mail-ready, on hold, mailed, filed, with form, pages, date and deadline; or "Filing state not recorded" | the facts register (`books_year_state`, facts with topic `filing`) |
| What is open | Return items open by who closes them (you, your CPA, the books agent, unassigned), the first "Closes with", and a button to that year's card in Finish your taxes | `books_gate_status` (counts, by the same definition of open as `books_year_state`, pinned by a contract), `books_year_state` (text) |

Finish your taxes beside it no longer adds anything across the years or multiplies by a rate: each year says its own answer, and the stake of income with no named payer is
the draft's own rate, quoted. Two of its items are not listed: the per-line receipt (owner ruling 2026-10-28) and the statement-side count of expenses with no bank line and
no receipt, which says the opposite of the docket's count for the early years (see the known gaps).

### Adding the paper

A row that misses a document (or rests only on the filed return, or has no cited basis) can take a file through the office's existing Add documents flow
(`FinancialDocumentIntake`, with the row as its **link target**): the same private upload, the same writer (`ingest-observation` mode `financial_evidence_v1`, which calls
`ingest_financial_evidence`), the same stage words. A new file is retained like any other (the `process` action writes its capture) and then linked by **one correction** of
its document that adds one cell, `supports_record_<first 24 characters of the record's source key>`; a file the books already hold is not uploaded again, the same correction
adds the cell to it. The cell names the year, the record (`local_id`, `source_key`, the document that holds it), what the owner said the file is (`doc_kind`, in the words the
view reads: Invoice, Agreement, Purchase agreement, Bill of sale, Receipt, Order confirmation, Lease) and the exact citation text (`ref`: kind, file name, start of its
hash) that would clear the flag. The view `v_books_record_attachments` is the one place that says when such a cell counts (current, and under the key of the record it
names); the reader and `scripts/books/pending_attachments.py` both read it.

**The row stays on the list.** The view clears a row only when the decision's own `proof_links` cite a paper of the right kind, and the browser
cannot write that: the decisions of the flagged rows live in source documents of hundreds of records (a revision of one is far beyond the
writer's 250,000-character limit). So the row says "Document received, link pending", never "done".
`scripts/books/pending_attachments.py` reads the papers nobody cites yet and prints the corrections file the sanctioned writer takes
(`scripts/books/schedule_c_rulings.py correct`, `proof_links` merge); after it runs, record the gate and the row leaves the list.
Only paper goes in: the panel says nothing with a Social Security number, and the flow takes images and PDFs only.

The words for what a row needs, and the kinds of paper a file may be called, are one table (`DOC_KIND`) and two small ones in `booksDocketWords.ts`, keyed by the view's own keys
(`required_doc_rule`, `required_doc_kind`, `proof_flag`); a test reads the newest migration that defines `v_books_large_sums` and fails when a rule
or flag has no words, or when a kind of paper offered would not satisfy the level the view requires by its keyword patterns. A key the table
does not know is shown humanized, never dropped. The lists a filing state and an actor are drawn from are kept the same in the writer
(`return_facts.py`), the reader (`books_gate_status`) and the page by a test that reads the other two.

The tier letters are the owner's definition (2026-10-28): **A** a bank line, a cited allocation basis and a document. **B** a bank line and a cited
allocation basis (or, counted apart, a cited asset register or owner ruling with no bank line). **C** the rest. A bank line needs no
explanation; its allocation does; a receipt on every line is needed only where section 274 says so. Nothing on this page is computed in the
browser: counts, classes, rule order, staleness and trust arrive decided, and a percentage is printed exactly as the view stores it. The one thing the page does with
two numbers is compare them for equality (the stored run against the live reader).

## Why the gate is stored

`books_year_gate(owner, year)` takes 8 to 30 seconds a year (read-only measurements, 2026-10-29; 15.5 to over 30 s before the join rewrite of #2903) and the
authenticated role is capped at 15 seconds (`pg_roles`, 2026-10-29), so no page can reliably call it, and `authenticator`'s 60 s is not the page's. `scripts/books/books_year_gate_check.py --record` runs it per year in one repeatable-read transaction
under an explicit bound (120 s by default, 300 s at most, never 0), reads the book's signature (`books_book_signature`) and the gate's
definition hash (`books_gate_md5`) first, and files the attempt through `record_books_gate_run` into the append-only `books_gate_runs`.
In the same transaction it reads `books_gate_context` (the year's deduction dollars, the deductions with no bank line, rule R10 part b, and the head
rule R12 tests: rows, dollars, the year's dollars) and stores it beside the run, so the run keeps the denominators of the book the gate saw; the deduction, no-bank and
part-b dollars are net of credits like the audit tiers, and the head is in absolute dollars like rule R12. The run's clock stops when the gate returns, so the stored duration is the gate's own. A run that hits the bound or fails is filed as
`timed_out` or `error` in a second transaction, so the page says "Did not finish". There is no cron and no page button that runs it: the refresh path is
the script, under an explicit bound, after the last landing.

A stored run is **stale** when the books changed since it (the signature differs) or what the gate is made of changed since (the hash differs). The hash is found from the gate
itself, not from a list: the source of `books_year_gate`; of every `books_*` / `accounting_*` function a function's source names (the readers and the helpers they call); the rule
tree of every `v_books_*` / `v_accounting_*` / `v_financial_*` view a function's source names; and, through the dependency catalog, every view those views read and every public
function they call (R10 and R12 are computed by views, so a migration that changes only a view or a helper marks every run stale). A name in a comment counts too, which errs toward
stale. The walk reaches 17 definitions and takes about 50 ms (read-only on production as the signed-in role, 2026-10-29); a new view or helper the gate starts to read is covered the
day it does, with no list to update. An object outside the two name families would not be found by name: keep the books gate's helpers inside them. Any landing changes the
signature, so land the filing state (`scripts/books/return_facts.py`) first and record the gate last.
A stale pass reads "Last run passed", never "Passed", and is never trusted. The browser spells the book's revision the way the database does (`<documents>:<latest change as
YYYY-MM-DDTHH:MI:SS.USZ>`), pinned by a test against the migration.

## Who can see it (the database decides)

- `books_gate_status` raises 42501 for anyone but the owner (the accounting reviewer included); `books_gate_runs` has an owner-only SELECT policy,
  no anon grant and no write grant to authenticated; the writer is callable by `service_role` only. The reader never returns failing ids or detail text.
- `books_large_sum_rows` raises 42501 for anyone but the owner (the accounting reviewer included) and runs as the caller; `books_gate_context` is callable by
  `service_role` only. `v_books_record_attachments` (the owner's own papers) runs as the caller under the book's row policies, no anon grant.
- The tier and tie views and `books_tier_records` run as the caller over the same row-policy-bound base as every older accounting reader.
  **Known limit:** the accounting reviewer grant (`accounting_access_grants`) reads those by design. The docket hides itself in a shared book
  and reads nothing there; narrowing the reviewer is the owner's decision.
- Routes: `/accounting` is behind `ProtectedRoute`, and it is the only mount of the office: `/publishing/finance` is a redirect to it (a visitor ends at `/login`).
  `scripts/ci/logged-out-live.mjs` fails when a visitor is not sent to `/login` from `/accounting`, `/publishing/finance` or `/profile`, when a books reader is called from
  the page load, or when a private heading is in the text.
- The profile door (`UserBooksDoor`) renders for the owner's own profile only, with no heading and no request for anyone else. The profile
  itself stays public. Migration `20261106100000` revokes eighteen owner-rights views of the journal (the three legacy owner views and fifteen siblings, named in the
  migration) that gave every signed-in account SELECT; the journal tables themselves answer nobody but their owner role.

## States

Loading is a caption, not a spinner. A read that fails is retried once, then says it could not load and offers a retry; it never shows zero. A read that never answers is cut
after 20 s and is that failure. Each total says "Reading…" until its own live read is in and "Could not load" if it failed; it never falls back to the stored run's figure.

Every read goes through the app's query client: one cached answer per book and read, cancelled when something newer replaces it, and kept only while the page that asked is
mounted (nothing of the owner's amounts outlives it). The cheap gate status paints first; the large sums follow it after 0.5 s (about 4 s on prod, one
call for every year), the deduction view after 2.5 s and the tie view after 5 s (they take 1.5 to 6 s each, and the first load of this page failed under load on 2026-10-29);
none starts until the Books view is on screen. A view that comes back on screen keeps its answer: the heavy reads are read again only when the book changed (settled for
1.5 s, and not more often than once a minute however often it changes), the cheap one also when its answer is older than 30 s. Adding a file re-reads the list, and **Read
again** (beside the coverage line) re-reads the stored runs and the live rows; neither runs the gate. One read of each year's filing state serves both the docket and Finish your taxes.

## Known gaps, stated

- Two readers count a "bank line" in opposite directions: Finish your taxes counted only a statement line that lists the expense; the tier view
  counts only an expense that cites a line. The ties row (folded) prints the partition and its definition so neither is hidden; the statement-side item of Finish your taxes
  is not listed until the owner rules which direction defines a bank line. Choosing one definition moves numbers the owner has seen, so it needs a before and after table.
  `v_books_citation_links` is a new source that awaits the lead's acceptance as a docket source.
- Only bank-line citations are checked for existing in the books. Other proof links (owner rulings, register cells, files, mail, photos) are
  counted as written, not resolved, and the tier letters rest on them.
- Until `topic filing` facts are landed from the private runbooks, a year shows "Filing state not recorded", except that the older owner-ruling
  fact keyed `filing-hold` reads as on hold (matched on its key, never its text) until a filing fact is recorded. That bridge is removed with the
  first filing fact.
- A file added for a row is pointed at its record, not yet cited by it: the row leaves the list only after the books writer cites the file (above). **A decision for the
  books lane**, not made here: `v_books_large_sums` and `accounting_record_evidence` read documents from the decision's side (proof links, vehicle documents, use groups, the
  `expense_items_*` and `bank_corroboration` cells). Adding `v_books_record_attachments` as one more document source of `v_books_large_sums`, and as `via: 'attached'` in
  `accounting_record_evidence.artifacts`, would clear a row the moment its paper is added and show the file in the evidence dialog, with no citation step. That changes
  rule R12, so it is the books lane's to rule.
- Rule R12 reads absolute dollars and the audit tiers read net dollars, so the year's two totals differ by the credits; each total names its own basis.
- A failing rule has no drill to its records yet; the ties row has no drill (its classes are not rows of a view).
- Two readers repeat a keyed read of the records view for the page of ids they return (`books_tier_records`, `books_large_sum_rows`), with the same planner note; a shared
  helper would remove it, at the cost of one more public function.
- The proportion bar is a kit component now (`ShareBar`); the market boards still draw their own, each with its own classes and shape (two segments, a hatched unknown).
- `books_vehicle_citations` (service role only, migration `20261103140000`) is the existing reader for decisions that cite a vehicle. The next
  citation class (a decision citing a receipt, a message or a photo) extends the ties view the same way and reuses that reader for vehicles.

## Pieces

- `nuke_frontend/src/components/finance/BooksDocket.tsx`, `LargeSums.tsx` (the totals, the list, the add-the-paper panel over `FinancialDocumentIntake`), `CloseItem.tsx` (the
  office's one row, year card and read states, shared with Finish your taxes), `booksDocketWords.ts` (the words), `filingState.ts`, `useRevisionRead.ts` (the reads over the
  query client), `__fixtures__/books.tsx` (the synthetic book every test shares)
- `nuke_frontend/src/pages/user-profile/UserBooksDoor.tsx`; `nuke_frontend/src/kit/ShareBar.tsx`
- `nuke_frontend/src/services/accountingCloseout.ts` (`readGateStatus`, `readLargeSums`, `readTierYears`, `readCitationLinks`, `readDrillRecords`, `bounded`),
  `financialEvidenceIntake.ts` (`processFinancialDocument` with a link target), `financialExpenseUse.ts` (`correctionRequest`, the one envelope of every correction)
- `supabase/migrations/20261106100000` legacy views revoked, `…110000` gate runs and status, `…120000` citation links, `…130000` tier records, `…140000` attachments view, large-sum rows and gate context
- contracts: `supabase/sql/test_books_gate_runs.sql`, `test_books_citation_links.sql`, `test_books_tier_records.sql` (run over the real rollup definition), `test_legacy_owner_views_revoked.sql`, `test_books_large_sum_rows.sql`
- writers: `scripts/books/books_year_gate_check.py --record`, `scripts/books/return_facts.py` (topic `filing`, optional `actor`);
  `scripts/books/pending_attachments.py` then `scripts/books/schedule_c_rulings.py correct` for the papers the owner added
