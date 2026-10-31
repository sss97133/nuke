import React, { useState } from 'react';
import { CollapsibleWidget } from '../../components/ui/CollapsibleWidget';
import { askAgent } from '../../components/agent/askAgent';
import PrefetchLink from '../../components/PrefetchLink';
import { useBuildLedger, type BookCostEntry, type BookCostTotal, type BuildLedgerEntry, type BuildLedgerGroup, type WorkingNoteTable } from './hooks/useBuildLedger';

// ── Formatting ──

// Financial audit surface: always show cents, tabular numerals.
const fmt = (n: number) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Show the audit date exactly as recorded (UTC), never shifted to the viewer's TZ.
const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};

const monoNum: React.CSSProperties = {
  fontFamily: 'var(--vp-font-mono)',
  fontVariantNumeric: 'tabular-nums',
};

// Evidence tier → strength color (strongest = BRG green, weakest = martini red).
const EVIDENCE_COLOR: Record<string, string> = {
  email_itemized: 'var(--vp-evidence-strong, #004225)',
  bank_matched: 'var(--vp-evidence-strong, #004225)',
  bank: 'var(--vp-ink, #111)',
  text_certain: 'var(--vp-ink, #111)',
  text_likely: 'var(--vp-gulf-orange, #EE7623)',
  text_stated: 'var(--vp-martini-red, #C8102E)',
  testimony: 'var(--vp-martini-red, #C8102E)',
};

const ENTITY_LABEL: Record<string, string> = {
  skylar: 'SKYLAR',
  viva_account: 'VIVA ACCT',
  kenan_capital: 'KENAN CAP',
};

// Skylar = own money (neutral). Viva / Kenan = external capital → flag for reconciliation.
const entityColor = (entity: string | null): string =>
  entity && entity !== 'skylar' ? 'var(--vp-gulf-orange, #EE7623)' : 'var(--vp-pencil, #888)';

const label = (s: string | null) =>
  (s ?? '').replace(/_/g, ' ').toUpperCase();

// ── Small chip / badge primitives ──

const Chip: React.FC<{ text: string; color: string; title?: string }> = ({ text, color, title }) => (
  <span
    title={title}
    style={{
      display: 'inline-block', padding: '1px 4px', fontSize: '8px', fontWeight: 700,
      letterSpacing: '0.1em', textTransform: 'uppercase', whiteSpace: 'nowrap',
      border: `1px solid ${color}`, color, fontFamily: 'var(--vp-font-mono)',
    }}
  >
    {text}
  </span>
);

// ── Verbatim citation drill-down — "the citation is the point" ──

const CITATION_KEY_LABEL: Record<string, string> = {
  gmail_msg_id: 'GMAIL MSG',
  qb_transactions: 'QB TXN',
  bank_match: 'BANK MATCH',
  imessage: 'IMESSAGE',
  whatsapp_corroboration: 'WHATSAPP',
  testimony: 'TESTIMONY',
  conflict: 'CONFLICT',
  supersedes: 'SUPERSEDES',
  receipt_ocr_dup: 'OCR DUP',
  split_method: 'SPLIT',
};

