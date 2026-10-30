import { useState } from 'react';
import { Text } from '../../kit/Text';
import { CoverageView, ShareBar } from '../../kit';
import { useAccountingBook } from './AccountingBookContext';
import { HEAVY_GAP_MS, FRESH_MS, useRevisionRead, useYearStates, type RevisionRead } from './useRevisionRead';
import type { Drill } from './FinishTaxes';
import {
  dollars, pacific, pacificDay, readCitationLinks, readGateStatus, readLargeSums, readTierYears,
  type GateRule, type GateYear, type LargeSumYear, type TieYear, type TierYear, type TierDrillKey, type YearState,
} from '../../services/accountingCloseout';
import * as W from './booksDocketWords';
import { CloseItem, CloseYear, ReadState, Waiting } from './CloseItem';
import { LargeSumsList, PaperTotals } from './LargeSums';
import type { SavedRecord } from './FinancialWorkpapers';

/** Books docket: per tax year, the paper the books still need and whether the books can be trusted. It opens on the large sums: the two totals the owner reads
 *  (deductions with no bank line, ruling or rule; large deductions missing their document), both read live from the same rows that open beneath them, then
 *  the rows rule R12 flags (v_books_large_sums), each with what it still needs and a way to add the file that answers it. Then what stands behind the verdict:
 *  the stored gate run (books_gate_status), how the deductions are supported (v_books_audit_tier_years), the paperwork state and the open return items (the
 *  facts register through books_year_state), and, folded away, how the expenses tie to statement lines (v_books_citation_links). The page never runs the gate
 *  and computes nothing: counts, classes, order and staleness arrive decided, and each number can be opened down to the records behind it.
 *  Only the owner's own book: in a shared book nothing renders and nothing is read. */

// The reads come one after another behind the close-out read that Finish your taxes starts at the same moment: the first load of this page failed under
// load on 2026-10-29, so a loaded database sees a trickle, not a burst. The gate status paints first (a table read); the large sums follow it, then the
// deduction view, then the tie view (each takes seconds).
const SUMS_READ_AFTER_MS = 500;
const TIER_READ_AFTER_MS = 2500;
const TIE_READ_AFTER_MS = 5000;
type Phase = 'loading' | 'ready' | 'error';
const phaseOf = (r: RevisionRead<unknown>): Phase => r.phase === 'ready' ? 'ready' : r.phase === 'error' ? 'error' : 'loading';

const RULE_MARK: Record<W.RuleState, string> = { pass: '✓', fail: '✕', not_assessed: '?', empty: '0' };

/** The gate's rules as a strip, one chip per rule in the database's order, coloured by what it found. A chip opens that rule's line: what it checked
 *  and how many of those failed. The first rule that is not a clean pass is open to begin with, so a problem is the first thing read. */
function RuleStrip({ rules }: { rules: GateRule[] }) {
  const firstOff = rules.findIndex(r => W.ruleState(r) !== 'pass');
  const [picked, setPicked] = useState<number | null>(null);
  const shown = picked ?? firstOff;
  const rule = shown >= 0 ? rules[shown] : undefined;
  return <div className="accounting-docket-rules">
    <div className="accounting-chips" role="group" aria-label="Rules of the reconciliation gate">
      {rules.map((r, i) => {
        const state = W.ruleState(r);
        return <button type="button" key={`${r.rule}:${i}`} data-tone={W.RULE_TONE[state]} data-rule-state={state} aria-pressed={shown === i}
          aria-label={`${r.rule}: ${W.RULE_STATE_WORDS[state]}`} onClick={() => setPicked(shown === i ? -1 : i)}>
          <span aria-hidden="true">{RULE_MARK[state]}</span> {r.rule}</button>;
      })}
    </div>
    {rule
      ? <div className="accounting-docket-rule" role="status" data-tone={W.RULE_TONE[W.ruleState(rule)]} data-rule-state={W.ruleState(rule)}>
          <Text role="body">{W.ruleLine(rule)}</Text>
          {W.gradesLine(rule) && <Text role="caption" as="p">Evidence grades: {W.gradesLine(rule)}</Text>}
        </div>
      : <Text role="caption" as="p">Every rule passed. Open one to see what it checked.</Text>}
  </div>;
}

function GateRow({ y }: { y: GateYear }) {
  const caption = W.gateRowCaption(y);
  return <CloseItem>
    <Text role="label">Reconciliation gate</Text>
    <Text role="body">{W.gateRowLine(y)}</Text>
    {caption.map(line => <Text role="caption" key={line}>{line}</Text>)}
    <Text role="caption">{W.returnMatchesLine(y)}</Text>
    {y.run && y.run.rules.length > 0 && <RuleStrip key={y.run.id} rules={y.run.rules} />}
  </CloseItem>;
}

