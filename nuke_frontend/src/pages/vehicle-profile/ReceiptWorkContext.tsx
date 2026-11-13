/**
 * ReceiptWorkContext — the receipt-to-work context under a day-document line, behind a tap.
 *
 * Data: get_vehicle_receipt_work_context(vehicle, page date), one read per day that has paper. It returns the current
 * PROPOSED context per receipt line (a shared time window between the line and photos), the frames this viewer may see,
 * lineage (the page is unresolved), what the document prints, the open or answered question, and withdrawals apart.
 * Nothing here says who owns the car, who paid, who installed the part or who did the work: photographer, printed
 * performer, custodian and holder are shown as separately labelled fields, each with what it is.
 */
import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { openVehiclePhoto } from './VehiclePhotoLightbox';

export interface ReceiptWorkFrame {
  image_id: string;
  taken_at: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  photographer?: { label?: string; attribution?: string | null; documented_by_user_id?: string | null } | null;
}
export interface ReceiptWorkJudgment {
  question_id: string;
  status: 'pending' | 'claimed' | 'answered';
  asked_at?: string | null;
  holder?: { label?: string; claimed_by?: string | null; claimed_at?: string | null } | null;
  answer?: { visible?: string | null; installed?: string | null; confidence?: number | null; image_id?: string | null; quote?: string | null;
    answered_at?: string | null; answer_agent?: string | null; answer_model?: string | null } | null;
}
export interface ReceiptWorkLine {
  evidence_id: string;
  receipt_id: string;
  item_id: string | null;
  line_number: number | null;
  description?: string | null;
  conclusion: string;
  confidence: number | null;
  status: 'proposed';
  anchor_date?: string | null;
  anchor_source?: string | null;
  zone?: string | null;
  days_to_first_photo?: number | null;
  frames: ReceiptWorkFrame[];
  frames_hidden: number;
  lineage: { receipt_id: string; source_document_table: string | null; source_document_id: string | null; line_number: number | null;
    item_id: string | null; link_id: string | null; link_basis: string | null; link_confidence: number | null; page: null; page_reason: string };
  printed: { attributed_to: 'document'; line_date: string | null; hours: number | null; performer: string | null };
  printed_performer?: { label?: string; value?: string | null } | null;
  custodian?: { label?: string; user_id?: string | null; masked?: boolean } | null;
  judgment: ReceiptWorkJudgment | null;
}
export interface ReceiptWorkWithdrawal {
  evidence_id: string; receipt_id: string; item_id: string | null; line_number: number | null; description?: string | null;
  status: 'withdrawn'; reason: string | null; prior_conclusion?: string | null; withdrawn_at?: string | null;
}
export interface ReceiptWorkContextRead { visible: boolean; tied: boolean; lines: ReceiptWorkLine[]; withdrawn: ReceiptWorkWithdrawal[] }

/** The key a day-document line and its context share: the receipt and the printed line number. */
export const receiptLineKey = (receiptId: string, lineNumber: number | null | undefined) => `${receiptId}:${lineNumber ?? '-'}`;

const CONCLUSION_WORDS: Record<string, string> = {
  install_window_photographed: 'the zone was photographed in the window after this date',
  photographed_after_window: 'the zone was photographed, but only after the window',
  no_zone_photo_after_purchase: 'no photo of the zone after this date',
  part_zone_unknown: 'the line names nothing a photo would show',
  receipt_day_photographed: 'photos exist on the receipt day',
  receipt_day_unphotographed: 'no photos on the receipt day',
  work_day_photographed: 'photos exist on the printed work day',
  work_day_unphotographed: 'no photos on the printed work day',
  undated_line: 'no date to compare with photos',
  not_work_evidence: 'a charge or note, not work',
};
const WITHDRAWN_WORDS: Record<string, string> = {
  line_removed: 'the line was removed from the receipt',
  receipt_removed: 'the receipt was removed',
  receipt_superseded: 'the receipt was superseded by a corrected one',
  receipt_duplicate: 'the receipt is a duplicate',
  link_retired: 'the receipt is no longer linked to this vehicle',
  not_returned: 'the source no longer returns this line',
};

