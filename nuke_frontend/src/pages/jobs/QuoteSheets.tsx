import React, { useMemo, useState } from 'react';
import { Text } from '../../kit';
import { SignSheet } from './SignSheet';
import { arr, obj, sentence, str, type JobAction, type JsonObject } from './jobRead';
import {
  BASES, baseLines, changeOrderArgs, feeLine, quoteArgs, quoteScope, releaseVocabulary, seedQuoteLines,
  type AddedLine, type BaseLineDraft, type LineDraft, type Substitution,
} from './signDrafts';
import { termsOf, useWriter } from './useWriter';

const REF_LABEL: Record<string, string> = { operation: 'Work', requirement: 'Need', part: 'Part', labor: 'Labor', fee: 'Fee' };
const RELEASE_LABEL: Record<string, string> = {
  customer_completion_sign: 'The customer confirms the work is done',
  inspector_attestation: 'An inspector signs off on the work',
  installed_parts_witness: 'The installed parts are witnessed',
  photos_in_window: 'Photos are taken in the job window',
  days_signed: 'Days have passed since sign-off',
};

function PriceFields({ basis, amount, currency, quantity, onChange, label }: {
  basis: string; amount: string; currency?: string; quantity: string; label: string;
  onChange: (patch: { basis?: string; amount?: string; currency?: string; quantity?: string }) => void;
}) {
  const b = BASES.find(x => x.key === basis) ?? BASES[0];
  return <div className="jb-field--row">
    <label className="jb-field"><Text role="label">Priced</Text>
      <select className="jb-input k-body" aria-label={`${label} pricing`} value={basis} onChange={e => onChange({ basis: e.target.value })}>
        {BASES.map(x => <option key={x.key} value={x.key}>{x.title}</option>)}
      </select></label>
    <label className="jb-field"><Text role="label">Amount</Text>
      <input className="jb-input k-body" aria-label={`${label} amount`} inputMode="decimal" value={amount} onChange={e => onChange({ amount: e.target.value })} /></label>
    {currency !== undefined && <label className="jb-field"><Text role="label">Currency</Text>
      <input className="jb-input jb-input--short k-body" aria-label={`${label} currency`} maxLength={3} value={currency} onChange={e => onChange({ currency: e.target.value })} /></label>}
    {b.unit && <label className="jb-field"><Text role="label">{b.qty}</Text>
      <input className="jb-input jb-input--short k-body" aria-label={`${label} quantity`} inputMode="decimal" value={quantity} onChange={e => onChange({ quantity: e.target.value })} /></label>}
  </div>;
}

