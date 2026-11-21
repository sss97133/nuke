/**
 * What a two-finger click on a garage card opens: the car's agent, its log book,
 * adding files, merging a duplicate and saying a car is not yours. Every write goes
 * through a writer that already exists (vehicle-agent, record_vehicle_statement, the
 * upload queue, merge_duplicate_vehicles, disclaim_vehicle_tie) and happens only on
 * an explicit press.
 *
 * The agent only proposes: a proposal shows under its reply with Confirm / Dismiss,
 * and only Confirm sends it back to vehicle-agent, which re-checks it and writes.
 * Its sessions are kept in the car's log book only while "Keep in log book" is on
 * for that car (set_vehicle_agent_log_consent; read back with vehicle_agent_log).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from '../PrefetchLink';
import { Button } from '../ui/button';
import { supabase } from '../../lib/supabase';
import { uploadQueue } from '../../services/globalUploadQueue';
import type { GarageVehicle } from '../../hooks/useVehiclesDashboard';

export const vehicleName = (vehicle: GarageVehicle) =>
  [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'this vehicle';

/** Photos and papers dropped or picked for one car go to the shared upload queue. */
export function addFilesToVehicle(vehicle: GarageVehicle, files: File[]) {
  if (files.length) uploadQueue.addFiles(vehicle.id, vehicleName(vehicle), files);
}

export type GarageSheet = { kind: 'agent' | 'log'; vehicle: GarageVehicle };

// ---------------------------------------------------------------------------
// The menu
// ---------------------------------------------------------------------------

export function GarageCardMenu({ vehicle, x, y, onClose, onSheet, onMerge, onDisclaim }: {
  vehicle: GarageVehicle; x: number; y: number; onClose: () => void;
  onSheet: (sheet: GarageSheet) => void; onMerge: (vehicle: GarageVehicle) => void;
  onDisclaim?: (vehicle: GarageVehicle) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const away = (event: Event) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    ref.current?.querySelector('button')?.focus();
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);
  const pick = (action: () => void) => () => { action(); onClose(); };
  // x and y are measured inside the card; the bubble opens on the card at the click.
  const left = Math.max(4, x);
  const top = Math.max(4, y);
  return <div ref={ref} className="garage-menu" role="menu" aria-label={`Actions for ${vehicleName(vehicle)}`} style={{ left, top }}>
    <p className="garage-menu-title">{vehicleName(vehicle)}</p>
    <button type="button" role="menuitem" onClick={pick(() => onSheet({ kind: 'agent', vehicle }))}>Ask this car's agent</button>
    <button type="button" role="menuitem" onClick={pick(() => onSheet({ kind: 'log', vehicle }))}>Log book: add a note</button>
    <button type="button" role="menuitem" onClick={() => picker.current?.click()}>Add photos or papers…</button>
    <button type="button" role="menuitem" onClick={pick(() => onMerge(vehicle))}>Merge a duplicate into this car…</button>
    {onDisclaim && <button type="button" role="menuitem" onClick={pick(() => onDisclaim(vehicle))}>Not my vehicle…</button>}
    {vehicle.vin && <button type="button" role="menuitem" onClick={() => {
      void navigator.clipboard?.writeText(vehicle.vin!); setCopied(true); setTimeout(onClose, 600);
    }}>{copied ? 'VIN copied' : 'Copy VIN'}</button>}
    <Link role="menuitem" to={`/vehicle/${vehicle.id}`} onClick={onClose}>Open the profile</Link>
    <input ref={picker} type="file" multiple hidden accept="image/*,application/pdf"
      onChange={event => { addFilesToVehicle(vehicle, [...(event.target.files ?? [])]); onClose(); }} />
  </div>;
}

// ---------------------------------------------------------------------------
// The side sheet: the car's agent, or its log book
// ---------------------------------------------------------------------------

interface Statement { statement_id: string | null; speaker_role: string; statement_kind: string; said_on: string | null; recorded_at: string; words: string | null }