/** Plain words for a proposed conclusion; never a claim of installation, payment or ownership. */
export function describeConclusion(conclusion: string): string {
  return CONCLUSION_WORDS[conclusion] ?? conclusion.replace(/_/g, ' ');
}
export function describeWithdrawal(reason: string | null | undefined): string {
  return (reason && WITHDRAWN_WORDS[reason]) ?? 'the source was withdrawn';
}
/** The question's state in words: open (pending / held) or answered, the answer being a model's reading, not a Sign. */
export function describeJudgment(j: ReceiptWorkJudgment | null | undefined): string | null {
  if (!j) return null;
  if (j.status === 'pending') return 'question open: is the part visible in these frames?';
  if (j.status === 'claimed') return 'question open, being read';
  const a = j.answer ?? {};
  const parts = [a.visible ? `visible: ${a.visible.replace(/_/g, ' ')}` : null, a.installed ? `installed: ${a.installed.replace(/_/g, ' ')}` : null,
    a.confidence != null ? `confidence ${Number(a.confidence).toFixed(2)}` : null].filter(Boolean);
  return `answered (a model's reading, not a sign): ${parts.join(' · ') || 'no detail'}`;
}
/** Where the line's context comes from, in one line: the source document, the line, the link; the page is unresolved. */
export function describeLineage(l: ReceiptWorkLine['lineage']): string {
  return [l.source_document_table ? `source ${l.source_document_table.replace(/_/g, ' ')}` : 'source document unknown',
    l.line_number != null ? `line ${l.line_number}` : 'whole receipt',
    l.link_basis ? `linked by ${l.link_basis.replace(/_/g, ' ')}${l.link_confidence != null ? ` ${Number(l.link_confidence).toFixed(2)}` : ''}` : null,
    `page: ${l.page_reason}`].filter(Boolean).join(' · ');
}
/** What the document itself prints for the line, attributed to the document. */
export function describePrinted(p: ReceiptWorkLine['printed'] | null | undefined): string | null {
  if (!p) return null;
  const parts = [p.line_date ? `date ${p.line_date}` : null, p.hours != null ? `${p.hours} h` : null, p.performer ? `performer ${p.performer}` : null].filter(Boolean);
  return parts.length ? `printed on the document: ${parts.join(' · ')}` : null;
}

/** One read of the day's receipt-work context, only when the day has paper; a failed read shows nothing extra. */
export function useReceiptWorkContext(vehicleId: string | null | undefined, date: string, enabled: boolean) {
  const key = `${vehicleId}:${date}`;
  const [read, setRead] = useState<{ key: string; data: ReceiptWorkContextRead | null } | null>(null);
  useEffect(() => {
    if (!vehicleId || !date || !enabled) return;
    let cancelled = false;
    Promise.resolve(supabase.rpc('get_vehicle_receipt_work_context', { p_vehicle_id: vehicleId, p_page_date: date }))
      .then(({ data, error }) => {
        if (cancelled) return;
        const ok = !error && data && Array.isArray((data as ReceiptWorkContextRead).lines);
        setRead({ key, data: ok ? (data as ReceiptWorkContextRead) : null });
      })
      .catch(() => { if (!cancelled) setRead({ key, data: null }); });
    return () => { cancelled = true; };
  }, [vehicleId, date, enabled, key]);
  const data = read?.key === key ? read.data : null;
  const byLine = new Map<string, ReceiptWorkLine>();
  const withdrawnByLine = new Map<string, ReceiptWorkWithdrawal>();
  for (const l of data?.lines ?? []) byLine.set(receiptLineKey(l.receipt_id, l.line_number), l);
  for (const w of data?.withdrawn ?? []) withdrawnByLine.set(receiptLineKey(w.receipt_id, w.line_number), w);
  return { data, byLine, withdrawnByLine };
}

