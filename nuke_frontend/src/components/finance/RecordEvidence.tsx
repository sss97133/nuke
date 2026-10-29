import { useEffect, useState } from 'react';
import PrefetchLink from '../PrefetchLink';
import { Text } from '../../kit/Text';
import { useAccountingBook } from './AccountingBookContext';
import { dollars, fetchAccountingOriginal, pacific, readRecordEvidence, type RecordEvidence as Evidence } from '../../services/accountingCloseout';

const STRENGTH: Record<Evidence['strength'], string> = {
  artifact: 'Backed by a receipt or document',
  keyed_source: 'Backed by a statement line, message or job',
  attestation: 'Backed by your stated word',
  narrative: 'Only notes so far',
  none: 'No evidence recorded',
};
const ATTESTED: Record<string, string> = { closeout: 'Confirmed at close-out by', attestation: 'Attested by', confirmed: 'Confirmed by', stated: 'Stated by' };
const CITED: Record<Evidence['cited'][number]['kind'], string> = { statement: 'Statement cited', file: 'File', reference: 'Detail' };
const VIA: Record<string, string> = {
  receipt_items: 'receipt items', kept_on_receipt: 'kept on the receipt', matches_statement_line: 'matches the statement line', named_in_notes: 'named in the notes',
};

/** The receipt or document itself: an image shows inline at a reserved size; anything else opens on request. */
function Artifact({ a, onOpenDocument }: { a: Evidence['artifacts'][number]; onOpenDocument: (id: string) => void }) {
  const { ownerId } = useAccountingBook();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (a.kind !== 'image' || !ownerId) return;
    let cancelled = false, objectUrl: string | null = null;
    fetchAccountingOriginal(ownerId, a.document_id).then(({ blob }) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [a.document_id, a.kind, ownerId]);
  const label = [a.issuer, a.date ? pacific(a.date, false) : null, a.amount != null ? `${a.amount} ${a.currency || ''}`.trim() : null].filter(Boolean).join(' · ') || a.filename || 'Document';
  return <figure className="accounting-artifact">
    {a.kind === 'image' && <div className="accounting-artifact__frame">{url ? <img src={url} width={160} height={200} alt={`Receipt: ${label}`} /> : <Text role="caption">{failed ? 'Image unavailable' : 'Loading…'}</Text>}</div>}
    <figcaption>
      <button type="button" className="accounting-link-button" onClick={() => onOpenDocument(a.document_id)}>{a.kind === 'pdf' ? 'PDF' : a.kind === 'image' ? 'Receipt' : 'Document'}: {label} <span aria-hidden="true">›</span></button>
      <Text role="caption">{VIA[a.via] || a.via}</Text>
    </figcaption>
  </figure>;
}

