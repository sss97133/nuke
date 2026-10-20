import React, { useEffect, useMemo, useState } from 'react';
import { Text } from '../../kit';
import { SignSheet } from './SignSheet';
import { arr, day, obj, sentence, str, type JobAction, type JsonObject } from './jobRead';
import {
  CONDITIONS, SEVERITIES, SYSTEMS, VERDICTS, evidenceArgs, findingsArgs, grantArgs, notAttachableText, type FindingDraft,
} from './signDrafts';
import { readJob, type Load } from './readJob';
import { termsOf, useWriter } from './useWriter';

const blank = (itemId: string | null): FindingDraft => ({ itemId, verdict: null, finding: '', severity: 'info', system: '', photoRef: '' });

function FindingFields({ d, onChange, label }: { d: FindingDraft; onChange: (p: Partial<FindingDraft>) => void; label: string }) {
  return <>
    <label className="jb-field"><Text role="label">What you found</Text>
      <input className="jb-input k-body" aria-label={`${label} finding`} maxLength={2000} value={d.finding} onChange={e => onChange({ finding: e.target.value })} /></label>
    <div className="jb-field--row">
      <label className="jb-field"><Text role="label">Severity</Text>
        <select className="jb-input k-body" aria-label={`${label} severity`} value={d.severity} onChange={e => onChange({ severity: e.target.value })}>
          {SEVERITIES.map(s => <option key={s.key} value={s.key}>{s.title}</option>)}</select></label>
      <label className="jb-field"><Text role="label">System (optional)</Text>
        <select className="jb-input k-body" aria-label={`${label} system`} value={d.system} onChange={e => onChange({ system: e.target.value })}>
          <option value="">Not stated</option>{SYSTEMS.map(s => <option key={s} value={s}>{sentence(s)}</option>)}</select></label>
    </div>
    <label className="jb-field"><Text role="label">Photo reference (optional)</Text>
      <input className="jb-input k-body" aria-label={`${label} photo reference`} maxLength={1024} value={d.photoRef} onChange={e => onChange({ photoRef: e.target.value })} /></label>
  </>;
}

