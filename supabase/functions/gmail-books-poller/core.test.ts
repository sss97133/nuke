import {
  buildQuery,
  classify,
  type Email,
  type Job,
  matchJobs,
} from "./core.ts";
import { type Message, parseMessage } from "./gmail.ts";
import { poll, type PollDeps } from "./poller.ts";
function eq(a: unknown, b: unknown) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
}
function ok(a: unknown) {
  if (!a) throw new Error("assertion failed");
}
const config = { accountantSenders: ["accountant@example.com"] };
const base: Email = {
  id: "test",
  sender: "customer@example.com",
  receivedAt: "2026-11-01T00:00:00.000Z",
  subject: "Payment received",
  text:
    "Payment received from Example Customer: $125.00 for the 1980 Ford F100.",
};
const job: Job = {
  id: "job",
  vehicle_id: "vehicle",
  title: "Service",
  customer_name: "Example Customer",
  customer_email: "customer@example.com",
  estimated_total: 125,
  currency: "USD",
  created_at: "2026-10-01T00:00:00.000Z",
  status: "in_progress",
  vehicle_label: "1980 Ford F100",
};
Deno.test("five classes preserve explicit money and unknown books amounts", () => {
  for (
    const [subject, text, sender, kind, amount] of [
      ["Payment received", base.text, base.sender, "payment_received", 12500],
      [
        "Deposit posted",
        "Deposit of $125.00 received",
        "alerts@example.com",
        "deposit",
        12500,
      ],
      ["Invoice", "Total EUR 125.00", "vendor@example.com", "invoice", 12500],
      [
        "Payout sent",
        "Proceeds USD 125.00 sent",
        "payments@bringatrailer.com",
        "bat_payout",
        12500,
      ],
      [
        "Books questions",
        "Who sent $125? Is $250 still open?",
        "accountant@example.com",
        "books_open_question",
        null,
      ],
    ] as const
  ) {
    const signal = classify({ ...base, subject, text, sender }, config)!;
    eq(signal.kind, kind);
    eq(signal.amountCents, amount);
  }
});
Deno.test("vendor payment receipts and BaT listing fees are expenses, not inbound", () => {
  for (
    const text of [
      "Your invoice has been paid. $125.00 has been charged to your payment method.",
      "Thanks for paying the listing fee. $125.00.",
    ]
  ) {
    const s = classify({ ...base, text }, config)!;
    eq(s.direction, "outbound");
    eq(matchJobs(base, s, [job]), []);
  }
});
Deno.test("sold announcements cannot imply proceeds; marketing is ignored", () => {
  const email = {
    ...base,
    sender: "updates@bringatrailer.com",
    subject: "Your BaT listing has SOLD: 1980 Ford F100",
    text: "The winning bid was USD $125.00.",
  };
  const s = classify(email, config)!;
  eq(s.kind, "bat_sale_notice");
  eq(s.direction, "unknown");
  eq(matchJobs(email, s, [job]), []);
  eq(
    classify({
      ...base,
      subject: "Earn a bonus",
      text: "Get $125 with direct deposit",
    }, config),
    null,
  );
  eq(
    classify({
      ...base,
      subject: "1980 Ford F100 sold on BaT",
      sender: "updates@bringatrailer.com",
      text: "See the final sale price",
    }, config),
    null,
  );
});
Deno.test("failed, scheduled, reversed and requested payments are not received", () => {
  for (
    const word of [
      "cancelled",
      "rejected",
      "failed",
      "scheduled",
      "pending",
      "request",
      "refund",
      "reversed",
      "insufficient funds",
    ]
  ) {
    eq(
      classify({ ...base, text: `Payment received $125.00 ${word}` }, config),
      null,
    );
  }
});
Deno.test("forwarded and quoted old money never proposes current payment", () => {
  const e = { ...base, subject: "Fwd: Payment received" };
  const s = classify(e, config)!;
  eq(s.direction, "unknown");
  eq(matchJobs(e, s, [job]), []);
  eq(
    classify({
      ...base,
      subject: "Thanks",
      text: "Thanks\nOn yesterday someone wrote:\nPayment received $125.00",
    }, config),
    null,
  );
});
Deno.test("sender lookalike is not accountant or BaT; amounts stay ambiguous", () => {
  eq(
    classify({
      ...base,
      sender: "accountant@example.com.evil.test",
      subject: "Books questions",
      text: "Who sent $125?",
    }, config),
    null,
  );
  eq(
    classify({
      ...base,
      sender: "payments@bringatrailer.com.evil.test",
      subject: "Payout sent",
      text: "Proceeds $125 sent",
    }, config),
    null,
  );
  const s = classify({
    ...base,
    text: "Payment received $125.00; balance $250.00",
  }, config)!;
  eq(s.amountCents, null);
  ok(s.reasons.includes("multiple_amounts"));
});
Deno.test("unknown amount/currency stays unknown; repeated identical amount is not summed", () => {
  eq(
    classify({ ...base, text: "Payment received" }, config)!.amountCents,
    null,
  );
  eq(
    classify(
      { ...base, text: "Payment received $125.00 Total $125.00" },
      config,
    )!.amountCents,
    12500,
  );
  eq(
    classify(
      { ...base, text: "Payment received EUR 125.00 and USD 125.00" },
      config,
    )!.amountCents,
    null,
  );
});
Deno.test("matcher explains signals and keeps tied candidates pending", () => {
  const s = classify(base, config)!;
  const matches = matchJobs(base, s, [job, { ...job, id: "job2" }]);
  eq(matches.length, 2);
  eq(matches[0].status, "pending_confirmation");
  eq(matches[0].confidence, matches[1].confidence);
  ok(matches[0].reasons.includes("matches_estimate_not_balance"));
  ok(matches[0].reasons.includes("vehicle_text"));
});
Deno.test("amount/date alone, wrong currency and closed jobs never propose", () => {
  const e = {
    ...base,
    sender: "bank@example.com",
    text: "Payment received $125.00",
  };
  const s = classify(e, config)!;
  eq(matchJobs(e, s, [job]), []);
  eq(
    matchJobs(
      base,
      classify(base, config)!,
      ["completed", "paid", "cancelled"].map((status) => ({ ...job, status })),
    ),
    [],
  );
  eq(matchJobs(base, { ...s, currency: "EUR" }, [job]), []);
});
Deno.test("partial payments can propose identity without pretending estimate is balance", () => {
  const s = { ...classify(base, config)!, amountCents: 5000 };
  const [m] = matchJobs(base, s, [job]);
  ok(m);
  ok(!m.reasons.includes("matches_estimate_not_balance"));
});
Deno.test("query does not depend on unread and includes configured books sender", () => {
  const q = buildQuery("2026-10-01", "2026-11-01", config);
  ok(q.includes("from:accountant@example.com"));
  ok(!q.includes("is:unread"));
  ok(q.includes("before:"));
});
function raw(id = "test"): Message {
  return {
    id,
    internalDate: String(Date.parse(base.receivedAt)),
    payload: {
      headers: [{ name: "From", value: base.sender }, {
        name: "Subject",
        value: base.subject,
      }],
      mimeType: "text/plain",
      body: { data: btoa(base.text) },
    },
  };
}
Deno.test("nested Gmail MIME decodes UTF8 and keeps attachment refs without fetching", () => {
  const encoded = btoa(
    String.fromCharCode(...new TextEncoder().encode("Invoice €125.00")),
  ).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const r = raw();
  r.payload.parts = [{
    mimeType: "multipart/alternative",
    parts: [{ mimeType: "text/plain", body: { data: encoded } }, {
      mimeType: "text/html",
      body: { data: btoa("<b>duplicate</b>") },
    }],
  }, {
    filename: "invoice.pdf",
    mimeType: "application/pdf",
    body: { attachmentId: "ref" },
  }];
  delete r.payload.body;
  const e = parseMessage(r);
  eq(e.text, "Invoice €125.00");
  eq(e.attachments?.[0].attachmentId, "ref");
});
const options = {
  dryRun: false,
  after: "2026-10-31T00:00:00.000Z",
  before: "2026-11-02T00:00:00.000Z",
  config,
};
function fake() {
  const calls: string[] = [];
  const deps: PollDeps = {
    jobs: async () => [job],
    list: async (_q, page) =>
      page
        ? { messages: [{ id: "test" }, { id: "two" }] }
        : { messages: [{ id: "test" }], nextPageToken: "next" },
    message: async (id) => raw(id),
    start: async () => {
      calls.push("start");
      return "run";
    },
    stage: async () => {
      calls.push("stage");
      return true;
    },
    finish: async (_r, success, n, staged) => {
      calls.push(`finish:${success}:${n}:${staged}`);
    },
  };
  return { calls, deps };
}
Deno.test("dry run traverses pages and deduplicates without any writer calls", async () => {
  const { calls, deps } = fake();
  const result = await poll({ ...options, dryRun: true }, deps);
  eq(calls, []);
  eq(result.scanned, 2);
  eq(result.staged, 0);
  eq(result.results.length, 2);
});
Deno.test("successful scan writes only staging receipts then success", async () => {
  const { calls, deps } = fake();
  await poll(options, deps);
  eq(calls, ["start", "stage", "stage", "finish:true:2:2"]);
});
Deno.test("provider failure preserves failed status instead of successful coverage", async () => {
  const { calls, deps } = fake();
  deps.list = async () => {
    throw new Error("oauth failed");
  };
  try {
    await poll(options, deps);
    throw new Error("expected failure");
  } catch (e) {
    ok(String(e).includes("oauth failed"));
  }
  eq(calls, ["start", "finish:false:0:0"]);
});
Deno.test("empty scan is success; idempotent replay reports zero new staged rows", async () => {
  const { calls, deps } = fake();
  deps.list = async () => ({ messages: [] });
  await poll(options, deps);
  eq(calls, ["start", "finish:true:0:0"]);
  const next = fake();
  next.deps.stage = async () => false;
  await poll(options, next.deps);
  eq(next.calls, ["start", "finish:true:2:0"]);
});
Deno.test("failed stage and pagination loop fail the run", async () => {
  for (const failure of ["stage", "page"]) {
    const { calls, deps } = fake();
    if (failure === "stage") {
      deps.stage = async () => {
        throw new Error("write failed");
      };
    } else deps.list = async () => ({ messages: [], nextPageToken: "same" });
    let failed = false;
    try {
      await poll(options, deps);
    } catch {
      failed = true;
    }
    ok(failed);
    ok(calls.at(-1)?.startsWith("finish:false"));
  }
});
Deno.test("scan overflow is a visible failure and does not certify truncated coverage", async () => {
  const { calls, deps } = fake();
  deps.list = async () => ({
    messages: Array.from({ length: 251 }, (_, i) => ({ id: String(i) })),
  });
  let failed = false;
  try {
    await poll(options, deps);
  } catch {
    failed = true;
  }
  ok(failed);
  eq(calls.at(-1), "finish:false:250:250");
});