const CitationDetail: React.FC<{ entry: BuildLedgerEntry }> = ({ entry }) => {
  const citationRows = Object.entries(entry.citation).filter(([, v]) => v != null && v !== '');
  const kv = (k: string, v: React.ReactNode) => (
    <div key={k} style={{ display: 'grid', gridTemplateColumns: '84px 1fr', gap: '6px', marginBottom: '3px', alignItems: 'baseline' }}>
      <span style={{ fontSize: '8px', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--vp-pencil)', textTransform: 'uppercase' }}>
        {CITATION_KEY_LABEL[k] ?? label(k)}
      </span>
      <span style={{ ...monoNum, fontSize: '8px', wordBreak: 'break-word', color: 'var(--vp-ink)' }}>{v}</span>
    </div>
  );

  return (
    <div style={{
      borderLeft: '2px solid var(--vp-ghost)', borderRight: '2px solid var(--vp-ghost)',
      borderBottom: '2px solid var(--vp-ghost)', padding: '6px 8px', background: 'var(--vp-row-alt, #fafafa)',
    }}>
      {entry.description && (
        <div style={{ fontSize: '8px', color: 'var(--vp-ink)', lineHeight: 1.5, marginBottom: '5px' }}>
          {entry.description}
        </div>
      )}
      <div style={{ fontSize: '8px', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--vp-pencil)', textTransform: 'uppercase', marginBottom: '4px' }}>
        CITATION
      </div>
      {citationRows.length > 0
        ? citationRows.map(([k, v]) => kv(k, String(v)))
        : <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', fontStyle: 'italic' }}>No citation object recorded.</div>}

      {/* Provenance detail beyond the raw citation keys */}
      <div style={{ borderTop: '1px solid var(--vp-ghost)', marginTop: '5px', paddingTop: '5px' }}>
        {entry.attributionBasis && kv('basis', entry.attributionBasis)}
        {entry.channel && kv('channel', label(entry.channel))}
        {entry.splitMethod && kv('split_method', label(entry.splitMethod))}
        {entry.orderTotalUsd != null && kv('order_total', fmt(entry.orderTotalUsd))}
        {entry.auditRun && kv('audit_run', entry.auditRun)}
      </div>
    </div>
  );
};

// ── Ledger row ──

const BuildRow: React.FC<{ entry: BuildLedgerEntry }> = ({ entry }) => {
  const [expanded, setExpanded] = useState(false);
  const pending = entry.needsOwnerConfirmation;
  const isLiability = entry.direction === 'liability';
  const evColor = EVIDENCE_COLOR[String(entry.evidenceTier)] ?? 'var(--vp-pencil, #888)';

  // Confirming a ledger entry is a Sign-tier action: it writes back through
  // ingest-observation (superseding the draft), never a raw client mutation. The
  // write lives in the agent-chat tool `answer_confirmation`; this button hands the
  // question to the agent panel and lets the owner state the answer in their own
  // words. It seeds the box — it never sends. A signature is pressed, not inferred.
  const openInAgent = (e: React.MouseEvent) => {
    e.stopPropagation();
    askAgent(entry.confirmationQuestion ?? 'What needs my confirmation?');
  };

  return (
    <div style={{ marginBottom: '2px', borderLeft: pending ? '2px solid var(--vp-gulf-orange, #EE7623)' : '2px solid transparent' }}>
      <div
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'grid',
          gridTemplateColumns: '58px 1fr auto auto',
          gap: '2px 8px', alignItems: 'center',
          padding: '4px 6px', cursor: 'pointer', userSelect: 'none',
          border: '2px solid var(--vp-ghost)',
          borderLeft: pending ? 'none' : '2px solid var(--vp-ghost)',
          background: expanded ? 'var(--vp-row-alt, #fafafa)' : 'transparent',
        }}
      >
        {/* Date */}
        <span style={{ ...monoNum, fontSize: '8px', color: 'var(--vp-pencil)' }}>{fmtDate(entry.observedAt)}</span>

        {/* Counterparty + description */}
        <span style={{ minWidth: 0, overflow: 'hidden' }}>
          <span style={{ fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {expanded ? '▾' : '▸'} {entry.counterparty || 'Unresolved'}
          </span>
          <span style={{ fontSize: '8px', color: 'var(--vp-pencil)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entry.description}
          </span>
        </span>

        {/* Tier chips + entity */}
        <span style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-end' }}>
          <Chip text={label(entry.evidenceTier)} color={evColor} title={`evidence: ${entry.evidenceTier}`} />
          <span style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
            <span style={{ fontSize: '8px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--vp-pencil)' }}>
              {entry.attributionTier}
            </span>
            {entry.entityPaid && (
              <Chip text={ENTITY_LABEL[entry.entityPaid] ?? label(entry.entityPaid)} color={entityColor(entry.entityPaid)} title={`paid by: ${entry.entityPaid}`} />
            )}
          </span>
        </span>

        {/* Amount */}
        <span style={{ ...monoNum, fontSize: '9px', fontWeight: 700, textAlign: 'right', minWidth: '64px', color: isLiability ? 'var(--vp-martini-red, #C8102E)' : 'var(--vp-ink)' }}>
          {entry.amountUsd == null ? 'AMOUNT UNKNOWN' : isLiability ? `(${fmt(entry.amountUsd)})` : fmt(entry.amountUsd)}
        </span>
      </div>

      {/* Pending-confirmation strip */}
      {pending && entry.confirmationQuestion && (
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px', alignItems: 'center',
          padding: '4px 6px', borderLeft: 'none',
          borderRight: '2px solid var(--vp-ghost)', borderBottom: '2px solid var(--vp-ghost)',
          background: 'color-mix(in srgb, var(--vp-gulf-orange, #EE7623) 8%, transparent)',
        }}>
          <span style={{ fontSize: '8px', lineHeight: 1.4 }}>
            <span style={{ fontSize: '8px', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--vp-gulf-orange, #EE7623)', textTransform: 'uppercase', marginRight: '5px' }}>
              NEEDS CONFIRMATION
            </span>
            <span style={{ color: 'var(--vp-ink)' }}>{entry.confirmationQuestion}</span>
          </span>
          <button
            onClick={openInAgent}
            title="Answer this in the agent panel"
            style={{
              fontFamily: 'var(--vp-font-mono)', fontSize: '8px', fontWeight: 700, letterSpacing: '0.1em',
              textTransform: 'uppercase', padding: '3px 8px', cursor: 'pointer', whiteSpace: 'nowrap',
              border: '2px solid var(--vp-gulf-orange, #EE7623)', color: 'var(--vp-gulf-orange, #EE7623)', background: 'transparent',
            }}
          >
            Answer
          </button>
        </div>
      )}

      {expanded && <CitationDetail entry={entry} />}
    </div>
  );
};

// ── Group section ──

const GroupSection: React.FC<{ group: BuildLedgerGroup }> = ({ group }) => (
  <div style={{ marginBottom: '10px' }}>
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      borderBottom: '2px solid var(--vp-ink)', padding: '3px 0 2px', marginBottom: '4px',
    }}>
      <span style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {group.label}
      </span>
      <span style={{ fontSize: '8px', color: 'var(--vp-pencil)', ...monoNum, letterSpacing: '0.04em' }}>
        {group.entries.length} {group.entries.length === 1 ? 'ENTRY' : 'ENTRIES'}
      </span>
    </div>
    {group.entries.map(e => <BuildRow key={e.id} entry={e} />)}
  </div>
);

// ── Summary card ──

const SummaryCard: React.FC<{ label: string; amount: number | null; sub: string; color: string }> = ({ label, amount, sub, color }) => (
  <div style={{ border: '2px solid var(--vp-ghost)', borderTop: `3px solid ${color}`, padding: '6px 8px' }}>
    <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>{label}</div>
    <div style={{ ...monoNum, fontSize: '13px', fontWeight: 700, color }}>{amount == null ? 'Amount unknown' : fmt(amount)}</div>
    <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: '1px' }}>{sub}</div>
  </div>
);

// ── In the accounts: costs the accounting book assigns to this vehicle ──

const fmtMoney = (n: number, currency: string) =>
  currency === 'USD' ? fmt(n) : `${currency} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const KIND_LABEL: Record<string, string> = { parts_purchase: 'PARTS', labor_payment: 'LABOR' };

// Read-only: a booked cost has no confirmation strip and never opens the agent. It is changed in the accounting book,
// which the expanded row links to.
const BookCostRow: React.FC<{ entry: BookCostEntry }> = ({ entry }) => {
  const [expanded, setExpanded] = useState(false);
  const who = !entry.assignedBy ? 'Not recorded' : entry.assignedBy === entry.bookOwnerId ? 'Book owner' : 'Book reviewer';
  const kv = (k: string, v: React.ReactNode) => (
    <div key={k} style={{ display: 'grid', gridTemplateColumns: '84px 1fr', gap: '6px', marginBottom: '3px', alignItems: 'baseline' }}>
      <span style={{ fontSize: '8px', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--vp-pencil)', textTransform: 'uppercase' }}>{k}</span>
      <span style={{ ...monoNum, fontSize: '8px', wordBreak: 'break-word', color: 'var(--vp-ink)' }}>{v}</span>
    </div>
  );
  return (
    <div style={{ marginBottom: '2px' }}>
      <div
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'grid', gridTemplateColumns: '58px 1fr auto auto', gap: '2px 8px', alignItems: 'center',
          padding: '4px 6px', cursor: 'pointer', userSelect: 'none', border: '2px solid var(--vp-ghost)',
          background: expanded ? 'var(--vp-row-alt, #fafafa)' : 'transparent',
        }}
      >
        <span style={{ ...monoNum, fontSize: '8px', color: 'var(--vp-pencil)' }}>{fmtDate(entry.date)}</span>
        <span style={{ minWidth: 0, overflow: 'hidden' }}>
          <span style={{ fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {expanded ? '▾' : '▸'} {entry.description || 'Unnamed expense'}
          </span>
          <span style={{ fontSize: '8px', color: 'var(--vp-pencil)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entry.category}
          </span>
        </span>
        <span>{entry.kind && <Chip text={KIND_LABEL[entry.kind] ?? label(entry.kind)} color="var(--vp-ink, #111)" />}</span>
        <span style={{ ...monoNum, fontSize: '9px', fontWeight: 700, textAlign: 'right', minWidth: '64px', color: entry.allocated == null ? 'var(--vp-pencil)' : 'var(--vp-ink)' }}>
          {entry.allocated == null ? 'AMOUNT NOT SET' : fmtMoney(entry.allocated, entry.currency)}
        </span>
      </div>
      {expanded && (
        <div style={{ borderLeft: '2px solid var(--vp-ghost)', borderRight: '2px solid var(--vp-ghost)', borderBottom: '2px solid var(--vp-ghost)', padding: '6px 8px', background: 'var(--vp-row-alt, #fafafa)' }}>
          {kv('Basis', entry.basis ?? 'No reason recorded')}
          {kv('Assigned by', `${who}${entry.assignedMethod ? ` · ${entry.assignedMethod}` : ''}`)}
          {entry.bookAmount != null && entry.allocated !== entry.bookAmount && kv('Booked expense', fmtMoney(entry.bookAmount, entry.currency))}
          {entry.account && kv('Paid from', entry.account)}
          {entry.ledgerId && kv('Ledger id', entry.ledgerId)}
          <div style={{ marginTop: '4px', fontSize: '8px' }}>
            <PrefetchLink to={`/accounting?book=${entry.bookOwnerId}${entry.year ? `&year=${entry.year}` : ''}`}>Open in accounting</PrefetchLink>
          </div>
        </div>
      )}
    </div>
  );
};

const BookSection: React.FC<{ entries: BookCostEntry[]; totals: BookCostTotal[]; alongsideAudit: boolean }> = ({ entries, totals, alongsideAudit }) => (
  <div style={{ marginBottom: '10px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '2px solid var(--vp-ink)', padding: '3px 0 2px', marginBottom: '4px' }}>
      <span style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>In the accounts</span>
      <span style={{ fontSize: '8px', color: 'var(--vp-pencil)', ...monoNum, letterSpacing: '0.04em' }}>
        {entries.length} {entries.length === 1 ? 'ENTRY' : 'ENTRIES'}
      </span>
    </div>
    <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', lineHeight: 1.5, marginBottom: '6px' }}>
      Booked expenses the accounts assign to this vehicle, with the reason recorded for each.
      {alongsideAudit ? ' Kept apart from the totals above: a purchase can appear both here and above.' : ''}
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(totals.length, 2)}, 1fr)`, gap: '2px', marginBottom: '6px' }}>
      {totals.map(t => (
        <div key={t.currency} style={{ border: '2px solid var(--vp-ghost)', borderTop: '3px solid var(--vp-ink, #111)', padding: '6px 8px' }}>
          <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Assigned in the accounts</div>
          <div style={{ ...monoNum, fontSize: '13px', fontWeight: 700 }}>{fmtMoney(t.total, t.currency)}</div>
          <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: '1px' }}>
            {t.entries} {t.entries === 1 ? 'entry' : 'entries'}{t.unsplit ? ` · ${t.unsplit} amount not set` : ''}
          </div>
        </div>
      ))}
    </div>
    {entries.map(e => <BookCostRow key={e.id} entry={e} />)}
  </div>
);

