/**
 * recategorize unit tests. Run with:
 *   deno test --allow-net supabase/functions/quickbooks-connect/recategorize.test.ts
 * (--allow-net only so the std import resolves.) Every transaction and account below is synthetic. No real
 * books data belongs in this public repo.
 */

import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  countedLines,
  indexAccounts,
  parseQbId,
  planHash,
  planLine,
  type QboAccount,
  type QboClient,
  runRecategorize,
  validateBody,
  withNewAccounts,
} from "./recategorize.ts";

const ACCOUNTS: QboAccount[] = [
  { Id: "1", Name: "Expense A", FullyQualifiedName: "Expense A", AccountType: "Expense", Active: true },
  { Id: "2", Name: "Child", FullyQualifiedName: "Parent:Child", AccountType: "Expense", Active: true },
  { Id: "3", Name: "Equity B", FullyQualifiedName: "Equity B", AccountType: "Equity", Active: true },
  { Id: "4", Name: "Old C", FullyQualifiedName: "Old C", AccountType: "Expense", Active: false },
];

// deno-lint-ignore no-explicit-any
const purchase = (id: string, sync: string, accts: [string, string][]): any => ({
  Id: id,
  SyncToken: sync,
  Line: [
    ...accts.map(([aid, name], i) => ({
      Id: String(i + 1),
      Amount: 10 * (i + 1),
      DetailType: "AccountBasedExpenseLineDetail",
      AccountBasedExpenseLineDetail: { AccountRef: { value: aid, name } },
    })),
    { Amount: 10, DetailType: "SubTotalLineDetail", SubTotalLineDetail: {} },
  ],
});

const deposit = (id: string, sync: string, aid: string, name: string) => ({
  Id: id,
  SyncToken: sync,
  Line: [{ Id: "1", Amount: 5, DetailType: "DepositLineDetail", DepositLineDetail: { AccountRef: { value: aid, name } } }],
});

function fakeClient(txns: Record<string, any>) {
  const updates: { entity: string; txn: any }[] = [];
  const client: QboClient = {
    getTxn: (entity, id) => Promise.resolve(txns[`${entity}:${id}`] ? structuredClone(txns[`${entity}:${id}`]) : null),
    listAccounts: () => Promise.resolve(ACCOUNTS),
    updateTxn: (entity, txn) => {
      updates.push({ entity, txn });
      return Promise.resolve({ ...txn, SyncToken: String(Number(txn.SyncToken) + 1) });
    },
  };
  return { client, updates };
}

Deno.test("parseQbId reads the pull_transactions id scheme and rejects anything else", () => {
  assertEquals(parseQbId("purchase-12-1"), { entity: "Purchase", txnId: "12", lineIndex: 1 });
  assertEquals(parseQbId("deposit-7-3"), { entity: "Deposit", txnId: "7", lineIndex: 3 });
  assertEquals(parseQbId("email-x-1"), null);
  assertEquals(parseQbId("purchase-12-0"), null);
  assertEquals(parseQbId("purchase-12"), null);
});

Deno.test("countedLines skips subtotal lines the way pull_transactions numbers them", () => {
  assertEquals(countedLines(purchase("1", "0", [["1", "Expense A"], ["1", "Expense A"]])).length, 2);
});

Deno.test("indexAccounts keys active accounts by full name and drops inactive ones", () => {
  const m = indexAccounts(ACCOUNTS);
  assertEquals(m.get("Parent:Child")?.Id, "2");
  assertEquals(m.has("Old C"), false);
});