/** record_inspection_findings for the accepted inspector: verdicts against the checklist, plus other findings. */
export function RecordFindingsSheet({ action, inspection, onClose, onDone }: { action: JobAction; inspection: JsonObject | null; onClose: () => void; onDone: () => void }) {
  const doc = arr(inspection?.inspections).map(obj).find(i => str(i?.work_order_id) === str(action.args.p_inspection_work_order_id)) ?? null;
  const checklist = arr(doc?.checklist).map(obj).filter((o): o is JsonObject => !!o && !!str(o.item_id));
  const [items, setItems] = useState<FindingDraft[]>(() => checklist.map(c => blank(str(c.item_id))));
  const [extras, setExtras] = useState<FindingDraft[]>(() => (checklist.length ? [] : [blank(null)]));
  const [summary, setSummary] = useState('');
  const [condition, setCondition] = useState('');
  const w = useWriter();
  const { says, doesNotSay } = termsOf(action);
  const send = async () => {
    const built = findingsArgs(action, checklist.map(c => str(c.item_id)!), summary, [...items, ...extras], condition);
    if (!built.ok) { w.setFailure(built.error); return; }
    await w.run('record_inspection_findings', built.args);
  };
  const setItem = (i: number, p: Partial<FindingDraft>) => setItems(xs => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const setExtra = (i: number, p: Partial<FindingDraft>) => setExtras(xs => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return <SignSheet title="Record inspection findings" says={says} doesNotSay={doesNotSay} confirmLabel="Record findings" onConfirm={send}
    onClose={w.done ? () => { onDone(); onClose(); } : onClose} busy={w.busy} failure={w.failure}
    done={w.done && <Text role="body" className="jb-done">Findings recorded. They are now the basis for the job's plan.</Text>}>
    {!w.done && <>
      <label className="jb-field"><Text role="label">Summary (one line)</Text>
        <input className="jb-input k-body" aria-label="Summary" maxLength={500} value={summary} onChange={e => setSummary(e.target.value)} /></label>
      {checklist.map((c, i) => <div className="jb-line" key={str(c.item_id)!} role="group" aria-label={`Checklist item ${i + 1}`}>
        <Text role="body">{str(c.question) ?? str(c.system) ?? `Item ${i + 1}`}</Text>
        <label className="jb-field"><Text role="label">Verdict</Text>
          <select className="jb-input k-body" aria-label={`Item ${i + 1} verdict`} value={items[i]?.verdict ?? ''} onChange={e => setItem(i, { verdict: e.target.value || null })}>
            <option value="">Not answered</option>{VERDICTS.map(v => <option key={v.key} value={v.key}>{v.title}</option>)}</select></label>
        {items[i]?.verdict && <FindingFields label={`Item ${i + 1}`} d={items[i]} onChange={p => setItem(i, p)} />}
      </div>)}
      {extras.map((d, i) => <div className="jb-line" key={`x${i}`} role="group" aria-label={`Other finding ${i + 1}`}>
        <Text role="label">Other finding</Text>
        <FindingFields label={`Other finding ${i + 1}`} d={d} onChange={p => setExtra(i, p)} />
      </div>)}
      <div><button type="button" className="btn-base btn-xs btn-secondary" onClick={() => setExtras(xs => [...xs, blank(null)])}><Text role="label">Add another finding</Text></button></div>
      <label className="jb-field"><Text role="label">Overall condition (optional)</Text>
        <select className="jb-input k-body" aria-label="Overall condition" value={condition} onChange={e => setCondition(e.target.value)}>
          <option value="">Not stated</option>{CONDITIONS.map(c => <option key={c.key} value={c.key}>{c.title}</option>)}</select></label>
      <Text role="caption">The report is open data; personal names in free text are withheld from visitors.</Text>
    </>}
  </SignSheet>;
}

/** grant_inspection_access for the verified owner, offered once an inspector is accepted and no permission is current. */
export function GrantAccessSheet({ action, onClose, onDone }: { action: JobAction; onClose: () => void; onDone: () => void }) {
  const [scope, setScope] = useState('');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const w = useWriter();
  const { says, doesNotSay } = termsOf(action);
  const send = async () => {
    const built = grantArgs(action, scope, from, until);
    if (!built.ok) { w.setFailure(built.error); return; }
    await w.run('grant_inspection_access', built.args);
  };
  const state = str(action.raw.permission_state);
  return <SignSheet title="Let an inspector see your car" says={says} doesNotSay={doesNotSay} confirmLabel="Grant access" onConfirm={send}
    onClose={w.done ? () => { onDone(); onClose(); } : onClose} busy={w.busy} failure={w.failure}
    done={w.done && <Text role="body" className="jb-done">Access granted to the accepted inspector, within the scope you wrote.</Text>}>
    {state === 'expired' && <Text role="body">Your earlier permission has expired.</Text>}
    {!w.done && <>
      <label className="jb-field"><Text role="label">What the inspector may do</Text>
        <textarea className="jb-input k-body" aria-label="Scope" maxLength={2000} value={scope} onChange={e => setScope(e.target.value)} /></label>
      <div className="jb-field--row">
        <label className="jb-field"><Text role="label">From (optional)</Text><input type="datetime-local" className="jb-input k-body" aria-label="From" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="jb-field"><Text role="label">Until (optional)</Text><input type="datetime-local" className="jb-input k-body" aria-label="Until" value={until} onChange={e => setUntil(e.target.value)} /></label>
      </div>
    </>}
  </SignSheet>;
}

/** attach_job_evidence: the viewer's own eligible photos of this job's vehicle, listed by job_evidence_candidates_read. */
export function AttachEvidenceSheet({ action, operations, onClose, onDone }: { action: JobAction; operations: JsonObject | null; onClose: () => void; onDone: () => void }) {
  const wo = str(action.args.p_work_order_id);
  const [candidates, setCandidates] = useState<Load>({ status: 'loading' });
  const [picked, setPicked] = useState<string[]>([]);
  const [operationId, setOperationId] = useState('');
  const [note, setNote] = useState('');
  const w = useWriter();
  useEffect(() => {
    let cancelled = false;
    readJob('job_evidence_candidates_read', { p_work_order_id: wo, p_after: null, p_limit: 200 }).then(l => { if (!cancelled) setCandidates(l); });
    return () => { cancelled = true; };
  }, [wo]);
  const data = candidates.status === 'loaded' ? candidates.data : null;
  const sign = obj(data?.sign);
  const terms = termsOf({ ...action, binds: action.binds.length ? action.binds : arr(sign?.binds).filter((x): x is string => typeof x === 'string'),
    doesNotBind: action.doesNotBind.length ? action.doesNotBind : arr(sign?.does_not_bind).filter((x): x is string => typeof x === 'string') });
  const items = useMemo(() => arr(data?.items).map(obj).filter((o): o is JsonObject => !!o && str(o.work_order_id) === wo && !!str(o.image_id)), [data, wo]);
  const ops = arr(operations?.operations).map(obj).filter((o): o is JsonObject => !!o && !!str(o.id));
  const send = async () => {
    const built = evidenceArgs(action, data, picked, operationId || null, note);
    if (!built.ok) { w.setFailure(built.error); return; }
    await w.run('attach_job_evidence', built.args);
  };
  const excluded = notAttachableText(data);
  return <SignSheet title="Attach photos to this job" says={terms.says} doesNotSay={terms.doesNotSay} confirmLabel="Attach photos" onConfirm={send}
    onClose={w.done ? () => { onDone(); onClose(); } : onClose} busy={w.busy} failure={w.failure}
    done={w.done && <Text role="body" className="jb-done">Photos attached to this job. Who can see them is unchanged.</Text>}>
    {!w.done && <>
      {candidates.status === 'loading' && <Text role="caption">Loading your photos from this job's window…</Text>}
      {candidates.status === 'failed' && <Text role="body" className="jb-warn">{candidates.reason}</Text>}
      {data && items.length === 0 && <Text role="body">None of your photos from this job's window can be attached.</Text>}
      {items.length > 0 && <div className="jb-field" role="group" aria-label="Your photos">
        <Text role="label">{`Your photos from this job's window (${items.length})`}</Text>
        <div className="job-images">{items.map(i => {
          const id = str(i.image_id)!;
          const on = picked.includes(id);
          return <label key={id} className="jb-choice"><span>
            <input type="checkbox" aria-label={`Photo ${day(str(i.captured_at)) ?? ''}`} checked={on} onChange={e => setPicked(xs => (e.target.checked ? [...xs, id] : xs.filter(x => x !== id)))} />{' '}
            {str(i.image_url) && <img className="job-images__img" src={str(i.image_url)!} width={160} height={120} loading="lazy" alt={`Your photo, ${day(str(i.captured_at)) ?? 'date unknown'}`} />}
          </span></label>;
        })}</div>
      </div>}
      {excluded && <Text role="caption">{excluded}</Text>}
      {ops.length > 0 && <label className="jb-field"><Text role="label">Operation (optional)</Text>
        <select className="jb-input k-body" aria-label="Operation" value={operationId} onChange={e => setOperationId(e.target.value)}>
          <option value="">The job as a whole</option>{ops.map(o => <option key={str(o.id)!} value={str(o.id)!}>{str(o.description) ?? sentence(str(o.task_type) ?? 'operation')}</option>)}</select></label>}
      <label className="jb-field"><Text role="label">Note (shown only to the people on this job)</Text>
        <input className="jb-input k-body" aria-label="Note" maxLength={1000} value={note} onChange={e => setNote(e.target.value)} /></label>
    </>}
  </SignSheet>;
}
