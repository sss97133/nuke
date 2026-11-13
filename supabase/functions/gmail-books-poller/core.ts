/** Deterministic interpretations, never payment facts. No I/O or model calls. */
export const VERSION = "work-money-v1";
export interface Email {
  id: string;
  threadId?: string;
  messageId?: string;
  sender: string;
  receivedAt: string;
  subject: string;
  text: string;
  attachments?: {
    filename: string;
    attachmentId?: string;
    mimeType?: string;
  }[];
}
export interface Config {
  accountantSenders: string[];
}
export interface Signal {
  kind:
    | "payment_received"
    | "deposit"
    | "invoice"
    | "bat_payout"
    | "bat_sale_notice"
    | "books_open_question";
  direction: "inbound_claim" | "outbound" | "unknown";
  amountCents: number | null;
  currency: string | null;
  candidateCounterparty: string | null;
  candidateVehicle: string | null;
  confidence: number;
  reasons: string[];
}
export interface Job {
  id: string;
  vehicle_id: string | null;
  title: string;
  customer_name: string | null;
  customer_email: string | null;
  estimated_total: number | null;
  currency: string | null;
  created_at: string;
  status: string;
  vehicle_label?: string | null;
}
export interface Proposal {
  work_order_id: string;
  vehicle_id: string | null;
  confidence: number;
  reasons: string[];
  status: "pending_confirmation";
}
export function address(sender: string): string {
  return (sender.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
    ?.[0] ?? "").toLowerCase();
}
function domain(sender: string, host: string): boolean {
  const d = address(sender).split("@")[1];
  return d === host || !!d?.endsWith("." + host);
}
function content(email: Email): string {
  // Do not reclassify quoted history as a new payment (forwarded evidence stays unresolved).
  return email.text.split(
    /\n(?:On .+wrote:|[- ]*Original Message[- ]*|Begin forwarded message:)/i,
  )[0]
    .split("\n").filter((line) => !/^\s*>/.test(line)).join("\n");
}
export function classify(email: Email, config: Config): Signal | null {
  if (
    !email.id || !address(email.sender) ||
    !Number.isFinite(Date.parse(email.receivedAt))
  ) throw new Error("invalid_email");
  const body = content(email);
  const text = `${email.subject}\n${body}`;
  const forwarded = /^(?:fwd?|fw):/i.test(email.subject);
  const accountant = config.accountantSenders.map((x) => x.toLowerCase())
    .includes(address(email.sender));
  const books = accountant &&
    /\b(books?|invoice|balance|reconcil|tax|returns?|payment|paid|wire|receipt|open lines)\b/i
      .test(text) &&
    /\?|\b(questions?|need|confirm|who sent|unresolved|open lines)\b/i.test(
      text,
    );
  if (
    !books && /\b(earn|bonus|offer|promotion|financing|subscribe)\b/i.test(text)
  ) return null;
  const blocked =
    /\b(cancelled|canceled|rejected|failed|insufficient|scheduled|pending|request|refund|reversed|reversal)\b/i
      .test(text);
  const outbound =
    /\b(charged to|your (?:card|payment method)|you (?:paid|sent)|listing fee|(?:thanks|thank you) for (?:your payment|paying)|we (?:have )?received your payment)\b/i
      .test(text);
  let kind: Signal["kind"];
  let direction: Signal["direction"] = "unknown";
  if (books) kind = "books_open_question";
  else if (
    domain(email.sender, "bringatrailer.com") &&
    /\b(payout|proceeds)\b/i.test(text) && !blocked && !outbound
  ) {
    kind = "bat_payout";
    if (/\b(sent|deposited|paid|received)\b/i.test(text)) {
      direction = "inbound_claim";
    }
  } else if (
    domain(email.sender, "bringatrailer.com") &&
    /\b(?:your .*listing.*sold|your listing .*sold)\b/i.test(text)
  ) kind = "bat_sale_notice";
  else if (outbound && /\b(payment|invoice|receipt|fee)\b/i.test(text)) {
    kind = "invoice";
    direction = "outbound";
  } else if (
    !blocked &&
    /\b(deposit (?:received|posted|of)|deposited (?:to|into)|direct deposit (?:received|posted))\b/i
      .test(text)
  ) {
    kind = "deposit";
    direction = "inbound_claim";
  } else if (
    !blocked &&
    /\b(payment (?:was |has been )?received|received (?:a |your )?payment|sent you\s+(?:USD\s*)?\$|you(?:'ve| have)? received\s+(?:USD\s*)?\$)\b/i
      .test(text)
  ) {
    kind = "payment_received";
    direction = "inbound_claim";
  } else if (
    /\binvoice\b/i.test(email.subject) ||
    email.attachments?.some((a) => /invoice.*\.pdf$/i.test(a.filename))
  ) kind = "invoice";
  else return null;
  if (forwarded) direction = "unknown";
  const amounts = [
    ...text.matchAll(
      /(?:\b(USD|EUR|GBP|CAD|AUD)\s*[$€£]?\s*|([$€£]))\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?![\d.,])/g,
    ),
  ]
    .map((m) => ({
      currency: m[1] || ({ "$": "USD", "€": "EUR", "£": "GBP" }[m[2]]!),
      cents: Math.round(Number(m[3].replaceAll(",", "")) * 100),
    }));
  const unique = [
    ...new Map(amounts.map((a) => [`${a.currency}:${a.cents}`, a])).values(),
  ];
  const amount = unique.length === 1 && Number.isSafeInteger(unique[0].cents)
    ? unique[0]
    : null;
  const reasons = [VERSION, "source_claim_unverified"];
  if (!amount) {
    reasons.push(unique.length > 1 ? "multiple_amounts" : "amount_unknown");
  }
  if (forwarded) reasons.push("forwarded_date_and_direction_unresolved");
  const payer = text.match(
    /(?:payment (?:received )?from|received (?:a )?payment from|sender:)\s*([^\n$.;]{3,80})/i,
  )?.[1]?.trim() ??
    text.match(/(?:^|\n)([A-Z][A-Za-z .'-]{2,60}) sent you\s+\$/)?.[1]
      ?.trim() ??
    null;
  const vehicle = text.match(
    /\b(?:19|20)\d{2}\s+(?:Chevrolet|Chevy|GMC|Ford|Pontiac|Dodge|Ferrari|Volkswagen|VW|Porsche|Toyota|Jeep|BMW|Mercedes)[^\n,.;$]{0,65}/i,
  )?.[0]?.trim() ?? null;
  return {
    kind,
    direction,
    amountCents: amount?.cents ?? null,
    currency: amount?.currency ?? null,
    candidateCounterparty: payer,
    candidateVehicle: vehicle,
    confidence: books ? 0.6 : amount ? 0.75 : 0.45,
    reasons,
  };
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function mentions(
  haystack: string,
  needle: string | null | undefined,
): boolean {
  return !!needle && norm(needle).length >= 4 &&
    (` ${norm(haystack)} `).includes(` ${norm(needle)} `);
}
export function matchJobs(
  email: Email,
  signal: Signal,
  jobs: Job[],
): Proposal[] {
  // Invoice expense, sales announcements and questions are not incoming money.
  if (signal.direction !== "inbound_claim") return [];
  const text = `${email.subject}\n${content(email)}`;
  return jobs.filter((j) =>
    !["completed", "paid", "cancelled"].includes(j.status)
  ).flatMap((j) => {
    if (
      signal.currency && j.currency &&
      signal.currency !== j.currency.toUpperCase()
    ) return [];
    const reasons: string[] = [];
    let score = 0;
    if (
      signal.amountCents !== null && j.estimated_total !== null && j.currency &&
      signal.currency === j.currency.toUpperCase() &&
      signal.amountCents === Math.round(Number(j.estimated_total) * 100)
    ) {
      score += 0.3;
      reasons.push("matches_estimate_not_balance");
    }
    if (
      (j.customer_email &&
        address(email.sender) === j.customer_email.toLowerCase()) ||
      mentions(text, j.customer_name)
    ) {
      score += 0.35;
      reasons.push("counterparty_text");
    }
    if (mentions(text, j.vehicle_label)) {
      score += 0.3;
      reasons.push("vehicle_text");
    }
    const days = (Date.parse(email.receivedAt) - Date.parse(j.created_at)) /
      86400000;
    if (days >= 0 && days <= 180) {
      score += 0.05;
      reasons.push("within_180_days_of_creation");
    }
    // Amount/date alone never propose a link; preserve ties, no winner assignment.
    if (
      !reasons.some((x) => x === "counterparty_text" || x === "vehicle_text")
    ) return [];
    return [{
      work_order_id: j.id,
      vehicle_id: j.vehicle_id,
      confidence: Math.min(score, 0.95),
      reasons,
      status: "pending_confirmation" as const,
    }];
  }).sort((a, b) =>
    b.confidence - a.confidence ||
    a.work_order_id.localeCompare(b.work_order_id)
  );
}
export function buildQuery(
  after: string,
  before: string,
  config: Config,
): string {
  const senders = config.accountantSenders.map(address).filter(Boolean).map(
    (s) => `from:${s}`,
  );
  return `after:${Math.floor(Date.parse(after) / 1000)} before:${
    Math.ceil(Date.parse(before) / 1000)
  } {${
    senders.join(" ")
  } from:americafirst.com from:zellepay.com subject:payment "sent you" "deposit" "payout" "proceeds" subject:invoice filename:invoice.pdf (from:bringatrailer.com subject:sold)}`;
}
