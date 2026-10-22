# Shared accounting application access

An owner uses **Accounting → Accounting access** to find an existing account by exact username or email. Review the displayed account before granting **Review** or **Review and correct**. A username lookup shows only a masked login; entering an exact email confirms that supplied email. This grants access to one canonical owner's books; it does not copy the books or share a login. The reviewer selects that owner's **shared books** in Accounting.

Review includes saved records, book controls, retained interpretations, review questions and private original evidence. Corrections append a complete attributed interpretation to the same original and name its current revision. Earlier evidence stays retained. No expenses are posted automatically. Source processing, recovery and grant management remain owner actions.

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
