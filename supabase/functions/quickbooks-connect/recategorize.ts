/**
 * quickbooks-connect action=recategorize: move posted QuickBooks lines to another account, only on the
 * owner's approval.
 *
 * It covers the two entities pull_transactions mirrors, Purchase and Deposit, and addresses a line by the
 * same qb_id ("purchase-<Id>-<n>" / "deposit-<Id>-<n>"). It changes the account on the line and nothing
 * else: the amount, date, payee and bank-feed link stay as they are.
 *
 * Gates, in order:
 *  1. The caller is the service key or the company owner: the function's existing guard, before this runs.
 *  2. Dry run by default. Unless the body says `dry_run: false`, it only plans. For each line it reads the
 *     transaction from QuickBooks, checks the line still sits in the account the batch expects, and
 *     resolves the target account by its full name ("Parent:Child" for a sub-account). It returns the plan
 *     with a plan_sha256 over exactly the lines it would change: ids, SyncTokens, and from and to account ids.
 *  3. An apply must carry the owner's approval (who, when, where he said yes) and the plan_sha256 of the
 *     dry run he approved. It plans again against live QuickBooks and refuses with 409 if the hash differs.
 *     So it can only write the plan that was reviewed, and nothing that changed since.
 *  4. It never creates or deletes accounts or transactions, excludes bank-feed items, or edits bank rules.
 *     A target account that doesn't exist is reported as account_missing, and that line is left alone.
 *
 * Nothing here writes to the database. Run pull_transactions afterwards to refresh qb_transactions.
 * scripts/books/qb-recategorize.mjs is the runner. It keeps the batch and its receipts outside the repo.
 */

export type Entity = "Purchase" | "Deposit";

export interface ChangeRequest {
  /** "purchase-<Id>-<n>" or "deposit-<Id>-<n>", the scheme pull_transactions writes */
  qb_id: string;
  /** the account the line sits in now: its full name, as pull_transactions stored it */
  expect_account: string;
  /** the target account's full name ("Parent:Child" for a sub-account) */
  to_account: string;
}

export interface Approval {
  approved_by: string;
  approved_at: string;
  /** where the owner said yes (chat session and time, message id) */
  ref: string;
}

export interface RecategorizeBody {
  batch_id: string;
  changes: ChangeRequest[];
  dry_run?: boolean;
  plan_sha256?: string;
  approval?: Approval;
}

export interface QboAccount {
  Id: string;
  Name: string;
  FullyQualifiedName?: string;
  AccountType?: string;
  Active?: boolean;
}

export type LineStatus = "ready" | "noop" | "conflict" | "account_missing" | "unsupported" | "not_found";

export interface LinePlan {
  qb_id: string;
  status: LineStatus;
  reason?: string;
  entity?: Entity;
  txn_id?: string;
  line_index?: number;
  sync_token?: string;
  from_account?: { id: string | null; name: string | null };
  to_account?: { id: string | null; name: string; type?: string | null };
  applied?: boolean;
  new_sync_token?: string;
  error?: string;
}

export interface QboClient {
  getTxn(entity: Entity, id: string): Promise<any | null>;
  listAccounts(): Promise<QboAccount[]>;
  updateTxn(entity: Entity, txn: any): Promise<any>;
}

export const MAX_CHANGES = 200;

export function parseQbId(qbId: string): { entity: Entity; txnId: string; lineIndex: number } | null {
  const m = /^(purchase|deposit)-(\d+)-(\d+)$/.exec(qbId);
  if (!m || Number(m[3]) < 1) return null;
  return { entity: m[1] === "purchase" ? "Purchase" : "Deposit", txnId: m[2], lineIndex: Number(m[3]) };
}

/** The lines pull_transactions numbers (numeric Amount, not a subtotal), so qb_id "-<n>" means the same line. */
export function countedLines(txn: any): any[] {
  return (txn?.Line || []).filter((l: any) => typeof l.Amount === "number" && l.DetailType !== "SubTotalLineDetail");
}

/** The part of a line that holds its account; null for item lines and linked-payment deposit lines. */
function accountDetail(entity: Entity, line: any): any | null {
  if (entity === "Purchase") return line?.AccountBasedExpenseLineDetail ?? null;
  return line?.DepositLineDetail?.AccountRef ? line.DepositLineDetail : null;
}

/** Active accounts by full name. */
export function indexAccounts(accounts: QboAccount[]): Map<string, QboAccount> {
  const m = new Map<string, QboAccount>();
  for (const a of accounts) if (a.Active !== false) m.set(a.FullyQualifiedName ?? a.Name, a);
  return m;
}