/** Issue or revise a quote, offered only by work_order_quotes_read's issuer_actions (issue_quote). */
export function IssueQuoteSheet({ action, operations, quotes, onClose, onDone }: {
  action: JobAction; operations: JsonObject | null; quotes: JsonObject | null; onClose: () => void; onDone: () => void;
}) {
  const current = obj(quotes?.current_quote);
  const revising = !!str(action.args.p_supersedes_quote_id);
  const [lines, setLines] = useState<LineDraft[]>(() => seedQuoteLines(quoteScope(operations), revising ? current : null));
  const [useDeposit, setUseDeposit] = useState(false);
  const [deposit, setDeposit] = useState({ amount: '', currency: 'USD' });
  const [validUntil, setValidUntil] = useState('');
  const [conditions, setConditions] = useState<string[]>([]);
  const [days, setDays] = useState('7');
  const vocab = useMemo(() => releaseVocabulary(action), [action]);
  const w = useWriter();
  const update = (i: number, patch: Partial<LineDraft>) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const { says, doesNotSay } = termsOf(action);

  const send = async () => {
    const built = quoteArgs(action, lines, useDeposit ? deposit : null, validUntil, conditions, Number(days));
    if (!built.ok) { w.setFailure(built.error); return; }
    await w.run('issue_work_order_quote', built.args);
  };
  const title = revising ? (current?.issued_by_viewer === true ? 'Revise quote' : 'Issue a new version') : 'Issue quote';

  return <SignSheet title={title} says={says} doesNotSay={doesNotSay} confirmLabel={revising ? 'Issue new version' : 'Issue quote'}
    onConfirm={send} onClose={w.done ? () => { onDone(); onClose(); } : onClose} busy={w.busy} failure={w.failure}
    done={w.done && <Text role="body" className="jb-done">{`Quote issued${w.done.version ? ` · version ${w.done.version}` : ''}. The customer can accept it on the job page.`}</Text>}>
    {!w.done && <>
      {lines.map((l, i) => <div className="jb-line" key={i} role="group" aria-label={`Quote line ${i + 1}`}>
        <label className="jb-choice"><span><input type="checkbox" checked={l.included} onChange={e => update(i, { included: e.target.checked })} />{' '}
          <Text role="label">{REF_LABEL[l.refKind] ?? 'Line'}</Text></span></label>
        <label className="jb-field"><Text role="label">Description</Text>
          <input className="jb-input k-body" aria-label={`Line ${i + 1} description`} maxLength={500} value={l.description} onChange={e => update(i, { description: e.target.value })} /></label>
        <PriceFields label={`Line ${i + 1}`} basis={l.basis} amount={l.amount} currency={l.currency} quantity={l.quantity} onChange={p => update(i, p)} />
      </div>)}
      <div><button type="button" className="btn-base btn-xs btn-secondary" onClick={() => setLines(ls => [...ls, feeLine()])}><Text role="label">Add a fee line</Text></button></div>
      <label className="jb-choice"><span><input type="checkbox" checked={useDeposit} onChange={e => setUseDeposit(e.target.checked)} /> <Text role="body">Request a deposit (a term, not a payment)</Text></span></label>
      {useDeposit && <div className="jb-field--row">
        <label className="jb-field"><Text role="label">Deposit</Text><input className="jb-input k-body" aria-label="Deposit amount" inputMode="decimal" value={deposit.amount} onChange={e => setDeposit(d => ({ ...d, amount: e.target.value }))} /></label>
        <label className="jb-field"><Text role="label">Currency</Text><input className="jb-input jb-input--short k-body" aria-label="Deposit currency" maxLength={3} value={deposit.currency} onChange={e => setDeposit(d => ({ ...d, currency: e.target.value }))} /></label>
      </div>}
      <label className="jb-field"><Text role="label">Valid until (optional)</Text>
        <input type="date" className="jb-input k-body" aria-label="Valid until" value={validUntil} onChange={e => setValidUntil(e.target.value)} /></label>
      {vocab.length > 0 && <div className="jb-field" role="group" aria-label="Release conditions">
        <Text role="label">Payment is released when (optional)</Text>
        {vocab.map(c => <label key={c.kind} className="jb-choice"><span>
          <input type="checkbox" checked={conditions.includes(c.kind)} onChange={e => setConditions(cs => (e.target.checked ? [...cs, c.kind] : cs.filter(x => x !== c.kind)))} />{' '}
          <Text role="body">{RELEASE_LABEL[c.kind] ?? sentence(c.kind)}</Text></span>
          {c.takesDays && conditions.includes(c.kind) && <input className="jb-input jb-input--short k-body" aria-label="Days after sign-off" inputMode="numeric" value={days} onChange={e => setDays(e.target.value)} />}
        </label>)}
        <Text role="caption">Without conditions, Nuke's standard conditions apply. Nuke records when they are met; it doesn't hold or move money.</Text>
      </div>}
    </>}
  </SignSheet>;
}

