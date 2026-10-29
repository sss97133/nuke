import { useEffect, useState, type ReactNode } from 'react';
import { Text } from '../../kit/Text';
import { CoverageView } from '../../kit/Measure';
import { useAccountingBook } from './AccountingBookContext';
import { useRevisionRead, type RevisionRead } from './useRevisionRead';
import type { Drill } from './FinishTaxes';
import {
  dollars, pacific, readCitationLinks, readGateStatus, readTierYears, readYearStateOnce,
  type GateRule, type GateYear, type TieYear, type TierYear, type TierDrillKey, type YearState,
} from '../../services/accountingCloseout';
import * as W from './booksDocketWords';

/** Books docket: per tax year, whether the books can be trusted and what stands behind that. Every statement here is a stored answer of the database:
 *  the reconciliation gate's last run (books_gate_status), how the deductions are supported (v_books_audit_tier_years), how they tie to statement lines
 *  (v_books_citation_links), the paperwork state and the open return items (the facts register through books_year_state). The page never runs the gate and
 *  computes nothing: counts, classes, order and staleness arrive decided, and each number can be opened down to the records behind it.
 *  Only the owner's own book: in a shared book nothing renders and nothing is read. */

const TIER_READ_AFTER_MS = 1500;
const TIE_READ_AFTER_MS = 3000;
type Phase = 'loading' | 'ready' | 'error';
const phaseOf = (r: RevisionRead<unknown>): Phase => r.phase === 'ready' ? 'ready' : r.phase === 'error' ? 'error' : 'loading';

function Item({ children, amount, onClick, warn }: { children: ReactNode; amount?: ReactNode; onClick?: () => void; warn?: boolean }) {
  const body = <><span className="accounting-close-item__main">{children}</span>
    {amount !== undefined && <Text role="measure" className="accounting-close-item__amount">{amount}</Text>}
    {onClick && <span aria-hidden="true">›</span>}</>;
  return <li className="accounting-close-item" data-warn={warn ? 'true' : undefined}>
    {onClick ? <button type="button" className="accounting-close-item__button" onClick={onClick}>{body}</button> : <div className="accounting-close-item__button">{body}</div>}
  </li>;
}

function Waiting({ what, failed, onRetry }: { what: string; failed: boolean; onRetry: () => void }) {
  return failed
    ? <li className="accounting-close-item"><div className="accounting-close-item__button" role="alert"><span className="accounting-close-item__main"><Text role="body">{what} could not load.</Text></span><button type="button" onClick={onRetry}>Try again</button></div></li>
    : <li className="accounting-close-item"><div className="accounting-close-item__button" role="status"><span className="accounting-close-item__main"><Text role="caption">Reading {what.charAt(0).toLowerCase()}{what.slice(1)}…</Text></span></div></li>;
}

const RULE_MARK: Record<ReturnType<typeof W.ruleState>, string> = { pass: '✓', fail: '✕', not_assessed: '?', empty: '0' };
const RULE_STATE_WORDS: Record<ReturnType<typeof W.ruleState>, string> = { pass: 'passed', fail: 'failing', not_assessed: 'not assessed', empty: 'nothing checked' };

/** The gate's rules as a strip, one chip per rule in the database's order, coloured by what it found. A chip opens that rule's line: what it checked
 *  and how many of those failed. The first rule that is not a clean pass is open to begin with, so a problem is the first thing read. */
function RuleStrip({ rules }: { rules: GateRule[] }) {
  const firstOff = rules.findIndex(r => W.ruleState(r) !== 'pass');
  const [picked, setPicked] = useState<number | null>(null);
  const shown = picked ?? firstOff;
  const rule = shown >= 0 ? rules[shown] : undefined;
  return <div className="accounting-docket-rules">
    <div className="accounting-docket-chips" role="group" aria-label="Rules of the reconciliation gate">
      {rules.map((r, i) => {
        const state = W.ruleState(r);
        return <button type="button" key={`${r.rule}:${i}`} className="accounting-docket-chip" data-rule-state={state} aria-pressed={shown === i}
          aria-label={`${r.rule}: ${RULE_STATE_WORDS[state]}`} onClick={() => setPicked(shown === i ? -1 : i)}>
          <span aria-hidden="true">{RULE_MARK[state]}</span> {r.rule}</button>;
      })}
    </div>
    {rule
      ? <div className="accounting-docket-rule" role="status" data-rule-state={W.ruleState(rule)}>
          <Text role="body">{W.ruleLine(rule)}</Text>
          {W.gradesLine(rule) && <Text role="caption" as="p">Evidence grades: {W.gradesLine(rule)}</Text>}
        </div>
      : <Text role="caption" as="p">Every rule passed. Open one to see what it checked.</Text>}
  </div>;
}

