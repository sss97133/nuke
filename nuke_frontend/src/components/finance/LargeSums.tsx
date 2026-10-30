import { useEffect, useId, useRef, useState } from 'react';
import { Text } from '../../kit/Text';
import { dollars, pacific, type GateYear, type LargeSumRow, type LargeSumYear, type TierYear } from '../../services/accountingCloseout';
import { processFinancialDocument, type DocumentLinkTarget, type FinancialIntakeStage } from '../../services/financialEvidenceIntake';
import type { SavedRecord } from './FinancialWorkpapers';
import type { Drill } from './FinishTaxes';
import { Item } from './DocketItem';
import * as W from './booksDocketWords';

/** The first screen of the books docket, per tax year: the two totals the owner reads (dollars paid outside a linked bank line, rule R10 part b, and dollars
 *  missing a document, rule R12), each from the stored gate run with its denominator and the run's time; then the rows rule R12 flags, read live from
 *  v_books_large_sums, largest dollars first, each with what it still needs in plain words and, where a file can answer it, a way to add that file.
 *  Nothing here is summed, divided or compared: the database states every count, dollar and flag, and this names them. */

const STAGE_WORDS: Record<FinancialIntakeStage, string> = {
  checking: 'Checking the file…', uploading: 'Uploading it privately…', processing: 'Adding it to the books…', verifying: 'Checking it landed…', linking: 'Linking it to the row…',
};
const SHOWN_FIRST = 10;

/** The two totals of a year: the gate run's own numbers, with the run's time and whether the books changed since beside them; with no stored run, the live
 *  readers' figures for the same conditions, said to be live. The dollars paid outside a linked bank line open the deductions behind them in the office's
 *  row list (the same class the audit tiers count apart); the dollars missing a document are the rows listed right below. */
export function PaperTotals({ y, sums, tier, onDrill }: { y: GateYear; sums?: W.LiveRead<LargeSumYear>; tier?: W.LiveRead<TierYear>; onDrill?: (drill: Drill) => void }) {
  const totals = [W.outsideBankTotal(y, tier), W.missingDocTotal(y, sums)];
  const run = y.run;
  const source = (t: W.PaperTotal) => t.source === 'stored' && run ? `, from the gate run of ${pacific(run.finished_at)}${run.stale ? ' · the books or the gate changed since that run' : ''}`
    : t.source === 'live' ? ', read live' : '';
  return <>
    {totals.map(t => {
      const opens = onDrill && t.rule === 'R10 part b' && t.state === 'bad';
      return <Item key={t.label} warn={t.state === 'bad'} onClick={opens ? () => onDrill({ year: String(y.year), item: 'no_pay_no_ruling', label: t.label }) : undefined}>
        <Text role="label">{t.label}</Text>
        <Text role="measure" className="accounting-paper-total" data-state={t.state}>{t.headline}</Text>
        {t.details.map(line => <Text role="caption" key={line}>{line}</Text>)}
        <Text role="caption">Rule {t.rule}{source(t)}{opens ? ' · open the deductions behind it' : ''}</Text>
      </Item>;
    })}
  </>;
}