/** The role a note is said as, by default: what the garage reader says the account is to this car. */
export const defaultSpeakerRole = (vehicle: GarageVehicle) =>
  ['OWNER', 'VERIFIED OWNER', 'CO-OWNER'].includes(vehicle.relationship_type) ? 'owner'
    : vehicle.relationship_type === 'PREVIOUSLY OWNED' ? 'previous_owner' : 'representative';

const ROLES = [['owner', 'Owner'], ['representative', 'Representative'], ['shop', 'Shop'], ['previous_owner', 'Previous owner'], ['seller_agent', "Seller's agent"]] as const;
const KINDS = [['assertion', 'A fact'], ['recollection', 'From memory'], ['estimate', 'An estimate']] as const;

function LogBook({ vehicle }: { vehicle: GarageVehicle }) {
  const [rows, setRows] = useState<Statement[] | null>(null);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [text, setText] = useState('');
  const [role, setRole] = useState<string>(defaultSpeakerRole(vehicle));
  const [kind, setKind] = useState<string>('assertion');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // One key per draft, so a retry of the same note never stores it twice.
  const requestId = useRef(crypto.randomUUID());

  const read = useCallback(async () => {
    const { data, error } = await supabase.rpc('vehicle_statements', { p_vehicle_id: vehicle.id });
    if (error) { setNotice('The log book could not be read.'); setRows([]); return; }
    setRows(((data as any)?.statements ?? []) as Statement[]);
    // The account's own kept agent sessions for this car; none, or the reader missing, shows nothing.
    const { data: log } = await supabase.rpc('vehicle_agent_log', { p_vehicle_id: vehicle.id });
    setSessions(((log as any)?.sessions ?? []) as AgentSession[]);
  }, [vehicle.id]);
  useEffect(() => { void read(); }, [read]);

  const save = async () => {
    if (!text.trim() || busy) return;
    setBusy(true); setNotice(null);
    const { error } = await supabase.rpc('record_vehicle_statement', {
      p_request_id: requestId.current, p_vehicle_id: vehicle.id, p_statement: text.trim(),
      p_speaker_role: role, p_statement_kind: kind,
      p_said_at_basis: 'typed into the garage log book at the recorded time', p_recording_agent: 'garage log book',
      p_said_at: new Date().toISOString(),
    });
    setBusy(false);
    if (error) { setNotice(error.message); return; }
    requestId.current = crypto.randomUUID();
    setText(''); setNotice('Saved to this car’s log book.'); void read();
  };

  return <div className="garage-log">
    <p className="garage-sheet-note">Your own words about this car, kept whole with the date. A note is your claim: it never outranks a document or a photo, and only people tied to the car read it.</p>
    <label>Note<textarea value={text} onChange={event => setText(event.target.value)} rows={4} placeholder="What happened, what you know, what needs fixing" /></label>
    <div className="garage-log-fields">
      <label>Said as<select value={role} onChange={event => setRole(event.target.value)}>{ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>It is<select value={kind} onChange={event => setKind(event.target.value)}>{KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <Button type="button" disabled={busy || !text.trim()} onClick={save}>{busy ? 'Saving…' : 'Save note'}</Button>
    </div>
    {notice && <p role="status" className="garage-sheet-note">{notice}</p>}
    {rows === null ? <p className="garage-sheet-note">Reading the log book…</p>
      : rows.length > 0 && <ol className="garage-log-rows">{rows.map((row, index) => <li key={row.statement_id ?? index}>
        <span>{row.said_on ?? row.recorded_at.slice(0, 10)} · {row.speaker_role.replaceAll('_', ' ')} · {row.statement_kind}</span>
        {row.words && <p>{row.words}</p>}
      </li>)}</ol>}
    {sessions.length > 0 && <ol className="garage-log-rows" aria-label="Your agent sessions">{sessions.map(session => <li key={session.conversation_ref}>
      <span>{session.started_at.slice(0, 10)} · agent session · yours only</span>
      {session.turns.map((turn, index) => <p key={index} data-role={turn.role}>{turn.role === 'user' ? 'You: ' : 'Agent: '}{turn.words}</p>)}
    </li>)}</ol>}
  </div>;
}

interface AgentSession { conversation_ref: string; started_at: string; turns: Array<{ role: 'user' | 'assistant'; words: string; at: string }> }

export interface Proposal { id: string; writer: string; summary: string; token: string }
type ProposalState = { status: 'open' | 'busy' | 'kept' | 'dismissed'; note?: string };
interface Turn { role: 'user' | 'assistant'; content: string; proposals?: Proposal[] }

/** The message a failed function call carries in its body, else its own message. */
async function failure(failed: any, fallback: string): Promise<string> {
  const body = await failed?.context?.json?.().catch(() => null);
  return body?.error ?? failed?.message ?? fallback;
}

/** One proposal under a reply: what it would record, Confirm and Dismiss. Nothing is written before Confirm. */
export function ProposalRow({ proposal, state, onConfirm, onDismiss }: {
  proposal: Proposal; state: ProposalState; onConfirm: () => void; onDismiss: () => void;
}) {
  if (state.status === 'dismissed') return null;
  return <div className="garage-agent-proposal" data-status={state.status}>
    <span>{proposal.summary}</span>
    {state.status === 'kept'
      ? <small role="status">{state.note ?? 'Kept.'}</small>
      : <span className="garage-agent-proposal-actions">
        <button type="button" disabled={state.status === 'busy'} onClick={onConfirm}>{state.status === 'busy' ? 'Keeping…' : 'Confirm'}</button>
        <button type="button" disabled={state.status === 'busy'} onClick={onDismiss}>Dismiss</button>
      </span>}
    {state.status !== 'kept' && state.note && <small role="alert">{state.note}</small>}
  </div>;
}

/** Whether this account keeps this car's agent sessions (its own consent row; row security limits it to the account). */
function useKeepSessions(vehicleId: string) {
  const [keep, setKeep] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void supabase.from('user_consents').select('id').eq('consent_scope', 'vehicle_agent_log').eq('vehicle_id', vehicleId)
      .eq('granted', true).is('revoked_at', null).limit(1)
      .then(({ data, error }) => { if (live) setKeep(error ? null : (data?.length ?? 0) > 0); });
    return () => { live = false; };
  }, [vehicleId]);
  const toggle = async () => {
    if (keep === null) return;
    const next = !keep;
    const { data, error } = await supabase.rpc('set_vehicle_agent_log_consent', { p_vehicle_id: vehicleId, p_keep: next });
    if (!error) setKeep((data as any)?.keep === true);
  };
  return { keep, toggle };
}