/** One record's evidence, strongest first, from accounting_record_evidence: a few hundred bytes, already keyed. */
export default function RecordEvidence({ documentId, sourceKey, onOpenDocument, fallbackTitle }: { documentId: string; sourceKey: string; onOpenDocument: (id: string) => void; fallbackTitle: string }) {
  const { ownerId, liveRevision } = useAccountingBook();
  const [e, setE] = useState<Evidence | null | undefined>(undefined);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!ownerId) return;
    let cancelled = false;
    setError(false);
    readRecordEvidence(ownerId, documentId, sourceKey).then(result => { if (!cancelled) setE(result); }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [ownerId, documentId, sourceKey, liveRevision]);
  const heading = <h3>{e?.title || fallbackTitle || 'Selected transaction'}</h3>;
  if (error && e === undefined) return <>{heading}<p role="status"><Text role="caption">The evidence summary could not load. All retained fields remain below.</Text></p></>;
  if (e === undefined) return <>{heading}<p role="status"><Text role="caption">Reading the evidence…</Text></p></>;
  if (e === null) return heading;
  const r = e.record;
  const amount = Number(r.amount);
  const who = r.kind === 'retained_bank_movement' ? `${r.account || 'Account not recorded'}${Number.isFinite(amount) && amount < 0 ? ' paid out' : ' received'}`
    : r.section === 'Revenue' ? `Paid into ${r.account || 'an unrecorded account'}` : `Paid from ${r.account || 'an unrecorded account'}`;
  return <section className="accounting-record-evidence" aria-label="Evidence for this record">
    {heading}
    <Text role="body" as="p" className="accounting-evidence-line">{[pacific(r.date, false), who, `${dollars(r.amount)}${r.currency && r.currency !== 'USD' ? ` ${r.currency}` : ''}`, [r.section, r.category].filter(Boolean).join(' · ')].filter(Boolean).join(' · ')}</Text>
    <Text role="caption" as="p">{STRENGTH[e.strength]}</Text>
    {(e.vehicles.length > 0 || e.jobs.length > 0 || e.use) && <p className="accounting-evidence-refs">
      {e.vehicles.map(v => <PrefetchLink key={v.id} to={`/vehicle/${v.id}`} target="_blank" rel="noopener noreferrer">{v.label} ↗</PrefetchLink>)}
      {e.jobs.map(j => <PrefetchLink key={j.id} to={`/jobs/${j.id}`} target="_blank" rel="noopener noreferrer">{j.title || 'Job'} ↗</PrefetchLink>)}
      {e.use && !e.use.vehicle_id && <Text role="caption">Use: {e.use.label || e.use.use_type || 'not assigned'}</Text>}
    </p>}
    {e.artifacts.length > 0 && <div className="accounting-artifacts">{e.artifacts.map(a => <Artifact key={a.document_id} a={a} onOpenDocument={onOpenDocument} />)}</div>}
    {e.statement_lines.length > 0 && <ul className="accounting-evidence-keys" aria-label="Statement lines">{e.statement_lines.map(s =>
      <li key={s.source_key}><button type="button" className="accounting-link-button" onClick={() => onOpenDocument(s.document_id)}>
        <Text role="caption">Statement</Text> {[s.account, pacific(s.date, false), dollars(s.amount), s.description].filter(Boolean).join(' · ')}</button></li>)}</ul>}
    {e.linked_decisions.length > 0 && <ul className="accounting-evidence-keys" aria-label="Booked as">{e.linked_decisions.map(d =>
      <li key={d.source_key}><button type="button" className="accounting-link-button" onClick={() => onOpenDocument(d.document_id)}>
        <Text role="caption">Booked as</Text> {[d.section, d.category, dollars(d.amount)].filter(Boolean).join(' · ')}</button></li>)}</ul>}
    {e.messages.length > 0 && <ul className="accounting-evidence-keys" aria-label="Messages">{e.messages.map(m => m.kind === 'gmail'
      ? <li key={m.id}><a href={`https://mail.google.com/mail/u/0/#all/${m.id}`} target="_blank" rel="noopener noreferrer">
        <Text role="caption">Gmail · {pacific(m.sent_at, false)}</Text> “{m.quote || m.id}” ↗</a></li>
      : <li key={m.id}><Text role="caption">{[`${m.channel} message`, m.sent_at ? pacific(m.sent_at) : null, m.id].filter(Boolean).join(' · ')}</Text></li>)}</ul>}
    {e.attestations.map((a, i) => <blockquote key={i} className="accounting-evidence-attestation">{a.text
      ? <><Text role="body">“{a.text}”</Text><Text role="caption"> — {a.by === 'owner' ? 'you' : a.by}{a.at ? `, ${pacific(a.at, false)}` : ''}</Text></>
      : <Text role="caption">{ATTESTED[a.via] || 'Stated by'} {a.by === 'owner' ? 'you' : a.by}{a.at ? `, ${pacific(a.at, false)}` : ''}</Text>}</blockquote>)}
    {e.cited.length > 0 && <ul className="accounting-evidence-keys" aria-label="Cited sources">{e.cited.map((c, i) =>
      <li key={i}><Text role="caption">{CITED[c.kind]}</Text> <Text role="body">{c.text}</Text></li>)}</ul>}
    {e.questions.length > 0 && <ul className="accounting-evidence-keys" aria-label="Open questions">{e.questions.map(q =>
      <li key={q.id}><Text role="caption">Question{q.resolver ? ` for ${q.resolver}` : ''}</Text> <Text role="body">{q.detail}</Text></li>)}</ul>}
    {(e.notes || r.description) && <details className="accounting-evidence-notes"><summary>Notes <span>{e.notes ? `the bookkeeping reasoning, ${e.notes.length.toLocaleString('en-US')} characters` : 'the original description'}</span></summary>
      {r.description && r.description !== e.title && <Text role="caption" as="p">Original description: {r.description}</Text>}
      {e.notes && <Text role="body" as="p">{e.notes}</Text>}</details>}
  </section>;
}