function GateRow({ y }: { y: GateYear }) {
  const caption = W.gateRowCaption(y);
  return <Item>
    <Text role="label">Reconciliation gate</Text>
    <Text role="body">{W.gateRowLine(y)}</Text>
    {caption.map(line => <Text role="caption" key={line}>{line}</Text>)}
    <Text role="caption">{W.returnMatchesLine(y)}</Text>
    {y.run && y.run.rules.length > 0 && <RuleStrip key={y.run.id} rules={y.run.rules} />}
  </Item>;
}

/** A tier's share as the view stores it, drawn as a bar. The width is the stored percentage itself; nothing is added or divided. */
function ShareBar({ share }: { share: number | null }) {
  if (share === null) return null;
  return <svg className="accounting-docket-bar" viewBox="0 0 100 3" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <rect className="accounting-docket-bar__track" x="0" y="0" width="100" height="3" />
    <rect className="accounting-docket-bar__fill" x="0" y="0" width={Math.min(100, Math.max(0, share))} height="3" />
  </svg>;
}

function DeductionRows({ y, tier, phase, retry, onDrill }: { y: GateYear; tier: TierYear | undefined; phase: Phase; retry: () => void; onDrill: (d: Drill) => void }) {
  const year = String(y.year);
  const drill = (item: TierDrillKey, label: string) => () => onDrill({ year, item, label });
  if (phase !== 'ready') return <Waiting what="How the deductions are supported" failed={phase === 'error'} onRetry={retry} />;
  if (!tier) return <Item><Text role="label">How the deductions are supported</Text><Text role="body">No Expense decisions are in the books for {year}.</Text></Item>;
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
  return <>
    <Item>
      <Text role="label">How the deductions are supported</Text>
      <Text role="body">{W.tierHeadline(tier)}</Text>
      <Text role="caption">Open a tier to see its deductions and why each sits there.</Text>
    </Item>
    {rows.map(r => <Item key={r.letter} amount={`${dollars(r.usd)} · ${W.pct(r.share)}`} onClick={r.n > 0 ? drill(r.key, `Tier ${r.letter} deductions`) : undefined}>
      <Text role="body">{W.TIER_WORDS[r.letter]}</Text>
      <Text role="caption">{r.n.toLocaleString('en-US')} of {tier.deductions.toLocaleString('en-US')} deductions</Text>
      <ShareBar share={r.share} />
    </Item>)}
    {apart.filter(a => a.text).length > 0 && <Item><details className="accounting-docket-apartbox">
      <summary><Text role="caption" as="small">Counted apart ({apart.filter(a => a.text).length})</Text></summary>
      <ul className="accounting-docket-apart">{apart.filter(a => a.text).map(a => <li key={a.key}>
        <Text role="caption">{a.text}</Text> <button type="button" className="accounting-link-button" onClick={drill(a.key, a.label)}>See them ›</button>
      </li>)}</ul>
    </details></Item>}
  </>;
}

function TieRows({ y, tie, phase, retry }: { y: GateYear; tie: TieYear | undefined; phase: Phase; retry: () => void }) {
  if (phase !== 'ready') return <Waiting what="Ties to a statement line" failed={phase === 'error'} onRetry={retry} />;
  if (!tie) return <Item><Text role="label">Ties to a statement line</Text><Text role="body">No Expense decisions are in the books for {y.year}.</Text></Item>;
  return <Item>
    <Text role="label">Ties to a statement line</Text>
    <Text role="body">{W.tieHeadline(tie)}</Text>
    <ul className="accounting-docket-ties">
      {W.tieClasses(tie).map(c => <li key={c.key} data-tie={c.key}><Text role="caption"><b>{c.n.toLocaleString('en-US')}</b> of {c.of.toLocaleString('en-US')} {c.text}</Text></li>)}
    </ul>
    <Text role="caption">{W.tieAmountLine(tie)}</Text>
  </Item>;
}