/** The car's agent: a text box. The exchange appears above it once there is one. */
function AgentBox({ vehicle }: { vehicle: GarageVehicle }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, ProposalState>>({});
  // One id per opened box: the turns of this session share it in the log book.
  const conversationRef = useRef(crypto.randomUUID());
  const { keep, toggle } = useKeepSessions(vehicle.id);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'nearest' }); }, [turns, busy]);
  const send = async () => {
    const message = input.trim();
    if (!message || busy) return;
    setBusy(true); setError(null); setInput('');
    const history = turns.map(({ role, content }) => ({ role, content }));
    setTurns(current => [...current, { role: 'user', content: message }]);
    try {
      const { data, error: failed } = await supabase.functions.invoke('vehicle-agent', {
        body: { vehicle_id: vehicle.id, message, history, allow_writes: true, propose: true, conversation_ref: conversationRef.current },
      });
      if (failed) setError(await failure(failed, 'The agent did not answer.'));
      else setTurns(current => [...current, { role: 'assistant', content: data?.reply || 'No answer.', proposals: data?.proposals ?? [] }]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The agent did not answer.');
    } finally { setBusy(false); }
  };
  const setState = (id: string, state: ProposalState) => setStates(current => ({ ...current, [id]: state }));
  const confirm = async (proposal: Proposal) => {
    if (states[proposal.id]?.status === 'busy' || states[proposal.id]?.status === 'kept') return;
    setState(proposal.id, { status: 'busy' });
    try {
      const { error: failed } = await supabase.functions.invoke('vehicle-agent', {
        // No role is sent: the server says it as the owner only when the car's record names this account as owner.
        body: { vehicle_id: vehicle.id, confirm: proposal.token, conversation_ref: conversationRef.current },
      });
      if (failed) setState(proposal.id, { status: 'open', note: await failure(failed, 'Not kept.') });
      else setState(proposal.id, { status: 'kept', note: proposal.writer === 'record_vehicle_statement' ? 'Kept in the log book.' : 'Recorded.' });
    } catch (caught) {
      setState(proposal.id, { status: 'open', note: caught instanceof Error ? caught.message : 'Not kept.' });
    }
  };
  return <>
    {(turns.length > 0 || busy || error) && <div className="garage-agent-turns">
      {turns.map((turn, index) => <React.Fragment key={index}>
        <p data-role={turn.role}>{turn.content}</p>
        {turn.proposals?.map(proposal => <ProposalRow key={proposal.id} proposal={proposal}
          state={states[proposal.id] ?? { status: 'open' }}
          onConfirm={() => void confirm(proposal)} onDismiss={() => setState(proposal.id, { status: 'dismissed' })} />)}
      </React.Fragment>)}
      {busy && <p data-role="assistant">…</p>}
      {error && <p role="alert">{error}</p>}
      <div ref={end} />
    </div>}
    <textarea className="garage-agent-input" rows={1} autoFocus value={input} placeholder={`Ask about ${vehicleName(vehicle)}`}
      aria-label={`Ask the agent about ${vehicleName(vehicle)}`}
      onChange={event => setInput(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} />
    {keep !== null && <button type="button" role="switch" aria-checked={keep} className="garage-agent-keep" onClick={() => void toggle()}
      title="Keep this car's agent sessions in its log book. Only you read them.">Keep in log book</button>}
  </>;
}

export function GarageSheetPanel({ sheet, onClose }: { sheet: GarageSheet; onClose: () => void }) {
  const { vehicle, kind } = sheet;
  return <aside className="garage-sheet" data-kind={kind} onKeyDown={event => { if (event.key === 'Escape') onClose(); }}
    role="dialog" aria-label={`${kind === 'agent' ? 'Agent' : 'Log book'} for ${vehicleName(vehicle)}`}>
    <button type="button" className="garage-sheet-close" aria-label="Close" onClick={onClose}>×</button>
    {kind === 'agent' ? <AgentBox vehicle={vehicle} /> : <LogBook vehicle={vehicle} />}
  </aside>;
}

// ---------------------------------------------------------------------------
// Merging a duplicate: pick the keeper from the menu, press the duplicate, confirm
// ---------------------------------------------------------------------------

export function GarageMergeBar({ keeper, duplicate, viewerId, onCancel, onDone }: {
  keeper: GarageVehicle; duplicate: GarageVehicle | null; viewerId: string | null;
  onCancel: () => void; onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const merge = async () => {
    if (!duplicate || !viewerId || busy) return;
    setBusy(true); setError(null);
    const { error: failed } = await supabase.rpc('merge_duplicate_vehicles', {
      p_primary_id: keeper.id, p_duplicate_id: duplicate.id, p_user_id: viewerId,
    });
    setBusy(false);
    if (failed) { setError(failed.message); return; }
    onDone();
  };
  return <div className="garage-merge" role="region" aria-label="Merge a duplicate">
    <p>{duplicate
      ? <>Merge <strong>{vehicleName(duplicate)}</strong>{duplicate.vin ? ` (${duplicate.vin})` : ''} into <strong>{vehicleName(keeper)}</strong>{keeper.vin ? ` (${keeper.vin})` : ''}? Its photos, events and papers move to the car you keep.</>
      : <>Press the card that duplicates <strong>{vehicleName(keeper)}</strong>.</>}</p>
    {error && <p role="alert">{error}</p>}
    <div>
      {duplicate && <Button type="button" disabled={busy} onClick={merge}>{busy ? 'Merging…' : 'Merge'}</Button>}
      <Button variant="secondary" type="button" disabled={busy} onClick={onCancel}>Cancel</Button>
    </div>
  </div>;
}

// ---------------------------------------------------------------------------
// Not my vehicle: preview what an import tied to this account, confirm, then end it (restorable)
// ---------------------------------------------------------------------------

interface TieItem { table: string; row_id: string | null; kind?: string; route?: string; why?: string; count?: number }
interface Evidence { kind: string; count?: number }
export interface DisclaimResult {
  status: 'dry_run' | 'disclaimed' | 'refused' | 'nothing_to_end'; reason?: string; run_id?: string;
  would_end?: TieItem[]; ended?: TieItem[]; left?: TieItem[]; blocked_by?: Evidence[]; still_in_garage_by?: TieItem[];
}

const TIE_WORDS: Record<string, string> = {
  contributor: 'a contributor credit an automatic job wrote', permission: 'a permission no one granted',
  discovered: 'a discovery the system made', 'record:user_id': 'this account as the record’s creator',
  'record:owner_id': 'this account as the record’s owner', 'record:user_id+owner_id': 'this account as the record’s creator and owner',
};
/** One ended or planned tie in words. */
export const tieWords = (tie: TieItem) =>
  TIE_WORDS[tie.kind ?? ''] ?? TIE_WORDS[(tie.kind ?? '').split(':')[0]] ?? (tie.kind ?? tie.table).replaceAll('_', ' ');
const EVIDENCE_WORDS: Record<string, string> = {
  ownership_verification: 'an approved ownership verification', title_document_submitted: 'a title you submitted',
  ownership_period: 'an ownership period on record', owner_statement: 'your own statement as owner',
  owner_correction: 'your garage correction naming a role', ownership_paper: 'ownership paper on file',
  title_document: 'a title or registration you uploaded', work_order: 'a work order in your name',
};
/** One piece of first-hand evidence in words. */
export const evidenceWords = (item: Evidence) => item.kind === 'own_photos'
  ? `${item.count ?? 'some'} of your own photos` : EVIDENCE_WORDS[item.kind] ?? item.kind.replaceAll('_', ' ');
/** A tie the writer leaves because a person stated it, in words. */
const leftWords = (tie: TieItem) => {
  const [what, role] = (tie.kind ?? tie.table).split(':');
  return `${what.replaceAll('_', ' ')}${role ? ` as ${role.replaceAll('_', ' ')}` : ''}${tie.why ? ` (${tie.why})` : ''}`;
};
const ROUTE_WORDS: Record<string, string> = {
  owner_permission: 'an owner permission', previously_owned_permission: 'a previously-owned permission',
  consigned_permission: 'a consignment', ownership_verification: 'an ownership verification',
  ownership_period: 'an ownership period', discovered_previously_owned: 'your previously-owned list',
  recent_photos: 'photos you added in the last 60 days', recent_work_sessions: 'work sessions in the last 60 days',
  contributor: 'a contributor role', profile_record: 'the record naming this account', owner_correction: 'your garage correction',
};
const routeWords = (tie: TieItem) => ROUTE_WORDS[tie.route ?? ''] ?? (tie.route ?? tie.table).replaceAll('_', ' ');
const list = (items: string[]) => [...new Set(items)].join('; ');

const DISCLAIM_REASON = 'Not my vehicle (garage card menu)';

export function GarageDisclaimBar({ vehicle, viewerId, onCancel, onRemoved, onRestored }: {
  vehicle: GarageVehicle; viewerId: string | null; onCancel: () => void;
  onRemoved: (vehicleId: string) => void; onRestored: (vehicleId: string) => void;
}) {
  const [plan, setPlan] = useState<DisclaimResult | null>(null);
  const [done, setDone] = useState<DisclaimResult | null>(null);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const call = useCallback((extra: Record<string, unknown>) => supabase.rpc('disclaim_vehicle_tie', {
    p_vehicle_id: vehicle.id, p_reason: DISCLAIM_REASON, p_actor: viewerId, ...extra,
  }), [vehicle.id, viewerId]);
  // The preview writes nothing: the writer's dry run says what would end and what blocks it.
  useEffect(() => {
    if (!viewerId) return;
    let live = true;
    void call({ p_dry_run: true }).then(({ data, error: failed }) => {
      if (!live) return;
      if (failed) setError(failed.message); else setPlan(data as DisclaimResult);
    });
    return () => { live = false; };
  }, [call, viewerId]);

  const confirm = async () => {
    if (busy || !viewerId) return;
    setBusy(true); setError(null);
    const { data, error: failed } = await call(blocked && why.trim() ? { p_force_reason: why.trim() } : {});
    setBusy(false);
    if (failed) { setError(failed.message); return; }
    const result = data as DisclaimResult;
    if (result.status !== 'disclaimed') { setPlan(result); setError(result.status === 'refused' ? 'Nothing was removed.' : null); return; }
    setDone(result);
    if (!result.still_in_garage_by?.length) onRemoved(vehicle.id);
  };
  const undo = async () => {
    if (busy || !done?.run_id || !viewerId) return;
    setBusy(true); setError(null);
    const { error: failed } = await supabase.rpc('restore_vehicle_tie', { p_journal_id: null, p_run_id: done.run_id, p_actor: viewerId });
    setBusy(false);
    if (failed) { setError(failed.message); return; }
    setRestored(true); onRestored(vehicle.id);
  };

  const name = <strong>{vehicleName(vehicle)}</strong>;
  const blocked = (plan?.blocked_by?.length ?? 0) > 0;
  const ending = plan?.would_end ?? [];
  let body: React.ReactNode;
  if (restored) body = <>{name} is back in your garage.</>;
  else if (done) body = <>{done.still_in_garage_by?.length
    ? <>Ended {list((done.ended ?? []).map(tieWords))}. {name} stays in your garage through {list(done.still_in_garage_by.map(routeWords))}.</>
    : <>{name} is out of your garage. Its record, photos and evidence are unchanged.</>}</>;
  else if (!plan) body = error ? <>The plan for {name} could not be read.</> : <>Reading what ties {name} to you…</>;
  else if (!ending.length) body = <>Nothing an import made ties {name} to you.{plan.left?.length ? <> It is tied by what you or another person stated: {list(plan.left.map(leftWords))}.</> : null}</>;
  else body = <>Take {name} out of your garage? This ends {list(ending.map(tieWords))}. The car’s record, photos and evidence stay as they are, and you can restore the ties afterwards.
    {blocked && <> Your own evidence ties you to it: {list(plan.blocked_by!.map(evidenceWords))}.</>}
    {plan.still_in_garage_by?.length ? <> It would stay in your garage through {list(plan.still_in_garage_by.map(routeWords))}.</> : null}</>;

  return <div className="garage-merge" role="region" aria-label="Not my vehicle">
    <p>{body}</p>
    {!done && blocked && ending.length > 0 && <div className="garage-log"><label>Why it is not yours<textarea rows={2} value={why}
      onChange={event => setWhy(event.target.value)} placeholder="Say why, to remove it despite that evidence" /></label></div>}
    {error && <p role="alert">{error}</p>}
    <div>
      {!done && ending.length > 0 && <Button type="button" disabled={busy || (blocked && !why.trim())} onClick={confirm}>
        {busy ? 'Removing…' : blocked ? 'Remove anyway' : 'Not my vehicle'}</Button>}
      {done?.run_id && !restored && <Button variant="secondary" type="button" disabled={busy} onClick={undo}>{busy ? 'Restoring…' : 'Undo'}</Button>}
      <Button variant="secondary" type="button" disabled={busy} onClick={onCancel}>{done ? 'Close' : 'Cancel'}</Button>
    </div>
  </div>;
}
