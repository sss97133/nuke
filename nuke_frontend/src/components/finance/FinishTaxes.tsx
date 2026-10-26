import { useEffect, useState } from 'react';
import { Text } from '../../kit/Text';
import { useAccountingBook } from './AccountingBookContext';
import {
  dollars, fetchAccountingOriginal, pacific, readCloseout, readCloseoutRecords,
  type Closeout, type CloseoutItem, type CloseoutItemKey, type CloseoutYear,
} from '../../services/accountingCloseout';

export type Drill = { year: string; item: CloseoutItemKey; label: string };

/** Plain words for each close-out item. The reader decides membership; this only names it. */
export const ITEM_WORDS: Record<CloseoutItemKey, { label: string; why: string; drill: boolean }> = {
  expense_no_proof: { label: 'Expenses with no bank line and no receipt', why: 'Nothing on file shows these were paid.', drill: true },
  revenue_no_payer: { label: 'Income with no named payer', why: 'A deposit counts as income unless it is shown to be a transfer, loan or refund.', drill: true },
  expense_no_receipt: { label: 'Expenses paid, but no receipt', why: 'The bank line proves payment, not what was bought.', drill: true },
  car_cost_no_car: { label: 'Car costs with no car named', why: 'Decides which car, and which year, the cost lands in.', drill: true },
  statement_gaps: { label: 'Months with no statement lines', why: 'Either the statement is missing or the account had no activity that month.', drill: false },
};

/** Tax that rides on an amount, from the draft's own measured rate per $1,000 of expenses. */
export function taxAtStake(amount: number | null, per1000: number | null | undefined): number | null {
  if (amount === null || per1000 === null || per1000 === undefined || !Number.isFinite(amount) || !Number.isFinite(per1000)) return null;
  return Math.abs(amount) / 1000 * Math.abs(per1000);
}

/** Order: items with money at stake, largest first; then the rest; not-assessed last. */
/** What the stake means, in plain words. Expenses: tax added if they were disallowed. Income: tax removed if a deposit is shown not to be income. */
export function stakeWords(key: CloseoutItemKey, stake: number, per1000: number): string {
  const rate = dollars(Math.abs(per1000));
  return key === 'revenue_no_payer'
    ? `If these turned out to be transfers, loans or refunds, about ${dollars(stake)} less tax. Each $1,000 shown not to be income saves about ${rate}.`
    : `If these were disallowed, about ${dollars(stake)} more tax. Each $1,000 proven keeps about ${rate}.`;
}

export function rankItems(items: CloseoutItem[]): CloseoutItem[] {
  const weight = (i: CloseoutItem) => !i.assessed ? -2 : (i.n ?? 0) === 0 ? -1 : i.key === 'statement_gaps' ? 0 : Math.abs(i.amount ?? 0);
  return [...items].sort((a, b) => weight(b) - weight(a));
}

export function netAcrossYears(years: CloseoutYear[]): { owe: number; count: number; first: string; last: string } | null {
  const drafts = years.filter(y => y.return && Number.isFinite(Number(y.return.amount)));
  if (!drafts.length) return null;
  const owe = drafts.reduce((sum, y) => sum + (y.return!.result === 'owe' ? 1 : -1) * Number(y.return!.amount), 0);
  const names = drafts.map(y => y.year).sort();
  return { owe, count: drafts.length, first: names[0], last: names.at(-1)! };
}