// ── Working notes from then: the owner's spreadsheets from the time that name this vehicle ──

const fmtPeriod = (from: string | null, to: string | null) =>
  !from && !to ? '—' : from === to || !to ? fmtDate(from) : `${fmtDate(from)} – ${fmtDate(to)}`;

// Read-only context. Rows are shown as written; their amounts are never added to any total above.
const WorkingNoteRowView: React.FC<{ note: WorkingNoteTable }> = ({ note }) => {
  const [expanded, setExpanded] = useState(false);
  const title = [note.workbook, note.sheet && note.sheet !== note.table ? note.sheet : null, note.table].filter(Boolean).join(' › ');
  return (
    <div style={{ marginBottom: '2px' }}>
      <div
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '2px 8px', alignItems: 'center',
          padding: '4px 6px', cursor: 'pointer', userSelect: 'none', border: '2px solid var(--vp-ghost)',
          background: expanded ? 'var(--vp-row-alt, #fafafa)' : 'transparent',
        }}
      >
        <span style={{ minWidth: 0, overflow: 'hidden' }}>
          <span style={{ fontSize: '8px', fontWeight: 700, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {expanded ? '▾' : '▸'} {title || 'Untitled sheet'}
          </span>
          <span style={{ ...monoNum, fontSize: '8px', color: 'var(--vp-pencil)', display: 'block' }}>
            {fmtPeriod(note.periodFrom, note.periodTo)}{note.periodBasis === 'file_clock' ? ' (file dates)' : ''}
          </span>
        </span>
        <span>{note.vehicleMatch === 'candidate' && <Chip text="POSSIBLE MATCH" color="var(--vp-pencil, #888)" title="The sheet names a vehicle like this one; it may be another" />}</span>
        <span style={{ ...monoNum, fontSize: '8px', color: 'var(--vp-pencil)', textAlign: 'right' }}>
          {note.rowsMatched === note.rowsTotal ? `${note.rowsTotal} rows` : `${note.rowsMatched} of ${note.rowsTotal} rows`}
        </span>
      </div>
      {expanded && (
        <div style={{ borderLeft: '2px solid var(--vp-ghost)', borderRight: '2px solid var(--vp-ghost)', borderBottom: '2px solid var(--vp-ghost)', padding: '6px 8px', background: 'var(--vp-row-alt, #fafafa)' }}>
          {note.rows.map(r => (
            <div key={r.r} style={{ display: 'grid', gridTemplateColumns: '28px 64px 1fr', gap: '6px', marginBottom: '2px', alignItems: 'baseline' }}>
              <span style={{ ...monoNum, fontSize: '8px', color: 'var(--vp-pencil)' }}>R{r.r}</span>
              <span style={{ ...monoNum, fontSize: '8px', color: 'var(--vp-pencil)' }}>{r.d ? fmtDate(r.d) : ''}</span>
              <span style={{ ...monoNum, fontSize: '8px', wordBreak: 'break-word', color: 'var(--vp-ink)' }}>{r.t}</span>
            </div>
          ))}
          {note.rowsMatched > note.rows.length && (
            <div style={{ fontSize: '8px', color: 'var(--vp-pencil)' }}>{note.rowsMatched - note.rows.length} more rows in the sheet.</div>
          )}
          <div style={{ marginTop: '4px', fontSize: '8px' }}>
            <PrefetchLink to={`/accounting?book=${note.bookOwnerId}`}>Open the source in accounting</PrefetchLink>
          </div>
        </div>
      )}
    </div>
  );
};

