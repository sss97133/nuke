import { useState } from 'react';
import { Text } from '../../kit/Text';
import { useAccountingBook } from './AccountingBookContext';
import {
  dollars, fetchAccountingOriginal, pacific, readCloseout, readCloseoutRecords,
  type YearState, type CloseoutItem, type CloseoutItemKey, type CloseoutYear, type DrillItem,
} from '../../services/accountingCloseout';
import { FILING_WORDS, filingOf } from './filingState';
import { CloseItem, CloseYear, ReadState } from './CloseItem';
import { HEAVY_GAP_MS, useRevisionRead, useYearReads, useYearStates } from './useRevisionRead';

/** What the office's row list is asked to show: a close-out item, or the decisions behind a number of the books docket. */
export type Drill = { year: string; item: DrillItem; label: string };

/** Plain words for each close-out item. The reader decides membership; this only names it. */
export const ITEM_WORDS: Record<CloseoutItemKey, { label: string; why: string; drill: boolean }> = {
  expense_no_proof: { label: 'Expenses with no bank line and no receipt', why: 'Nothing on file shows these were paid.', drill: true },
  revenue_no_payer: { label: 'Income with no named payer', why: 'A deposit counts as income unless it is shown to be a transfer, loan or refund.', drill: true },
  expense_no_receipt: { label: 'Expenses paid, but no receipt', why: 'The bank line proves payment, not what was bought.', drill: true },
  car_cost_no_car: { label: 'Car costs with no car named', why: 'Decides which car, and which year, the cost lands in.', drill: true },
  statement_gaps: { label: 'Months with no statement lines', why: 'Either the statement is missing or the account had no activity that month.', drill: false },
};

/** Items the reader still returns that the list does not show. The owner ruled on 2026-10-28 that bank lines need no explanation, their allocation does,
 *  and receipts are required per line only where section 274 says so. The books docket shows how the deductions are supported by that definition (tiers A,
 *  B, C), and the deductions with no bank line, ruling or rule, in their place:
 *   - expense_no_receipt asked for a receipt on every paid line;
 *   - expense_no_proof counted the statement-side direction only (an expense that no statement line lists and no receipt is tied to), which says 2022 and
 *     2023 are almost wholly unproven while the docket's deductions-with-no-bank-line count (rule R10 part b) is zero for them: two answers to one question
 *     on one tab. Which direction defines a bank line is the owner's ruling (docs/books-docket.md, known gaps); until then the docket's answer stands alone. */
export const HIDDEN_ITEMS: ReadonlySet<CloseoutItemKey> = new Set<CloseoutItemKey>(['expense_no_receipt', 'expense_no_proof']);

/** What a draft's own measured rate means for income with no named payer, in plain words. The rate is the draft's (tax_per_1000_expense); nothing is multiplied
 *  by it here, so no tax figure is computed on this page. */
export function stakeWords(key: CloseoutItemKey, per1000: number): string | null {
  return key === 'revenue_no_payer'
    ? `Each $1,000 shown not to be income (a transfer, loan or refund) saves about ${dollars(Math.abs(per1000))} of tax, at the draft's own rate.`
    : null;
}

/** Order: items with money at stake, largest first; then the rest; not-assessed last. */
export function rankItems(items: CloseoutItem[]): CloseoutItem[] {
  const weight = (i: CloseoutItem) => !i.assessed ? -2 : (i.n ?? 0) === 0 ? -1 : i.key === 'statement_gaps' ? 0 : Math.abs(i.amount ?? 0);
  return [...items].sort((a, b) => weight(b) - weight(a));
}

/** The settled line-31 net across a year's Schedule C forms (books_year_state), or null before it loads. */
export function scheduleCNet(state: YearState | undefined): number | null {
  const forms = Object.values(state?.schedule_c ?? {});
  return forms.length ? forms.reduce((sum, lines) => sum + Number(lines['31'] ?? 0), 0) : null;
}