function PaperworkRow({ y, state, read }: { y: GateYear; state: YearState | undefined; read: W.PaperworkRead }) {
  const p = W.paperwork(y, state, read);
  return <Item warn={p.flags.length > 0}>
    <Text role="label">Paperwork</Text>
    <Text role="body">{p.headline}</Text>
    {p.details.length > 0 && <Text role="caption">{p.details.join(' · ')}</Text>}
    {p.flags.map(f => <Text role="caption" key={f}>{f}</Text>)}
  </Item>;
}

function OpenRow({ y, state, onShow }: { y: GateYear; state: YearState | undefined; onShow: (year: number) => void }) {
  const first = state?.open_items.find(i => i.closes_with);
  return <Item onClick={() => onShow(y.year)}>
    <Text role="label">What is open</Text>
    <Text role="body">{W.openLine(y.open_items)}</Text>
    {first?.closes_with && <Text role="caption">Closes with: {first.closes_with}</Text>}
    <Text role="caption">Go to {y.year} in Finish your taxes</Text>
  </Item>;
}

function YearDocket({ y, tier, tierPhase, retryTier, tie, tiePhase, retryTie, state, stateRead, onDrill, onShow }: {
  y: GateYear; tier: TierYear | undefined; tierPhase: Phase; retryTier: () => void; tie: TieYear | undefined; tiePhase: Phase; retryTie: () => void;
  state: YearState | undefined; stateRead: W.PaperworkRead; onDrill: (d: Drill) => void; onShow: (year: number) => void;
}) {
  const verdict = W.gateVerdict(y);
  return <article className="accounting-close-year accounting-docket-year" id={`docket-${y.year}`} data-verdict={verdict.state} aria-label={`Books docket ${y.year}`}>
    <header className="accounting-close-year__head">
      <Text role="label" as="h3">{y.year}</Text>
      <Text role="measure" as="p" className="accounting-docket-verdict" data-state={verdict.state}>{verdict.word}</Text>
      <Text role="caption" as="p">{verdict.reason}</Text>
    </header>
    <ol className="accounting-close-list">
      <GateRow y={y} />
      <DeductionRows y={y} tier={tier} phase={tierPhase} retry={retryTier} onDrill={onDrill} />
      <TieRows y={y} tie={tie} phase={tiePhase} retry={retryTie} />
      <PaperworkRow y={y} state={state} read={stateRead} />
      <OpenRow y={y} state={state} onShow={onShow} />
    </ol>
  </article>;
}