const WorkingNotesSection: React.FC<{ notes: WorkingNoteTable[] }> = ({ notes }) => (
  <div style={{ marginBottom: '10px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '2px solid var(--vp-ink)', padding: '3px 0 2px', marginBottom: '4px' }}>
      <span style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Working notes from then</span>
      <span style={{ fontSize: '8px', color: 'var(--vp-pencil)', ...monoNum, letterSpacing: '0.04em' }}>
        {notes.length} {notes.length === 1 ? 'SHEET' : 'SHEETS'}
      </span>
    </div>
    <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', lineHeight: 1.5, marginBottom: '6px' }}>
      Your spreadsheets from the time that name this vehicle. Context, not books: amounts are what was written then and
      are not added to any total.
    </div>
    {notes.map(n => <WorkingNoteRowView key={n.cellId} note={n} />)}
  </div>
);

// ── Main ──

interface BuildLedgerProps {
  vehicleId: string;
}

const BuildLedger: React.FC<BuildLedgerProps> = ({ vehicleId }) => {
  const { data, loading } = useBuildLedger(vehicleId);

  if (loading || !data.hasData) return null;

  return (
    <CollapsibleWidget
      variant="profile"
      title="Build Ledger"
      defaultCollapsed={false}
      badge={<span className="widget__count">{[data.hasAudit ? `DRAFT · ${data.entryCount} ENTRIES` : '', data.book.length ? `${data.book.length} BOOKED` : '', data.notes.length ? `${data.notes.length} NOTES` : ''].filter(Boolean).join(' · ')}</span>}
    >
      <div style={{ fontFamily: 'var(--vp-font-sans)', fontSize: '9px', lineHeight: 1.6 }}>
        {data.hasAudit && <>
        {/* Provenance banner — this is an evidence-tiered draft, not a settled ledger */}
        <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', lineHeight: 1.5, marginBottom: '6px' }}>
          Evidence-tiered reconstruction from receipts, bank, and messages
          {data.auditRun ? ` (${data.auditRun})` : ''}. Pending owner confirmation.
          Documented and stated amounts are shown separately, never blended. Unpriced entries are excluded from both subtotals.
          {data.pendingCount > 0 && (
            <span style={{ color: 'var(--vp-gulf-orange, #EE7623)', fontWeight: 700 }}>
              {' '}{data.pendingCount} {data.pendingCount === 1 ? 'entry needs' : 'entries need'} confirmation.
            </span>
          )}
        </div>

        {/* Two-tier totals — kept strictly separate */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px', marginBottom: '8px' }}>
          <SummaryCard
            label="Documented"
            amount={data.documentedTotal}
            sub="certain · probable · likely, out"
            color="var(--vp-evidence-strong, #004225)"
          />
          <SummaryCard
            label="Stated / Pending"
            amount={data.statedPendingTotal}
            sub="stated tier + liabilities"
            color="var(--vp-gulf-orange, #EE7623)"
          />
        </div>

        {data.groups.map(g => <GroupSection key={g.eventType} group={g} />)}
        </>}

        {data.book.length > 0 && <BookSection entries={data.book} totals={data.bookTotals} alongsideAudit={data.hasAudit} />}

        {data.notes.length > 0 && <WorkingNotesSection notes={data.notes} />}

        <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '2px' }}>
          Every entry expands to its verbatim source citation.
        </div>
      </div>
    </CollapsibleWidget>
  );
};

export default BuildLedger;