/** A change order on the accepted quote, offered only by issuer_actions (issue_change_order). */
export function ChangeOrderSheet({ action, quotes, onClose, onDone }: { action: JobAction; quotes: JsonObject | null; onClose: () => void; onDone: () => void }) {
  const quote = obj(quotes?.current_quote);
  const [lines, setLines] = useState<BaseLineDraft[]>(() => baseLines(quote));
  const [added, setAdded] = useState<AddedLine[]>([]);
  const [subs, setSubs] = useState<Substitution[]>([]);
  const [reason, setReason] = useState('');
  const specs = arr(obj(quote?.scope_snapshot)?.specifications).map(obj).filter((o): o is JsonObject => !!o && !!str(o.id));
  const w = useWriter();
  const { says, doesNotSay } = termsOf(action);
  const update = (i: number, patch: Partial<BaseLineDraft>) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const send = async () => {
    const built = changeOrderArgs(action, quote, lines, added, subs, reason);
    if (!built.ok) { w.setFailure(built.error); return; }
    await w.run('issue_change_order', built.args);
  };

  return <SignSheet title="Issue a change order" says={says} doesNotSay={doesNotSay} confirmLabel="Issue change order" onConfirm={send}
    onClose={w.done ? () => { onDone(); onClose(); } : onClose} busy={w.busy} failure={w.failure}
    done={w.done && <Text role="body" className="jb-done">Change order issued. The customer accepts it like a quote.</Text>}>
    {!w.done && <>
      {lines.map((l, i) => <div className="jb-line" key={l.index} role="group" aria-label={`Quoted line ${l.index + 1}`}>
        <div className="jb-field--row">
          <Text role="body">{l.description || `Line ${l.index + 1}`}</Text>
          <select className="jb-input jb-input--short k-body" aria-label={`Line ${l.index + 1} change`} value={l.state} onChange={e => update(i, { state: e.target.value as BaseLineDraft['state'] })}>
            <option value="keep">Keep</option><option value="modify">Modify</option><option value="remove">Remove</option>
          </select>
        </div>
        {l.state === 'modify' && <>
          <label className="jb-field"><Text role="label">Description</Text><input className="jb-input k-body" maxLength={500} value={l.description} onChange={e => update(i, { description: e.target.value })} /></label>
          <PriceFields label={`Line ${l.index + 1}`} basis={l.basis} amount={l.amount} quantity={l.quantity} onChange={p => update(i, p)} />
        </>}
      </div>)}
      {added.map((d, i) => <div className="jb-line" key={`a${i}`} role="group" aria-label={`Added line ${i + 1}`}>
        <label className="jb-field"><Text role="label">Added line</Text><input className="jb-input k-body" maxLength={500} value={d.description}
          onChange={e => setAdded(xs => xs.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} /></label>
        <PriceFields label={`Added line ${i + 1}`} basis={d.basis} amount={d.amount} quantity={d.quantity}
          onChange={p => setAdded(xs => xs.map((x, j) => (j === i ? { ...x, ...p } : x)))} />
      </div>)}
      <div className="jb-actions">
        <button type="button" className="btn-base btn-xs btn-secondary" onClick={() => setAdded(xs => [...xs, { description: '', basis: 'flat', amount: '', quantity: '' }])}><Text role="label">Add a line</Text></button>
        {specs.length > 0 && <button type="button" className="btn-base btn-xs btn-secondary"
          onClick={() => setSubs(xs => [...xs, { specId: str(specs[0].id)!, field: 'material', toKey: '', toLabel: '' }])}><Text role="label">Substitute a material or process</Text></button>}
      </div>
      {subs.map((s, i) => <div className="jb-line" key={`s${i}`} role="group" aria-label={`Substitution ${i + 1}`}>
        <div className="jb-field--row">
          <select className="jb-input k-body" aria-label="Specification" value={s.specId} onChange={e => setSubs(xs => xs.map((x, j) => (j === i ? { ...x, specId: e.target.value } : x)))}>
            {specs.map(sp => <option key={str(sp.id)!} value={str(sp.id)!}>{[str(sp.material_label) ?? str(sp.material_key), str(sp.process_label) ?? str(sp.process_key)].filter(Boolean).join(' · ') || 'Specification'}</option>)}
          </select>
          <select className="jb-input jb-input--short k-body" aria-label="Field" value={s.field} onChange={e => setSubs(xs => xs.map((x, j) => (j === i ? { ...x, field: e.target.value as Substitution['field'] } : x)))}>
            <option value="material">Material</option><option value="process">Process</option>
          </select>
        </div>
        <label className="jb-field"><Text role="label">Substitute key (like mild_steel)</Text><input className="jb-input k-body" maxLength={80} value={s.toKey}
          onChange={e => setSubs(xs => xs.map((x, j) => (j === i ? { ...x, toKey: e.target.value } : x)))} /></label>
      </div>)}
      <label className="jb-field"><Text role="label">Why the work changed</Text>
        <textarea className="jb-input k-body" aria-label="Reason" maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>
    </>}
  </SignSheet>;
}
