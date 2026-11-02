import { useState } from 'react';
import { Text } from '../../kit/Text';
import { dollars, pacific, type GateYear, type LargeSumRow, type LargeSumYear, type TierYear } from '../../services/accountingCloseout';
import type { SavedRecord } from './FinancialWorkpapers';
import type { Drill } from './FinishTaxes';
import FinancialDocumentIntake from './FinancialDocumentIntake';
import { CloseItem } from './CloseItem';
import * as W from './booksDocketWords';

/** The first screen of the books docket, per tax year: the two totals the owner reads (deductions with no bank line, no ruling and no rule, rule R10 part b; and
 *  the large deductions missing their document, rule R12), each read live from the same rows the list and the drill show; then the rows rule R12 flags, read
 *  live from v_books_large_sums, largest dollars first, each with what it still needs in plain words and, where a file can answer it, a way to add that file.
 *  Nothing here is summed, divided or compared: the database states every count, dollar and flag, and this names them. */

const SHOWN_FIRST = 10;

/** The two totals of a year, each from the live reader whose rows it opens. The dollars with no bank line, ruling or rule open the deductions behind them in
 *  the office's row list (the same class the audit tiers count apart); the dollars missing a document are the rows listed right below. */
export function PaperTotals({ y, sums, tier, onDrill }: { y: GateYear; sums?: W.LiveRead<LargeSumYear>; tier?: W.LiveRead<TierYear>; onDrill?: (drill: Drill) => void }) {
  const totals = [W.outsideBankTotal(tier), W.missingDocTotal(sums)];
  return <>
    {totals.map(t => {
      const opens = onDrill && t.rule === 'R10 part b' && t.tone === 'bad';
      return <CloseItem key={t.label} tone={t.tone} onClick={opens ? () => onDrill({ year: String(y.year), item: 'no_pay_no_ruling', label: t.label }) : undefined}>
        <Text role="label">{t.label}</Text>
        <Text role="measure" className="accounting-paper-total" data-tone={t.tone}>{t.headline}</Text>
        {t.details.map(line => <Text role="caption" key={line}>{line}</Text>)}
        <Text role="caption">Rule {t.rule}, read live from {t.from}{opens ? ' · open the deductions behind it' : ''}</Text>
      </CloseItem>;
    })}
  </>;
}

/** The panel that takes the paper for a row: the office's own Add documents flow, with the row as its link target. */
function AttachPaper({ row, onAttached }: { row: LargeSumRow; onAttached: () => void }) {
  const choices = W.attachChoices(row);
  const link = { year: row.year, local_id: row.local_id, source_key: row.record.source_key!, decision_document_id: row.document_id, required_doc_kind: row.required_doc_kind };
  return <FinancialDocumentIntake link={link} kinds={choices} label={`Add the paper for ${W.rowTitle(row)}`} onComplete={onAttached}>
    <Text role="caption" as="p">{W.paperWord(row) ? `This row needs: ${W.paperWord(row)}. ` : ''}A photo or PDF of the paper, up to 10 MB. Invoices, purchase agreements, bills of sale and receipts only: never a document with a Social Security number.</Text>
    {choices.includes(W.THREAD_KINDS[0]) && <Text role="caption" as="p">A screenshot of the text or email thread that states the work and the price counts as the agreement.</Text>}
  </FinancialDocumentIntake>;
}

function PaperRow({ row, onOpen, onAttached }: { row: LargeSumRow; onOpen: (documentId: string, record: SavedRecord['record']) => void; onAttached: () => void }) {
  const [open, setOpen] = useState(false);
  const needs = W.needsOf(row);
  return <CloseItem className="accounting-paper-row" amount={dollars(row.amount)}
    action={W.canAttach(row) ? <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? 'Close' : W.attachLabel(row)}</button> : undefined}
    below={open ? <AttachPaper row={row} onAttached={onAttached} /> : undefined}>
    <button type="button" className="accounting-link-button" onClick={() => onOpen(row.document_id, row.record)}>
      <Text role="body">{row.record.date ? `${pacific(row.record.date, false)} · ` : ''}{W.rowTitle(row)}</Text>
    </button>
    <Text role="caption">Needs: {needs.join(' · ')}</Text>
    {W.citedLine(row) && <Text role="caption">{W.citedLine(row)}</Text>}
    {row.attached.map(a => <Text role="caption" key={a.document_id}>{W.attachedLine(a)}</Text>)}
    {row.attached.length > 0 && <Text role="caption">{W.ATTACHED_WAITING}</Text>}
  </CloseItem>;
}

/** The live list of one year. `y` is that year's part of books_large_sum_rows. */
export function LargeSumsList({ y, readAt, onOpen, onAttached }: {
  y: LargeSumYear; readAt: number | null; onOpen: (documentId: string, record: SavedRecord['record']) => void; onAttached: () => void;
}) {
  const [all, setAll] = useState(false);
  const rows = all ? y.rows : y.rows.slice(0, SHOWN_FIRST);
  return <>
    <CloseItem>
      <Text role="label">Large sums that need paper</Text>
      <Text role="body">{y.flagged_n === 0 ? `No large sum is flagged for ${y.year}.` : W.liveHeading(y)}</Text>
      <Text role="caption">{W.liveCaption(y)} Live from v_books_large_sums{readAt ? `, read ${pacific(new Date(readAt).toISOString())}` : ''}.</Text>
    </CloseItem>
    {rows.map(row => <PaperRow key={row.id} row={row} onOpen={onOpen} onAttached={onAttached} />)}
    {y.rows.length > SHOWN_FIRST && <CloseItem>
      <button type="button" className="accounting-link-button" aria-expanded={all} onClick={() => setAll(value => !value)}>
        <Text role="caption">{all ? `Show the largest ${SHOWN_FIRST} only` : `Show all ${y.rows.length.toLocaleString('en-US')} rows`}</Text>
      </button>
    </CloseItem>}
  </>;
}