Deno.test("planLine: ready, conflict, account_missing, noop, not_found, unsupported", () => {
  const m = indexAccounts(ACCOUNTS);
  const byId = new Map(ACCOUNTS.map((a) => [a.Id, a] as const));
  const t = purchase("5", "3", [["1", "Expense A"]]);
  const ready = planLine({ qb_id: "purchase-5-1", expect_account: "Expense A", to_account: "Equity B" }, t, m, byId);
  assertEquals(ready.status, "ready");
  assertEquals(ready.sync_token, "3");
  assertEquals(ready.from_account, { id: "1", name: "Expense A" });
  assertEquals(ready.to_account?.id, "3");
  assertEquals(planLine({ qb_id: "purchase-5-1", expect_account: "Parent:Child", to_account: "Equity B" }, t, m, byId).status, "conflict");
  assertEquals(planLine({ qb_id: "purchase-5-1", expect_account: "Expense A", to_account: "No Such" }, t, m, byId).status, "account_missing");
  assertEquals(planLine({ qb_id: "purchase-5-1", expect_account: "Expense A", to_account: "Expense A" }, t, m, byId).status, "noop");
  assertEquals(planLine({ qb_id: "purchase-5-2", expect_account: "Expense A", to_account: "Equity B" }, t, m, byId).status, "not_found");
  assertEquals(planLine({ qb_id: "purchase-6-1", expect_account: "Expense A", to_account: "Equity B" }, null, m, byId).status, "not_found");
  const itemLine = { Id: "9", SyncToken: "0", Line: [{ Amount: 1, DetailType: "ItemBasedExpenseLineDetail", ItemBasedExpenseLineDetail: {} }] };
  assertEquals(planLine({ qb_id: "purchase-9-1", expect_account: "Expense A", to_account: "Equity B" }, itemLine, m, byId).status, "unsupported");
  assertEquals(planLine({ qb_id: "bogus", expect_account: "Expense A", to_account: "Equity B" }, t, m, byId).status, "unsupported");
});

Deno.test("planLine accepts the short name of a sub-account the line reports by id", () => {
  const m = indexAccounts(ACCOUNTS);
  const byId = new Map(ACCOUNTS.map((a) => [a.Id, a] as const));
  const t = purchase("5", "0", [["2", "Child"]]);
  assertEquals(planLine({ qb_id: "purchase-5-1", expect_account: "Parent:Child", to_account: "Equity B" }, t, m, byId).status, "ready");
});

Deno.test("planHash ignores order and non-ready lines, and moves with any SyncToken", async () => {
  const m = indexAccounts(ACCOUNTS);
  const a = planLine({ qb_id: "purchase-5-1", expect_account: "Expense A", to_account: "Equity B" }, purchase("5", "3", [["1", "Expense A"]]), m);
  const b = planLine({ qb_id: "deposit-8-1", expect_account: "Expense A", to_account: "Equity B" }, deposit("8", "1", "1", "Expense A"), m);
  const missing = planLine({ qb_id: "purchase-6-1", expect_account: "Expense A", to_account: "Equity B" }, null, m);
  const h1 = await planHash("batch-1", [a, b, missing]);
  assertEquals(await planHash("batch-1", [b, a]), h1);
  assertNotEquals(await planHash("batch-2", [a, b]), h1);
  const a2 = planLine({ qb_id: "purchase-5-1", expect_account: "Expense A", to_account: "Equity B" }, purchase("5", "4", [["1", "Expense A"]]), m);
  assertNotEquals(await planHash("batch-1", [a2, b]), h1);
});

Deno.test("withNewAccounts changes only the named line and leaves the input alone", () => {
  const t = purchase("5", "0", [["1", "Expense A"], ["1", "Expense A"]]);
  const moved = withNewAccounts("Purchase", t, [{ lineIndex: 2, to: { id: "3", name: "Equity B" } }]);
  assertEquals(moved.Line[0].AccountBasedExpenseLineDetail.AccountRef.value, "1");
  assertEquals(moved.Line[1].AccountBasedExpenseLineDetail.AccountRef, { value: "3", name: "Equity B" });
  assertEquals(moved.Line[1].Amount, t.Line[1].Amount);
  assertEquals(t.Line[1].AccountBasedExpenseLineDetail.AccountRef.value, "1");
});

Deno.test("validateBody: an apply needs a plan hash and an approval; duplicates are refused", () => {
  const changes = [{ qb_id: "purchase-5-1", expect_account: "Expense A", to_account: "Equity B" }];
  assert(validateBody({ batch_id: "b", changes }).ok);
  assertEquals(validateBody({ batch_id: "b", changes: [...changes, ...changes] }).ok, false);
  assertEquals(validateBody({ batch_id: "b", changes, dry_run: false }).ok, false);
  assertEquals(validateBody({ batch_id: "b", changes, dry_run: false, plan_sha256: "a".repeat(64) }).ok, false);
  const approval = { approved_by: "owner", approved_at: "2026-01-01T00:00:00Z", ref: "chat" };
  assert(validateBody({ batch_id: "b", changes, dry_run: false, plan_sha256: "a".repeat(64), approval }).ok);
  assertEquals(validateBody({ batch_id: "b", changes: [] }).ok, false);
  assertEquals(validateBody({ changes }).ok, false);
});