function YearCard({ y, revenue, state, onDrill }: { y: CloseoutYear; revenue: CloseoutItem | undefined; state: YearState | undefined; onDrill: (drill: Drill) => void }) {
  const { ownerId } = useAccountingBook();
  const [opening, setOpening] = useState('');
  const r = y.return;
  const filing = filingOf(state);
  // The newest result wins: a rebuilt draft whose PDF is not yet in the books still answers through its result fact.
  const res = state?.result ?? r;
  const net = scheduleCNet(state) ?? r?.schedule_c_net ?? null;
  const per1000 = r?.tax_per_1000_expense ?? null;
  // Income with no named payer is read per year only where the year has income records; elsewhere it does not apply.
  const hasRevenue = (y.books?.revenue_records ?? 0) > 0;
  const items = rankItems(y.items.filter(i => !HIDDEN_ITEMS.has(i.key)).map(i => i.key === 'revenue_no_payer' && revenue ? revenue : i).filter(i => i.assessed || (i.key === 'revenue_no_payer' && hasRevenue)));
  const open = async () => {
    if (!r || !ownerId) return;
    setOpening('Opening the draft…');
    try {
      const { blob } = await fetchAccountingOriginal(ownerId, r.document_id);
      window.open(URL.createObjectURL(blob), '_blank', 'noopener');
      setOpening('');
    } catch { setOpening('The draft could not be opened.'); }
  };
  const head = <>
    <Text role="label" as="h3">{y.year}{res ? ` · Form ${res.form} draft` : ''}</Text>
    {res ? <Text role="figure" as="p" className="accounting-close-answer">{res.result === 'owe' ? `You owe ${dollars(res.amount)}` : `You get back ${dollars(res.amount)}`}</Text>
      : <Text role="body" as="p">No return draft is in the books for {y.year}.</Text>}
    <Text role="caption" as="p">
      {[net != null ? `Schedule C net ${dollars(net)}` : null, res?.built_at ? `draft built ${pacific(res.built_at)}` : null].filter(Boolean).join(' · ')}
    </Text>
    {/* Whether the return still matches the books is the gate's answer (rule R9, in the books docket above), never a comparison of timestamps. */}
    {filing?.state === 'on_hold' && <Text role="caption" as="p">{FILING_WORDS.on_hold} as of {pacific(filing.as_of, false)}.</Text>}
  </>;
  return <CloseYear id={`close-${y.year}`} label={`Tax year ${y.year}`} head={head} after={state && state.facts.length + state.rulings.length > 0 && <details>
      <summary><Text role="body">Settled for {y.year}: {state.facts.length} return facts, {state.rulings.length} Schedule C rulings</Text></summary>
      <ol className="accounting-close-list">
        {state.facts.map(f => <CloseItem key={f.local_id}>
          <Text role="body">{f.decision}</Text>
          <Text role="caption">{[f.topic.replace(/_/g, ' '), pacific(f.date, false), f.source].filter(Boolean).join(' · ')}</Text>
        </CloseItem>)}
        {state.rulings.map(x => <CloseItem key={x.local_id} amount={x.amount != null ? dollars(x.amount) : undefined}>
          <Text role="body">{x.label}</Text>
          {x.decision && <Text role="caption">{x.decision}</Text>}
        </CloseItem>)}
      </ol>
    </details>}>
    {items.map(item => {
      const words = ITEM_WORDS[item.key];
      const stake = per1000 !== null && item.key !== 'statement_gaps' && item.key !== 'car_cost_no_car' && (item.n ?? 0) > 0 ? stakeWords(item.key, per1000) : null;
      const pending = item.key === 'revenue_no_payer' && !revenue && item.deferred;
      return <CloseItem key={item.key} amount={item.key !== 'statement_gaps' && item.assessed ? dollars(item.amount) : undefined}
        onClick={words.drill && item.assessed && (item.n ?? 0) > 0 ? () => onDrill({ year: y.year, item: item.key, label: words.label }) : undefined}>
        <Text role="body">{words.label}</Text>
        <Text role="caption">{pending ? 'Checking…' : !item.assessed ? 'Not assessed' : item.key === 'statement_gaps'
          ? `${item.n ?? 0} of ${item.of ?? 0} account-months`
          : `${(item.n ?? 0).toLocaleString('en-US')} of ${(item.of ?? 0).toLocaleString('en-US')} records · ${words.why}`}</Text>
        {stake && <Text role="caption">{stake}</Text>}
        {item.key === 'statement_gaps' && (item.accounts || []).slice(0, 3).map(a => <Text role="caption" key={a.account || 'unknown'}>{a.account || 'Account not recorded'}: {a.months_without_lines.length} of {a.months_in_span} months</Text>)}
      </CloseItem>;
    })}
    {state?.open_items.map(f => <CloseItem key={f.local_id} amount={f.amount != null ? dollars(f.amount) : undefined}>
      <Text role="body">{f.decision}</Text>
      {f.closes_with && <Text role="caption">Closes with: {f.closes_with}</Text>}
    </CloseItem>)}
    {r && <CloseItem className="accounting-close-item--you" action={<button type="button" onClick={open}>Open the draft</button>}
      below={opening ? <Text role="caption" as="p">{opening}</Text> : undefined}>
      <Text role="body">Sign and mail (your step)</Text>
      <Text role="caption">{[r.filing?.signers ? `Signed by ${r.filing.signers}` : null, r.filing?.method, r.filing?.mail_to ? `to ${r.filing.mail_to}` : null,
        r.filing?.deadline ? `deadline ${pacific(r.filing.deadline, false)}` : null].filter(Boolean).join(' · ')}</Text>
      {r.filing?.before_signing && <Text role="caption">Before signing: {r.filing.before_signing}.</Text>}
      {r.filing?.open_items && <Text role="caption">Still open: {r.filing.open_items}.</Text>}
    </CloseItem>}
  </CloseYear>;
}