function DeductionRows({ y, tier, phase, retry, onDrill }: { y: GateYear; tier: TierYear | undefined; phase: Phase; retry: () => void; onDrill: (d: Drill) => void }) {
  const year = String(y.year);
  const drill = (item: TierDrillKey, label: string) => () => onDrill({ year, item, label });
  if (phase !== 'ready') return <Waiting what="How the deductions are supported" failed={phase === 'error'} onRetry={retry} />;
  if (!tier) return <CloseItem><Text role="label">How the deductions are supported</Text><Text role="body">No Expense decisions are in the books for {year}.</Text></CloseItem>;
  const rows: { letter: 'C' | 'B' | 'A'; n: number; usd: number; share: number | null; key: TierDrillKey }[] = [
    { letter: 'C', n: tier.c_n, usd: tier.c_usd, share: tier.c_pct, key: 'tier_c' },
    { letter: 'B', n: tier.b_n, usd: tier.b_usd, share: tier.b_pct, key: 'tier_b' },
    { letter: 'A', n: tier.a_n, usd: tier.a_usd, share: tier.a_pct, key: 'tier_a' },
  ];
  const apart: { text: string | null; key: TierDrillKey; label: string }[] = [
    { text: W.tierBNoBankLine(tier), key: 'b_no_bank', label: 'Tier B deductions with no bank line' },
    { text: W.tier274Line(tier), key: 's274_needs_receipt', label: 'Section 274 lines that need a receipt and have none' },
    { text: W.tierNoPayLine(tier), key: 'no_pay_no_ruling', label: 'Deductions with no payment proof and no owner ruling' },
    { text: W.tierExcludedLine(tier), key: 'excluded', label: 'Rows outside the deduction count' },
  ];
  const shown = apart.filter(a => a.text);
  return <>
    <CloseItem>
      <Text role="label">How the deductions are supported</Text>
      <Text role="body">{W.tierHeadline(tier)}</Text>
      <Text role="caption">Open a tier to see its deductions and why each sits there.</Text>
    </CloseItem>
    {rows.map(r => <CloseItem key={r.letter} amount={`${dollars(r.usd)} · ${W.pct(r.share)}`} onClick={r.n > 0 ? drill(r.key, `Tier ${r.letter} deductions`) : undefined}>
      <Text role="body">{W.TIER_WORDS[r.letter]}</Text>
      <Text role="caption">{r.n.toLocaleString('en-US')} of {tier.deductions.toLocaleString('en-US')} deductions</Text>
      <ShareBar share={r.share} />
    </CloseItem>)}
    {shown.length > 0 && <CloseItem><details className="accounting-compact-details">
      <summary><Text role="caption" as="small">Counted apart ({shown.length})</Text></summary>
      <ul className="accounting-docket-apart">{shown.map(a => <li key={a.key}>
        <Text role="caption">{a.text}</Text> <button type="button" className="accounting-link-button" onClick={drill(a.key, a.label)}>See them ›</button>
      </li>)}</ul>
    </details></CloseItem>}
  </>;
}

/** How the expenses tie to statement lines. Folded away until the owner rules which direction defines a bank line: the two readers count it in opposite
 *  directions, and this row prints both, so it is a reference and not a headline. */
function TieRows({ y, tie, phase, retry }: { y: GateYear; tie: TieYear | undefined; phase: Phase; retry: () => void }) {
  if (phase !== 'ready') return <Waiting what="Ties to a statement line" failed={phase === 'error'} onRetry={retry} />;
  if (!tie) return <CloseItem><Text role="label">Ties to a statement line</Text><Text role="body">No Expense decisions are in the books for {y.year}.</Text></CloseItem>;
  return <CloseItem><details className="accounting-compact-details">
    <summary><Text role="caption" as="small">Ties to a statement line · {W.tieHeadline(tie)}</Text></summary>
    <ul className="accounting-docket-ties">
      {W.tieClasses(tie).map(c => <li key={c.key} data-tie={c.key}><Text role="caption"><b>{c.n.toLocaleString('en-US')}</b> of {c.of.toLocaleString('en-US')} {c.text}</Text></li>)}
    </ul>
    <Text role="caption" as="p">{W.tieCitationLine(tie)}</Text>
    <Text role="caption" as="p">{W.tieAmountLine(tie)}</Text>
  </details></CloseItem>;
}