function AttachPanel({ row, onAttached }: { row: LargeSumRow; onAttached: () => void }) {
  const choices = W.attachChoices(row);
  const fileId = useId(), kindId = useId();
  const [kind, setKind] = useState(choices[0]);
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<FinancialIntakeStage | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const mounted = useRef(true);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const submit = async () => {
    if (!file || stage) return;
    const target: DocumentLinkTarget = { year: row.year, local_id: row.local_id, source_key: row.record.source_key!, decision_document_id: row.document_id, doc_kind: kind, required_doc_kind: row.required_doc_kind };
    setStage('checking'); setMessage(null);
    try {
      const result = await processFinancialDocument(file, next => { if (mounted.current) setStage(next); }, target);
      if (!mounted.current) return;
      setMessage({ ok: true, text: result.linked?.already ? 'This file was already added for this row.' : 'Added. The file is stored privately and pointed at this row. Document received, link pending: the row stays on the list until the books agent cites it in the books.' });
      setFile(null); if (input.current) input.current.value = '';
      onAttached();
    } catch (error) {
      if (mounted.current) setMessage({ ok: false, text: error instanceof Error ? error.message : 'The file could not be added. Nothing was changed.' });
    } finally { if (mounted.current) setStage(null); }
  };
  return <div className="accounting-paper-attach" role="group" aria-label={`Add the paper for ${W.rowTitle(row)}`}>
    <Text role="caption" as="p">{W.paperWord(row) ? `This row needs: ${W.paperWord(row)}. ` : ''}A photo or PDF of the paper, up to 10 MB. Invoices, purchase agreements, bills of sale and receipts only: never a document with a Social Security number.</Text>
    {choices.includes(W.THREAD_KINDS[0]) && <Text role="caption" as="p">A screenshot of the text or email thread that states the work and the price counts as the agreement.</Text>}
    <div className="accounting-paper-attach__fields">
      <label htmlFor={kindId}><Text role="label">What is it</Text></label>
      <select id={kindId} value={kind} disabled={!!stage} onChange={event => setKind(event.target.value)}>{choices.map(choice => <option key={choice}>{choice}</option>)}</select>
      <label htmlFor={fileId}><Text role="label">File</Text></label>
      <input id={fileId} ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" disabled={!!stage}
        onChange={event => { setFile(event.target.files?.[0] ?? null); setMessage(null); }} />
      <button type="button" className="accounting-primary" disabled={!file || !!stage} onClick={submit}>{stage ? 'Adding…' : 'Add to this row'}</button>
    </div>
    {stage && <p role="status"><Text role="caption">{STAGE_WORDS[stage]}</Text></p>}
    {message && <p role={message.ok ? 'status' : 'alert'}><Text role={message.ok ? 'caption' : 'body'}>{message.text}</Text></p>}
  </div>;
}

function PaperRow({ row, onOpen, onAttached }: { row: LargeSumRow; onOpen: (documentId: string, record: SavedRecord['record']) => void; onAttached: () => void }) {
  const [open, setOpen] = useState(false);
  const needs = W.needsOf(row);
  const gap = row.missing_doc ? 'document' : row.proof_flag === 'no_payment_proof' ? 'bank' : 'basis';
  return <li className="accounting-close-item accounting-paper-row" data-gap={gap}>
    <div className="accounting-close-item__button">
      <span className="accounting-close-item__main">
        <button type="button" className="accounting-link-button" onClick={() => onOpen(row.document_id, row.record)}>
          <Text role="body">{row.record.date ? `${pacific(row.record.date, false)} · ` : ''}{W.rowTitle(row)}</Text>
        </button>
        <Text role="caption">Needs: {needs.join(' · ')}</Text>
        {W.citedLine(row) && <Text role="caption">{W.citedLine(row)}</Text>}
        {row.attached.map(a => <Text role="caption" key={a.document_id}>{W.attachedLine(a)}</Text>)}
        {row.attached.length > 0 && <Text role="caption">{W.ATTACHED_WAITING}</Text>}
      </span>
      <Text role="measure" className="accounting-close-item__amount">{dollars(row.amount)}</Text>
      {W.canAttach(row) && <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? 'Close' : W.attachLabel(row)}</button>}
    </div>
    {open && <AttachPanel row={row} onAttached={onAttached} />}
  </li>;
}

/** The live list of one year. `y` is that year's part of books_large_sum_rows. */
export function LargeSumsList({ y, readAt, onOpen, onAttached }: {
  y: LargeSumYear; readAt: number | null; onOpen: (documentId: string, record: SavedRecord['record']) => void; onAttached: () => void;
}) {
  const [all, setAll] = useState(false);
  const rows = all ? y.rows : y.rows.slice(0, SHOWN_FIRST);
  return <>
    <Item>
      <Text role="label">Large sums that need paper</Text>
      <Text role="body">{y.flagged_n === 0 ? `No large sum is flagged for ${y.year}.` : W.liveHeading(y)}</Text>
      <Text role="caption">{W.liveCaption(y)} Live from v_books_large_sums{readAt ? `, read ${pacific(new Date(readAt).toISOString())}` : ''}.</Text>
    </Item>
    {rows.map(row => <PaperRow key={row.id} row={row} onOpen={onOpen} onAttached={onAttached} />)}
    {y.rows.length > SHOWN_FIRST && <Item>
      <button type="button" className="accounting-link-button" aria-expanded={all} onClick={() => setAll(value => !value)}>
        <Text role="caption">{all ? `Show the largest ${SHOWN_FIRST} only` : `Show all ${y.rows.length.toLocaleString('en-US')} rows`}</Text>
      </button>
    </Item>}
  </>;
}
