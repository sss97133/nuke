# Shared accounting application access

An owner uses **Accounting → Accounting access** to find an existing account by exact username or email. Review the displayed account before granting **Review** or **Review and correct**. A username lookup shows only a masked login; entering an exact email confirms that supplied email. This grants access to one canonical owner's books; it does not copy the books or share a login. The reviewer selects that owner's **shared books** in Accounting.

Review includes saved records, book controls, retained interpretations, review questions and private original evidence. Corrections append a complete attributed interpretation to the same original and name its current revision. Earlier evidence stays retained. No expenses are posted automatically. Source processing, recovery and grant management remain owner actions. Shared-book deal rollups are not yet available; the shared view labels this limit explicitly.

## Working together in Accounting

The owner and reviewers select the same canonical book. The screen checks bounded document metadata every five seconds while visible and refreshes current records, controls and open evidence when that metadata changes. It pauses background reads in hidden tabs and reports sync failures; it does not export or rebuild a PDF. This refresh currently supports fewer than 1,000 source documents per book and reports live updates unavailable at that limit.

Open an expense's evidence to edit **Vehicle or shop use**. A reviewer with correction access can choose shop use, an accessible recipient vehicle, or unassigned, enter the assigned amount and record the reason. Partial assignments keep the remainder unassigned; this editor currently records one destination per expense. It preserves the recognized expense amount, other records in the source batch, item evidence and unresolved current concerns. It does not turn a bank movement into another expense or change a tax position.

Unsaved edits remain intact when another reviewer changes the source. The screen requires a reload before saving a conflicting draft, and the existing writer independently refuses a superseded revision. The authenticated contributor is recorded by that writer. A book grant does not add vehicle permissions: the picker includes only the book-owner vehicles the current reviewer can already read.

## Claude Code

Connect the existing Nuke MCP endpoint with the reviewer's own login. For example, in the appropriate MCP configuration:

```json
{
  "mcpServers": {
    "nuke": {
      "type": "http",
      "url": "https://nuke.ag/mcp",
      "oauth": { "scopes": "accounting:read accounting:correct" }
    }
  }
}
```

Use `accounting:read` alone for review. Request correction explicitly; the default OAuth connection does not silently request it. Complete the magic-link login, then review the registered client, redirect destination and permissions on the final approval page. A book-owner grant and the matching credential scope are both required. Never share tokens or log in as the owner.

Call `accounting_books` with `action: contexts` first to discover accessible canonical book owners. Use `tax_read` with that `owner_user_id` to page saved records (maximum 500 per page); controls cover the complete book. `read` retrieves evidence for a document; `original` returns checked private bytes as image/resource content. `correct` requires the existing original reference, complete prior field/line/accounting-record sets and a current `supersedes_run_id`. Preserve amounts and source evidence unless a correction is justified and attributed. A stale revision is rejected; read the current document again before preparing another correction.

An `insufficient_scope` result identifies the permission needed for a new approved connection. A revoked or expired credential requires sign-in again; missing book access requires the owner's grant.

## Boundaries and revocation

Owner revocation blocks subsequent accounting application reads and corrections. Correction admission locks the live grant and key in the same database transaction: an already admitted transaction finishes before revocation; subsequent admission fails. Private source download rechecks access after loading bytes and never hands out a long-lived signed URL. Already delivered information cannot be recalled.

Application access does not grant arbitrary SQL, schema changes, filings, signatures or payments. It does not change independent GitHub or Supabase developer permissions, and revoking it does not revoke those separately managed permissions. Organization membership alone grants no accounting access.

Implementation: `financial_evidence_v1` remains the canonical reader/writer. The server derives actor, owner grant and credential identity; clients cannot provide attribution authority. Browser SELECT policies consult current explicit grants; private storage policies remain unchanged. OAuth credentials are opaque, hashed, PKCE-bound, expiring and revocable. Legacy self-issued JWTs are not accepted.