export function planLine(
  change: ChangeRequest,
  txn: any | null,
  accounts: Map<string, QboAccount>,
  accountsById: Map<string, QboAccount> = new Map(),
): LinePlan {
  const id = parseQbId(change.qb_id);
  if (!id) return { qb_id: change.qb_id, status: "unsupported", reason: "qb_id is not purchase-<Id>-<n> or deposit-<Id>-<n>" };
  const base = { qb_id: change.qb_id, entity: id.entity, txn_id: id.txnId, line_index: id.lineIndex };
  if (!txn) return { ...base, status: "not_found", reason: `QuickBooks has no ${id.entity} ${id.txnId}` };
  const line = countedLines(txn)[id.lineIndex - 1];
  if (!line) return { ...base, status: "not_found", reason: `${id.entity} ${id.txnId} has no line ${id.lineIndex}` };
  const detail = accountDetail(id.entity, line);
  if (!detail) {
    return { ...base, status: "unsupported", reason: `line ${id.lineIndex} is a ${line.DetailType ?? "non-account"} line, not an account line` };
  }
  const from = { id: detail.AccountRef?.value ?? null, name: detail.AccountRef?.name ?? null };
  const planned = { ...base, sync_token: String(txn.SyncToken ?? ""), from_account: from };
  const known = from.id ? accountsById.get(from.id) : undefined;
  const sameAsExpected = from.name === change.expect_account ||
    (known !== undefined && (known.FullyQualifiedName === change.expect_account || known.Name === change.expect_account));
  if (!sameAsExpected) {
    return { ...planned, status: "conflict", reason: `QuickBooks shows "${from.name}", the batch expected "${change.expect_account}"` };
  }
  const target = accounts.get(change.to_account);
  if (!target) {
    return {
      ...planned,
      status: "account_missing",
      to_account: { id: null, name: change.to_account },
      reason: `no active account named "${change.to_account}"; the owner creates it in QuickBooks first`,
    };
  }
  const to = { id: target.Id, name: target.FullyQualifiedName ?? target.Name, type: target.AccountType ?? null };
  if (from.id === target.Id) return { ...planned, status: "noop", to_account: to, reason: "already in the target account" };
  return { ...planned, status: "ready", to_account: to };
}

/** Hash of exactly what an apply would write. Order-independent; any SyncToken change moves it. */
export async function planHash(batchId: string, plans: LinePlan[]): Promise<string> {
  const lines = plans
    .filter((p) => p.status === "ready")
    .map((p) => [p.qb_id, p.entity, p.txn_id, p.line_index, p.sync_token, p.from_account?.id ?? null, p.to_account?.id ?? null])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const canon = JSON.stringify({ v: 1, batch_id: batchId, lines });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canon));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A copy of the transaction with the given lines moved to their target accounts. The input is not touched. */
export function withNewAccounts(entity: Entity, txn: any, moves: { lineIndex: number; to: { id: string; name: string } }[]): any {
  const copy = structuredClone(txn);
  const lines = countedLines(copy);
  for (const m of moves) {
    const detail = accountDetail(entity, lines[m.lineIndex - 1]);
    if (!detail) throw new Error(`line ${m.lineIndex} has no account to change`);
    detail.AccountRef = { value: m.to.id, name: m.to.name };
  }
  return copy;
}

export function validateBody(body: any): { ok: true; body: RecategorizeBody } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "body must be a JSON object" };
  if (typeof body.batch_id !== "string" || !body.batch_id.trim()) return { ok: false, error: "batch_id is required" };
  if (!Array.isArray(body.changes) || body.changes.length === 0) return { ok: false, error: "changes must be a non-empty array" };
  if (body.changes.length > MAX_CHANGES) return { ok: false, error: `at most ${MAX_CHANGES} changes per call` };
  const seen = new Set<string>();
  for (const [i, c] of body.changes.entries()) {
    for (const k of ["qb_id", "expect_account", "to_account"]) {
      if (typeof c?.[k] !== "string" || !c[k].trim()) return { ok: false, error: `changes[${i}].${k} is required` };
    }
    if (seen.has(c.qb_id)) return { ok: false, error: `changes[${i}]: ${c.qb_id} appears twice` };
    seen.add(c.qb_id);
  }
  if (body.dry_run === false) {
    if (typeof body.plan_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(body.plan_sha256)) {
      return { ok: false, error: "an apply needs the plan_sha256 of the dry run the owner approved" };
    }
    const a = body.approval;
    if (!a || ["approved_by", "approved_at", "ref"].some((k) => typeof a[k] !== "string" || !a[k].trim())) {
      return { ok: false, error: "an apply needs approval.approved_by, approval.approved_at and approval.ref" };
    }
    if (Number.isNaN(Date.parse(a.approved_at))) return { ok: false, error: "approval.approved_at must be a date" };
  }
  return { ok: true, body };
}

function tally(plans: LinePlan[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const p of plans) t[p.status] = (t[p.status] ?? 0) + 1;
  return t;
}