/** "Finish your taxes": per year, what the draft says you owe or get back and what is left. Whether the return still matches the books is the
 *  stored gate's answer (books docket, rule R9); the paperwork state comes from the facts register. Each year's answer is the draft's own: nothing is added
 *  across years here, because no year's draft is more than the database says it is. */
export default function FinishTaxes({ onDrill, onQuestions, resolverLabel }: { onDrill: (drill: Drill) => void; onQuestions: () => void; resolverLabel?: (name: string) => string }) {
  const { ownerId, liveRevision } = useAccountingBook();
  const closeout = useRevisionRead('closeout', signal => readCloseout(ownerId!, signal), { scope: ownerId, enabled: !!ownerId, revision: liveRevision, minGapMs: HEAVY_GAP_MS });
  const years = (closeout.data?.years ?? []).filter(y => y.return || y.books);
  const ready = closeout.phase === 'ready';
  // One read of each year's state serves this card and the books docket; the income gate costs a few seconds a year, read per year after the page is up.
  const { data: yearStates } = useYearStates(ownerId, years.map(y => y.year), { enabled: ready, revision: liveRevision });
  const withIncome = years.filter(y => y.books && y.books.revenue_records > 0);
  const gates = useYearReads('revenue-gate', ownerId, withIncome.map(y => y.year), (year, signal) => readCloseoutRecords(ownerId!, year, 'revenue_no_payer', 1, 0, signal),
    { enabled: ready, revision: liveRevision, minGapMs: HEAVY_GAP_MS });
  const revenue: Record<string, CloseoutItem> = {};
  for (const y of withIncome) {
    const gate = gates.data[y.year];
    if (gate) revenue[y.year] = { key: 'revenue_no_payer', assessed: gate.assessed, n: gate.total, of: y.books!.revenue_records, amount: gate.amount };
    else if (gates.status[y.year] === 'error') revenue[y.year] = { key: 'revenue_no_payer', assessed: false, n: null, of: y.books!.revenue_records, amount: null };
  }
  if (!ownerId) return null;
  if (!closeout.data) return <ReadState what="Where each tax year stands" failed={closeout.phase === 'error'} onRetry={closeout.retry} />;
  const data = closeout.data;
  const questions = Object.entries(data.questions.by_resolver).filter(([name]) => name !== 'model_reconciliation').sort((a, b) => b[1] - a[1]);
  const notes = data.questions.by_resolver.model_reconciliation || 0;
  return <section className="accounting-close" aria-label="Finish your taxes">
    <div className="accounting-section-heading"><Text role="entity" as="h2">Finish your taxes</Text></div>
    {questions.length > 0 && <button type="button" className="accounting-close-questions" onClick={onQuestions}>
      <Text role="body">Open questions: {questions.map(([name, n]) => `${resolverLabel ? resolverLabel(name) : name} ${n.toLocaleString('en-US')}`).join(' · ')}</Text>
      {notes > 0 && <Text role="caption">plus {notes.toLocaleString('en-US')} agent notes</Text>}<span aria-hidden="true">›</span>
      <Text role="caption" className="accounting-close-questions__source">Pending questions on the current reading, from the review queue (financial_review_queue) · read {pacific(data.read_at)}</Text></button>}
    <div className="accounting-close-years">{years.map(y => <YearCard key={y.year} y={y} revenue={revenue[y.year]} state={yearStates[y.year]} onDrill={onDrill} />)}</div>
    {closeout.refreshFailed && <Text role="caption" as="p">Showing the last loaded status; a refresh failed.</Text>}
    <Text role="caption" as="p">Counts read {pacific(data.read_at)} from the close-out (accounting_closeout); filing state and facts from the facts register (books_year_state). Drafts are unsigned; amounts are whole dollars from each draft.</Text>
  </section>;
}