const mono: React.CSSProperties = { fontFamily: "var(--vp-font-mono, 'Courier New', monospace)" };
const quiet: React.CSSProperties = { ...mono, fontSize: 8, color: 'var(--vp-pencil, #888)', lineHeight: 1.5 };

/** The tap under a line and what it opens. Renders nothing when the line has no context and no withdrawal. */
export const ReceiptLineContext: React.FC<{ line?: ReceiptWorkLine | null; withdrawn?: ReceiptWorkWithdrawal | null }> = ({ line, withdrawn }) => {
  const [open, setOpen] = useState(false);
  if (!line && !withdrawn) return null;
  if (!line && withdrawn) {
    return <div className="day-drawer__context-withdrawn" style={quiet}>context withdrawn: {describeWithdrawal(withdrawn.reason)}</div>;
  }
  const l = line!;
  const judgment = describeJudgment(l.judgment);
  const printed = describePrinted(l.printed);
  const photographers = [...new Set(l.frames.map(f => f.photographer?.attribution).filter(Boolean) as string[])];
  return (
    <div className="day-drawer__context">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        title="Proposed context from shared dates; not proof of installation, payment, ownership or who did the work"
        style={{ ...mono, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 8, color: 'var(--vp-gulf-blue, #1f5fbf)', textDecoration: 'underline dotted' }}
      >{open ? 'CONTEXT ▾' : 'CONTEXT ▸'} proposed{l.judgment ? ` · ${l.judgment.status === 'answered' ? 'answered' : 'question open'}` : ''}</button>
      {open && (
        <div className="day-drawer__context-body" style={{ ...quiet, borderLeft: '1px solid var(--vp-ghost, #ddd)', paddingLeft: 6, margin: '2px 0 4px' }}>
          <div>PROPOSED · {describeConclusion(l.conclusion)}{l.confidence != null ? ` · ${Number(l.confidence).toFixed(2)}` : ''}</div>
          <div>shared dates only; not proof of installation, payment, ownership or who did the work</div>
          {l.anchor_date && <div>compared from {l.anchor_date}{l.anchor_source ? ` (${l.anchor_source.replace(/_/g, ' ')})` : ''}{l.zone ? ` · zone ${l.zone}` : ''}</div>}
          {(l.frames.length > 0 || l.frames_hidden > 0) && (
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center', marginTop: 2 }}>
              {l.frames.map(f => (
                <button
                  key={f.image_id}
                  type="button"
                  className="day-drawer__context-frame"
                  onClick={() => openVehiclePhoto(f.image_id)}
                  title={f.taken_at ? `photo taken ${f.taken_at.slice(0, 10)}` : 'photo'}
                  style={{ padding: 0, border: '1px solid var(--vp-ghost, #ddd)', background: 'var(--vp-row-alt, #f9f9f9)', cursor: 'pointer', width: 36, height: 36, overflow: 'hidden' }}
                >
                  {(f.thumbnail_url || f.image_url) && <img src={f.thumbnail_url || f.image_url || ''} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
                </button>
              ))}
              {l.frames_hidden > 0 && <span>{l.frames_hidden} frame{l.frames_hidden === 1 ? '' : 's'} withheld (private or not yet cleared)</span>}
            </div>
          )}
          {printed && <div>{printed}</div>}
          <div>{describeLineage(l.lineage)}</div>
          {photographers.length > 0 && <div>photographer (from the photo record): {photographers.join(', ')}</div>}
          {l.printed_performer?.value && <div>performer as printed (the document says so): {l.printed_performer.value}</div>}
          {l.custodian && <div>custodian: the account the document is filed under{l.custodian.masked ? ' (withheld for this viewer)' : ''}; custody only, not ownership or payment</div>}
          {judgment && <div>{judgment}{l.judgment?.status === 'claimed' && l.judgment.holder?.claimed_by ? ` · holder: ${l.judgment.holder.claimed_by} (a worker, not a person on the document)` : ''}</div>}
          {l.judgment?.answer?.quote && <div>“{l.judgment.answer.quote}”</div>}
        </div>
      )}
    </div>
  );
};

export default ReceiptLineContext;