export async function runRecategorize(client: QboClient, raw: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const v = validateBody(raw);
  if (!v.ok) return { status: 400, body: { error: v.error } };
  const req = v.body;
  const dryRun = req.dry_run !== false;

  const accountList = await client.listAccounts();
  const accounts = indexAccounts(accountList);
  const accountsById = new Map(accountList.map((a) => [a.Id, a] as const));
  const txns = new Map<string, any | null>();
  const plans: LinePlan[] = [];
  for (const c of req.changes) {
    const id = parseQbId(c.qb_id);
    let txn: any | null = null;
    if (id) {
      const key = `${id.entity}:${id.txnId}`;
      if (!txns.has(key)) txns.set(key, await client.getTxn(id.entity, id.txnId));
      txn = txns.get(key) ?? null;
    }
    plans.push(planLine(c, txn, accounts, accountsById));
  }
  const plan_sha256 = await planHash(req.batch_id, plans);
  const summary = tally(plans);
  if (dryRun) return { status: 200, body: { success: true, dry_run: true, batch_id: req.batch_id, plan_sha256, summary, lines: plans } };

  if (req.plan_sha256 !== plan_sha256) {
    return {
      status: 409,
      body: {
        error: "plan_changed",
        message: "QuickBooks or the batch changed since the approved dry run. Nothing was written: dry-run again and get a fresh approval.",
        plan_sha256,
        approved_plan_sha256: req.plan_sha256,
        summary,
        lines: plans,
      },
    };
  }

  // One update per transaction, so two lines of the same transaction don't race on its SyncToken.
  const groups = new Map<string, LinePlan[]>();
  for (const p of plans) {
    if (p.status !== "ready") continue;
    const key = `${p.entity}:${p.txn_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  for (const [key, ps] of groups) {
    const entity = ps[0].entity as Entity;
    try {
      const moved = withNewAccounts(entity, txns.get(key), ps.map((p) => ({ lineIndex: p.line_index as number, to: { id: p.to_account!.id as string, name: p.to_account!.name } })));
      const updated = await client.updateTxn(entity, moved);
      for (const p of ps) {
        p.applied = true;
        p.new_sync_token = String(updated?.SyncToken ?? "");
      }
    } catch (e) {
      for (const p of ps) {
        p.applied = false;
        p.error = e instanceof Error ? e.message : String(e);
      }
    }
  }
  const applied = plans.filter((p) => p.applied === true).length;
  const failed = plans.filter((p) => p.applied === false).length;
  return {
    status: 200,
    body: { success: failed === 0, dry_run: false, batch_id: req.batch_id, plan_sha256, approval: req.approval, summary: { ...summary, applied, failed }, lines: plans },
  };
}

/** The QuickBooks calls recategorize needs: read a transaction, list active accounts, update a transaction. */
export function makeQboClient(apiBase: string, realmId: string, accessToken: string, fetchImpl: typeof fetch = fetch): QboClient {
  const headers = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };
  const url = (p: string) => `${apiBase}/v3/company/${realmId}/${p}${p.includes("?") ? "&" : "?"}minorversion=70`;
  const parse = (text: string): any => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };
  const fault = (j: any, text: string) => String(j?.Fault?.Error?.[0]?.Detail ?? j?.Fault?.Error?.[0]?.Message ?? text).slice(0, 300);
  return {
    async getTxn(entity, id) {
      const res = await fetchImpl(url(`${entity.toLowerCase()}/${encodeURIComponent(id)}`), { headers });
      const text = await res.text();
      const j = parse(text);
      if (res.ok && j?.[entity]) return j[entity];
      // A missing or deleted object comes back as a Fault with code 610 ("Object Not Found").
      if ((j?.Fault?.Error ?? []).some((e: any) => String(e?.code) === "610")) return null;
      throw new Error(`${entity} ${id} read HTTP ${res.status}: ${fault(j, text)}`);
    },
    async listAccounts() {
      const out: QboAccount[] = [];
      for (let start = 1; start < 20000; start += 1000) {
        const q = `select * from Account where Active = true startposition ${start} maxresults 1000`;
        const res = await fetchImpl(url(`query?query=${encodeURIComponent(q)}`), { headers });
        const text = await res.text();
        if (!res.ok) throw new Error(`Account query HTTP ${res.status}: ${fault(parse(text), text)}`);
        const page: QboAccount[] = parse(text)?.QueryResponse?.Account ?? [];
        out.push(...page);
        if (page.length < 1000) break;
      }
      return out;
    },
    async updateTxn(entity, txn) {
      const res = await fetchImpl(url(`${entity.toLowerCase()}?operation=update`), {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(txn),
      });
      const text = await res.text();
      const j = parse(text);
      if (!res.ok || j?.Fault || !j?.[entity]) throw new Error(`QuickBooks refused the ${entity} update (HTTP ${res.status}): ${fault(j, text)}`);
      return j[entity];
    },
  };
}
