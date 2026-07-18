import React, { useState } from 'react';
import { CollapsibleWidget } from '../../components/ui/CollapsibleWidget';
import { askAgent } from '../../components/agent/askAgent';
import { useBuildLedger, type BuildLedgerEntry, type BuildLedgerGroup } from './hooks/useBuildLedger';

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
          {isLiability ? `(${fmt(entry.amountUsd)})` : fmt(entry.amountUsd)}
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

const SummaryCard: React.FC<{ label: string; amount: number; sub: string; color: string }> = ({ label, amount, sub, color }) => (
  <div style={{ border: '2px solid var(--vp-ghost)', borderTop: `3px solid ${color}`, padding: '6px 8px' }}>
    <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>{label}</div>
    <div style={{ ...monoNum, fontSize: '13px', fontWeight: 700, color }}>{fmt(amount)}</div>
    <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: '1px' }}>{sub}</div>
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
      badge={<span className="widget__count">DRAFT · {data.entryCount} ENTRIES</span>}
    >
      <div style={{ fontFamily: 'var(--vp-font-sans)', fontSize: '9px', lineHeight: 1.6 }}>
        {/* Provenance banner — this is an evidence-tiered draft, not a settled ledger */}
        <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', lineHeight: 1.5, marginBottom: '6px' }}>
          Evidence-tiered reconstruction from receipts, bank, and messages
          {data.auditRun ? ` (${data.auditRun})` : ''}. Pending owner confirmation.
          Documented and stated amounts are shown separately, never blended.
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

        <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '2px' }}>
          Every entry expands to its verbatim source citation.
        </div>
      </div>
    </CollapsibleWidget>
  );
};

export default BuildLedger;