function YearCard({ y, revenue, onDrill }: { y: CloseoutYear; revenue: CloseoutItem | undefined; onDrill: (drill: Drill) => void }) {
  const { ownerId } = useAccountingBook();
  const [opening, setOpening] = useState('');
  const r = y.return;
  const per1000 = r?.tax_per_1000_expense ?? null;
  // Income with no named payer is read per year only where the year has income records; elsewhere it does not apply.
  const hasRevenue = (y.books?.revenue_records ?? 0) > 0;
  const items = rankItems(y.items.map(i => i.key === 'revenue_no_payer' && revenue ? revenue : i).filter(i => i.assessed || (i.key === 'revenue_no_payer' && hasRevenue)));
  const open = async () => {
    if (!r || !ownerId) return;
    setOpening('Opening the draft…');
    try {
      const { blob } = await fetchAccountingOriginal(ownerId, r.document_id);
      window.open(URL.createObjectURL(blob), '_blank', 'noopener');
      setOpening('');
    } catch { setOpening('The draft could not be opened.'); }
  };
  return <article className="accounting-close-year" aria-label={`Tax year ${y.year}`}>
    <header className="accounting-close-year__head">
      <Text role="label" as="h3">{y.year}{r ? ` · Form ${r.form} draft` : ''}</Text>
      {r ? <Text role="figure" as="p" className="accounting-close-answer">{r.result === 'owe' ? `You owe ${dollars(r.amount)}` : `You get back ${dollars(r.amount)}`}</Text>
        : <Text role="body" as="p">No return draft is in the books for {y.year}.</Text>}
      <Text role="caption" as="p">
        {[r?.schedule_c_net != null ? `Schedule C net ${dollars(r.schedule_c_net)}` : null,
          r ? `draft built ${pacific(r.built_at)}` : null,
          y.books?.revised_at ? `books changed ${pacific(y.books.revised_at)}` : null].filter(Boolean).join(' · ')}
      </Text>
      {y.draft_stale && <p role="alert" className="accounting-close-stale"><Text role="body">The books changed after this draft was built. Regenerate it before signing.</Text></p>}
    </header>
    <ol className="accounting-close-list">
      {items.map(item => {
        const words = ITEM_WORDS[item.key];
        const stake = item.key === 'statement_gaps' || item.key === 'car_cost_no_car' ? null : taxAtStake(item.amount, per1000);
        const pending = item.key === 'revenue_no_payer' && !revenue && item.deferred;
        const body = <>
          <span className="accounting-close-item__main">
            <Text role="body">{words.label}</Text>
            <Text role="caption">{pending ? 'Checking…' : !item.assessed ? 'Not assessed' : item.key === 'statement_gaps'
              ? `${item.n ?? 0} of ${item.of ?? 0} account-months`
              : `${(item.n ?? 0).toLocaleString('en-US')} of ${(item.of ?? 0).toLocaleString('en-US')} records · ${words.why}`}</Text>
            {stake !== null && (item.n ?? 0) > 0 && <Text role="caption">{stakeWords(item.key, stake, per1000!)}</Text>}
            {item.key === 'statement_gaps' && (item.accounts || []).slice(0, 3).map(a => <Text role="caption" key={a.account || 'unknown'}>{a.account || 'Account not recorded'}: {a.months_without_lines.length} of {a.months_in_span} months</Text>)}
          </span>
          {item.key !== 'statement_gaps' && item.assessed && <Text role="measure" className="accounting-close-item__amount">{dollars(item.amount)}</Text>}
        </>;
        return <li key={item.key} className="accounting-close-item">
          {words.drill && item.assessed && (item.n ?? 0) > 0
            ? <button type="button" className="accounting-close-item__button" onClick={() => onDrill({ year: y.year, item: item.key, label: words.label })}>{body}<span aria-hidden="true">›</span></button>
            : <div className="accounting-close-item__button">{body}</div>}
        </li>;
      })}
      {y.draft_stale && <li className="accounting-close-item"><div className="accounting-close-item__button"><span className="accounting-close-item__main">
        <Text role="body">Regenerate the {y.year} draft</Text><Text role="caption">Built from the books as of {pacific(r?.books_as_of)}. Ask the books agent to rebuild and republish it.</Text></span></div></li>}
      {r && <li className="accounting-close-item accounting-close-item--you"><div className="accounting-close-item__button"><span className="accounting-close-item__main">
        <Text role="body">Sign and mail (your step)</Text>
        <Text role="caption">{[r.filing?.signers ? `Signed by ${r.filing.signers}` : null, r.filing?.method, r.filing?.mail_to ? `to ${r.filing.mail_to}` : null,
          r.filing?.deadline ? `deadline ${pacific(r.filing.deadline, false)}` : null].filter(Boolean).join(' · ')}</Text>
        {r.filing?.before_signing && <Text role="caption">Before signing: {r.filing.before_signing}.</Text>}
        {r.filing?.open_items && <Text role="caption">Still open: {r.filing.open_items}.</Text>}
      </span><button type="button" onClick={open}>Open the draft</button></div>{opening && <Text role="caption" as="p">{opening}</Text>}</li>}
    </ol>
  </article>;
}