/** Brings a year's card in Finish your taxes (the ranked list, statement gaps, the sign-and-mail step) into view. */
function showYearInFinishTaxes(year: number): void {
  const card = typeof document !== 'undefined' ? document.getElementById(`close-${year}`) : null;
  if (card && typeof card.scrollIntoView === 'function') card.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function Docket({ ownerId, active, onDrill }: { ownerId: string; active: boolean; onDrill: (drill: Drill) => void }) {
  const { liveRevision } = useAccountingBook();
  // The cheap read first. The two slower views (3 to 6 s each on prod) start once it is on screen, one after the other and behind the close-out
  // read that Finish your taxes starts at the same moment: the first load of this page failed under load on 2026-10-29, so a loaded database
  // sees a trickle, not a burst.
  const gate = useRevisionRead(() => readGateStatus(ownerId), { scope: ownerId, enabled: active, revision: liveRevision });
  const ready = gate.phase === 'ready';
  const tiers = useRevisionRead(() => readTierYears(ownerId), { scope: ownerId, enabled: active && ready, revision: liveRevision, startAfterMs: TIER_READ_AFTER_MS });
  const ties = useRevisionRead(() => readCitationLinks(ownerId), { scope: ownerId, enabled: active && ready, revision: liveRevision, startAfterMs: TIE_READ_AFTER_MS });
  const years = gate.data?.years ?? [];
  const yearsKey = years.map(y => y.year).join(',');
  const [states, setStates] = useState<Record<string, YearState | 'error'>>({});
  useEffect(() => { setStates({}); }, [ownerId]);
  useEffect(() => {
    if (!active || !ready || !yearsKey) return;
    let cancelled = false;
    for (const year of yearsKey.split(',')) {
      readYearStateOnce(ownerId, year, liveRevision)
        .then(s => { if (!cancelled) setStates(current => ({ ...current, [year]: s })); })
        .catch(() => { if (!cancelled) setStates(current => ({ ...current, [year]: 'error' })); });
    }
    return () => { cancelled = true; };
  }, [ownerId, active, ready, yearsKey, liveRevision]);

  if (gate.phase === 'idle') return null;
  const heading = <div className="accounting-section-heading"><Text role="entity" as="h2">Books docket</Text></div>;
  if (gate.phase === 'loading') return <section className="accounting-close accounting-docket" aria-label="Books docket">{heading}<p role="status"><Text role="caption">Reading the stored gate runs…</Text></p></section>;
  if (gate.phase === 'error' || !gate.data) {
    return <section className="accounting-close accounting-docket" aria-label="Books docket">{heading}
      <p role="alert"><Text role="body">The books docket could not load.</Text> <button type="button" onClick={gate.retry}>Try again</button></p></section>;
  }
  const status = gate.data;
  const tierByYear = new Map((tiers.data ?? []).map(t => [t.year, t]));
  const tieByYear = new Map((ties.data ?? []).map(t => [t.year, t]));
  const read = (readAt: number | null) => readAt ? pacific(new Date(readAt).toISOString()) : 'not yet';
  return <section className="accounting-close accounting-docket" aria-label="Books docket">
    <div className="accounting-section-heading">
      <Text role="entity" as="h2">Books docket</Text>
      <CoverageView c={{ n: status.summary.with_run, of: status.summary.years, grain: 'tax years with a stored gate run', as_of: null }} />
    </div>
    <Text role="caption" as="p">The reconciliation gate takes 15 seconds or more a year to run, so this page shows its last stored run and says when the books or the gate have changed since. Nothing here is computed in the browser.</Text>
    <details className="accounting-docket-legend">
      <summary><Text role="caption" as="small">How to read the docket</Text></summary>
      <ul>
        <li><Text role="caption">{W.LEGEND.trusted}</Text></li>
        <li><Text role="caption">{W.LEGEND.tiers}</Text></li>
        <li><Text role="caption">{W.LEGEND.ties}</Text></li>
      </ul>
    </details>
    {gate.refreshFailed && <Text role="caption" as="p">Showing the last loaded docket; a refresh failed.</Text>}
    {status.years.length === 0
      ? <p><Text role="body">There are no tax years with a return draft or a stored gate run yet.</Text></p>
      : <div className="accounting-close-years">{status.years.map(y => <YearDocket key={y.year} y={y}
          tier={tierByYear.get(String(y.year))} tierPhase={phaseOf(tiers)} retryTier={tiers.retry}
          tie={tieByYear.get(String(y.year))} tiePhase={phaseOf(ties)} retryTie={ties.retry}
          state={typeof states[String(y.year)] === 'object' ? states[String(y.year)] as YearState : undefined}
          stateRead={states[String(y.year)] === undefined ? 'loading' : states[String(y.year)] === 'error' ? 'error' : 'ready'}
          onDrill={onDrill} onShow={showYearInFinishTaxes} />)}</div>}
    <Text role="caption" as="p">
      Read {pacific(status.read_at)}: gate runs (books_gate_runs). Deductions (v_books_audit_tier_years) read {read(tiers.readAt)}. Ties (v_books_citation_links) read {read(ties.readAt)}.
      Filing state and open return items come from the facts register (books_year_state).
    </Text>
  </section>;
}

export default function BooksDocket({ onDrill, active = true }: { onDrill: (drill: Drill) => void; active?: boolean }) {
  const { ownerId, shared } = useAccountingBook();
  // A shared book is someone else's: nothing renders and nothing is read.
  if (!ownerId || shared) return null;
  return <Docket ownerId={ownerId} active={active} onDrill={onDrill} />;
}