function PaperworkRow({ y, state, read }: { y: GateYear; state: YearState | undefined; read: W.PaperworkRead }) {
  const p = W.paperwork(y, state, read);
  return <CloseItem tone={p.flags.length > 0 ? 'warn' : undefined}>
    <Text role="label">Paperwork</Text>
    <Text role="body">{p.headline}</Text>
    {p.details.length > 0 && <Text role="caption">{p.details.join(' · ')}</Text>}
    {p.flags.map(f => <Text role="caption" key={f}>{f}</Text>)}
  </CloseItem>;
}

function OpenRow({ y, state, onShow }: { y: GateYear; state: YearState | undefined; onShow: (year: number) => void }) {
  const first = state?.open_items.find(i => i.closes_with);
  return <CloseItem onClick={() => onShow(y.year)}>
    <Text role="label">What is open</Text>
    <Text role="body">{W.openLine(y.open_items)}</Text>
    {first?.closes_with && <Text role="caption">Closes with: {first.closes_with}</Text>}
    <Text role="caption">Go to {y.year} in Finish your taxes</Text>
  </CloseItem>;
}

function YearDocket({ y, sums, sumsPhase, sumsReadAt, retrySums, tier, tierPhase, retryTier, tie, tiePhase, retryTie, state, stateRead, onDrill, onOpen, onShow }: {
  y: GateYear; sums: LargeSumYear | undefined; sumsPhase: Phase; sumsReadAt: number | null; retrySums: () => void;
  tier: TierYear | undefined; tierPhase: Phase; retryTier: () => void; tie: TieYear | undefined; tiePhase: Phase; retryTie: () => void;
  state: YearState | undefined; stateRead: W.PaperworkRead; onDrill: (d: Drill) => void; onOpen: (documentId: string, record: SavedRecord['record']) => void; onShow: (year: number) => void;
}) {
  const verdict = W.gateVerdict(y);
  const drift = W.driftLines(y, sumsPhase === 'ready' ? sums : undefined, tierPhase === 'ready' ? tier : undefined);
  const head = <>
    <Text role="label" as="h3">{y.year}</Text>
    <Text role="measure" as="p" className="accounting-docket-verdict" data-state={verdict.state} data-tone={W.VERDICT_TONE[verdict.state]}>{verdict.word}</Text>
    <Text role="caption" as="p">{verdict.reason}</Text>
  </>;
  return <CloseYear id={`docket-${y.year}`} label={`Books docket ${y.year}`} className="accounting-docket-year" tone={W.VERDICT_TONE[verdict.state]} head={head}>
    <PaperTotals y={y} sums={{ data: sums, phase: sumsPhase }} tier={{ data: tier, phase: tierPhase }} onDrill={onDrill} />
    {drift.map(line => <CloseItem key={line} tone="warn"><Text role="caption">{line}</Text></CloseItem>)}
    {sumsPhase !== 'ready' ? <Waiting what="The large sums" failed={sumsPhase === 'error'} onRetry={retrySums} />
      : sums ? <LargeSumsList y={sums} readAt={sumsReadAt} onOpen={onOpen} onAttached={retrySums} />
      : <CloseItem><Text role="label">Large sums that need paper</Text><Text role="body">No deduction decisions are in the books for {y.year}.</Text></CloseItem>}
    <GateRow y={y} />
    <DeductionRows y={y} tier={tier} phase={tierPhase} retry={retryTier} onDrill={onDrill} />
    <TieRows y={y} tie={tie} phase={tiePhase} retry={retryTie} />
    <PaperworkRow y={y} state={state} read={stateRead} />
    <OpenRow y={y} state={state} onShow={onShow} />
  </CloseYear>;
}