Deno.test("runRecategorize: dry run by default never writes", async () => {
  const { client, updates } = fakeClient({ "Purchase:5": purchase("5", "0", [["1", "Expense A"]]) });
  const r = await runRecategorize(client, { batch_id: "b", changes: [{ qb_id: "purchase-5-1", expect_account: "Expense A", to_account: "Equity B" }] });
  assertEquals(r.status, 200);
  assertEquals(r.body.dry_run, true);
  assertEquals((r.body.summary as Record<string, number>).ready, 1);
  assertEquals(updates.length, 0);
});

Deno.test("runRecategorize: an apply with a stale or foreign plan hash writes nothing (409)", async () => {
  const { client, updates } = fakeClient({ "Purchase:5": purchase("5", "0", [["1", "Expense A"]]) });
  const approval = { approved_by: "owner", approved_at: "2026-01-01T00:00:00Z", ref: "chat" };
  const r = await runRecategorize(client, {
    batch_id: "b",
    changes: [{ qb_id: "purchase-5-1", expect_account: "Expense A", to_account: "Equity B" }],
    dry_run: false,
    plan_sha256: "0".repeat(64),
    approval,
  });
  assertEquals(r.status, 409);
  assertEquals(updates.length, 0);
});

Deno.test("runRecategorize: an approved plan applies once per transaction and reports each line", async () => {
  const { client, updates } = fakeClient({
    "Purchase:5": purchase("5", "0", [["1", "Expense A"], ["1", "Expense A"]]),
    "Deposit:8": deposit("8", "2", "1", "Expense A"),
  });
  const changes = [
    { qb_id: "purchase-5-1", expect_account: "Expense A", to_account: "Equity B" },
    { qb_id: "purchase-5-2", expect_account: "Expense A", to_account: "Parent:Child" },
    { qb_id: "deposit-8-1", expect_account: "Expense A", to_account: "Equity B" },
    { qb_id: "purchase-5-3", expect_account: "Expense A", to_account: "Equity B" },
  ];
  const dry = await runRecategorize(client, { batch_id: "b", changes });
  const approval = { approved_by: "owner", approved_at: "2026-01-01T00:00:00Z", ref: "chat" };
  const r = await runRecategorize(client, { batch_id: "b", changes, dry_run: false, plan_sha256: dry.body.plan_sha256 as string, approval });
  assertEquals(r.status, 200);
  assertEquals(updates.length, 2);
  const p = updates.find((u) => u.entity === "Purchase")!.txn;
  assertEquals(p.Line[0].AccountBasedExpenseLineDetail.AccountRef.value, "3");
  assertEquals(p.Line[1].AccountBasedExpenseLineDetail.AccountRef.value, "2");
  const d = updates.find((u) => u.entity === "Deposit")!.txn;
  assertEquals(d.Line[0].DepositLineDetail.AccountRef.value, "3");
  const lines = r.body.lines as { qb_id: string; applied?: boolean; status: string }[];
  assertEquals(lines.filter((l) => l.applied === true).length, 3);
  assertEquals(lines.find((l) => l.qb_id === "purchase-5-3")?.status, "not_found");
  assertEquals((r.body.summary as Record<string, number>).failed, 0);
});

Deno.test("runRecategorize: a QuickBooks refusal is reported per line, not thrown", async () => {
  const { client } = fakeClient({ "Purchase:5": purchase("5", "0", [["1", "Expense A"]]) });
  client.updateTxn = () => Promise.reject(new Error("refused"));
  const changes = [{ qb_id: "purchase-5-1", expect_account: "Expense A", to_account: "Equity B" }];
  const dry = await runRecategorize(client, { batch_id: "b", changes });
  const approval = { approved_by: "owner", approved_at: "2026-01-01T00:00:00Z", ref: "chat" };
  const r = await runRecategorize(client, { batch_id: "b", changes, dry_run: false, plan_sha256: dry.body.plan_sha256 as string, approval });
  assertEquals(r.body.success, false);
  assertEquals((r.body.lines as { error?: string }[])[0].error, "refused");
});