/** "Finish your taxes": per year, what the draft says you owe or get back, whether it is current, and what is left. */
export default function FinishTaxes({ onDrill, onQuestions, resolverLabel }: { onDrill: (drill: Drill) => void; onQuestions: () => void; resolverLabel?: (name: string) => string }) {
  const { ownerId, liveRevision } = useAccountingBook();
  const [state, setState] = useState<{ owner: string; data: Closeout | null; error: boolean } | null>(null);
  const [revenue, setRevenue] = useState<Record<string, CloseoutItem>>({});
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!ownerId) return;
    let cancelled = false;
    setState(previous => previous?.owner === ownerId ? previous : { owner: ownerId, data: null, error: false });
    readCloseout(ownerId).then(data => {
      if (cancelled) return;
      setState({ owner: ownerId, data, error: false });
      // The revenue gate costs a few seconds a year; read it per year, in parallel, after the page is up.
      for (const y of data.years.filter(y => y.books && y.books.revenue_records > 0)) {
        readCloseoutRecords(ownerId, y.year, 'revenue_no_payer', 1, 0).then(result => {
          if (!cancelled) setRevenue(current => ({ ...current, [y.year]: { key: 'revenue_no_payer', assessed: result.assessed, n: result.total, of: y.books!.revenue_records, amount: result.amount } }));
        }).catch(() => { if (!cancelled) setRevenue(current => ({ ...current, [y.year]: { key: 'revenue_no_payer', assessed: false, n: null, of: y.books!.revenue_records, amount: null } })); });
      }
    }).catch(() => { if (!cancelled) setState(previous => ({ owner: ownerId, data: previous?.owner === ownerId ? previous.data : null, error: true })); });
    return () => { cancelled = true; };
  }, [ownerId, liveRevision, retry]);
  if (!ownerId) return null;
  if (!state || state.owner !== ownerId || (!state.data && !state.error)) return <p role="status"><Text role="caption">Reading where each tax year stands…</Text></p>;
  if (!state.data) return <p role="alert"><Text role="body">Where each tax year stands could not load.</Text> <button type="button" onClick={() => setRetry(n => n + 1)}>Try again</button></p>;
  const years = state.data.years.filter(y => y.return || y.books);
  const net = netAcrossYears(years);
  const questions = Object.entries(state.data.questions.by_resolver).filter(([name]) => name !== 'model_reconciliation').sort((a, b) => b[1] - a[1]);
  const notes = state.data.questions.by_resolver.model_reconciliation || 0;
  return <section className="accounting-close" aria-label="Finish your taxes">
    <div className="accounting-section-heading"><Text role="entity" as="h2">Finish your taxes</Text></div>
    {net && <Text role="body" as="p">{net.count === 1 ? `The ${net.first} draft says` : `Across the ${net.first}–${net.last} drafts,`} {net.owe > 0 ? `you owe ${dollars(net.owe)}` : `you get back ${dollars(-net.owe)}`}{net.count > 1 ? ' net' : ''}, before penalties and interest.</Text>}
    {questions.length > 0 && <button type="button" className="accounting-close-questions" onClick={onQuestions}>
      <Text role="body">Open questions: {questions.map(([name, n]) => `${resolverLabel ? resolverLabel(name) : name} ${n.toLocaleString('en-US')}`).join(' · ')}</Text>
      {notes > 0 && <Text role="caption">plus {notes.toLocaleString('en-US')} agent notes</Text>}<span aria-hidden="true">›</span></button>}
    <div className="accounting-close-years">{years.map(y => <YearCard key={y.year} y={y} revenue={revenue[y.year]} onDrill={onDrill} />)}</div>
    {state.error && <Text role="caption" as="p">Showing the last loaded status; a refresh failed.</Text>}
    <Text role="caption" as="p">Read {pacific(state.data.read_at)}. Drafts are unsigned; amounts are whole dollars from each draft.</Text>
  </section>;
}