/** Brings a year's card in Finish your taxes (the ranked list, statement gaps, the sign-and-mail step) into view. */
function showYearInFinishTaxes(year: number): void {
  const card = typeof document !== 'undefined' ? document.getElementById(`close-${year}`) : null;
  if (card && typeof card.scrollIntoView === 'function') card.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function Docket({ ownerId, active, onDrill, onOpen }: { ownerId: string; active: boolean; onDrill: (drill: Drill) => void; onOpen: (documentId: string, record: SavedRecord['record']) => void }) {
  const { liveRevision } = useAccountingBook();
  const gate = useRevisionRead('gate', signal => readGateStatus(ownerId, signal), { scope: ownerId, enabled: active, revision: liveRevision, staleMs: FRESH_MS });
  const ready = gate.phase === 'ready';
  const heavy = { scope: ownerId, enabled: active && ready, revision: liveRevision, minGapMs: HEAVY_GAP_MS };
  const sums = useRevisionRead('large-sums', signal => readLargeSums(ownerId, signal), { ...heavy, startAfterMs: SUMS_READ_AFTER_MS });
  const tiers = useRevisionRead('tier-years', signal => readTierYears(ownerId, signal), { ...heavy, startAfterMs: TIER_READ_AFTER_MS });
  const ties = useRevisionRead('citation-links', signal => readCitationLinks(ownerId, signal), { ...heavy, startAfterMs: TIE_READ_AFTER_MS });
  // The years are the database's: the return drafts, the stored runs and the years that have Expense decisions (books_gate_status).
  const years = gate.data?.years ?? [];
  const { data: states, status: stateRead } = useYearStates(ownerId, years.map(y => String(y.year)), { enabled: active && ready, revision: liveRevision });

  if (gate.phase === 'idle') return null;
  const heading = <div className="accounting-section-heading"><Text role="entity" as="h2">Books docket</Text></div>;
  if (!gate.data) return <section className="accounting-close accounting-docket" aria-label="Books docket">{heading}<ReadState what="The books docket" failed={gate.phase === 'error'} onRetry={gate.retry} /></section>;
  const status = gate.data;
  const sumsByYear = new Map((sums.data?.years ?? []).map(t => [t.year, t]));
  const tierByYear = new Map((tiers.data ?? []).map(t => [t.year, t]));
  const tieByYear = new Map((ties.data ?? []).map(t => [t.year, t]));
  const read = (readAt: number | null) => readAt ? pacific(new Date(readAt).toISOString()) : 'not yet';
  return <section className="accounting-close accounting-docket" aria-label="Books docket">
    <div className="accounting-section-heading">
      <Text role="entity" as="h2">Books docket</Text>
      <CoverageView c={{ n: status.summary.with_run, of: status.summary.years, grain: 'tax years with a stored gate run', as_of: pacificDay(status.read_at) }} />
      {/* Reads the stored gate runs and the live rows again. It never runs the gate: that is the recorder's job, off the page. */}
      <button type="button" onClick={() => { gate.retry(); sums.retry(); tiers.retry(); ties.retry(); }}>Read again</button>
    </div>
    <Text role="caption" as="p">The reconciliation gate is too slow for a page to run, so this page shows its last stored run and says when the books or the gate have changed since. The totals and the rows that need paper are read live from the same views. Nothing here is computed in the browser.</Text>
    <details className="accounting-compact-details accounting-docket-legend">
      <summary><Text role="caption" as="small">How to read the docket</Text></summary>
      <ul>
        <li><Text role="caption">{W.LEGEND.paper}</Text></li>
        <li><Text role="caption">{W.LEGEND.dollars}</Text></li>
        <li><Text role="caption">{W.LEGEND.trusted}</Text></li>
        <li><Text role="caption">{W.LEGEND.tiers}</Text></li>
        <li><Text role="caption">{W.LEGEND.ties}</Text></li>
      </ul>
    </details>
    {gate.refreshFailed && <Text role="caption" as="p">Showing the last loaded docket; a refresh failed.</Text>}
    {years.length === 0
      ? <p><Text role="body">There are no tax years with a return draft, a stored gate run or deductions yet.</Text></p>
      : <div className="accounting-close-years">{years.map(y => <YearDocket key={y.year} y={y}
          sums={sumsByYear.get(String(y.year))} sumsPhase={phaseOf(sums)} sumsReadAt={sums.readAt} retrySums={sums.retry}
          tier={tierByYear.get(String(y.year))} tierPhase={phaseOf(tiers)} retryTier={tiers.retry}
          tie={tieByYear.get(String(y.year))} tiePhase={phaseOf(ties)} retryTie={ties.retry}
          state={states[String(y.year)]} stateRead={stateRead[String(y.year)] ?? 'loading'}
          onDrill={onDrill} onOpen={onOpen} onShow={showYearInFinishTaxes} />)}</div>}
    <Text role="caption" as="p">
      Read {pacific(status.read_at)}: gate runs (books_gate_runs). Large sums (v_books_large_sums) read {read(sums.readAt)}. Deductions (v_books_audit_tier_years) read {read(tiers.readAt)}. Ties (v_books_citation_links) read {read(ties.readAt)}.
      Filing state and open return items come from the facts register (books_year_state).
    </Text>
  </section>;
}

export default function BooksDocket({ onDrill, onOpen, active = true }: { onDrill: (drill: Drill) => void; onOpen: (documentId: string, record: SavedRecord['record']) => void; active?: boolean }) {
  const { ownerId, shared } = useAccountingBook();
  // A shared book is someone else's: nothing renders and nothing is read.
  if (!ownerId || shared) return null;
  return <Docket ownerId={ownerId} active={active} onDrill={onDrill} onOpen={onOpen} />;
}
