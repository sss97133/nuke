/**
 * What a two-finger click on a garage card opens: the car's agent, its log book,
 * adding files and merging a duplicate. Every write goes through a writer that
 * already exists (vehicle-agent, record_vehicle_statement, the upload queue,
 * merge_duplicate_vehicles) and happens only on an explicit press.
 */
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from '../PrefetchLink';
import { Button } from '../ui/button';
import { supabase } from '../../lib/supabase';
import { uploadQueue } from '../../services/globalUploadQueue';
import type { GarageVehicle } from '../../hooks/useVehiclesDashboard';

const VehicleAgentChat = React.lazy(() => import('../../pages/vehicle-profile/VehicleAgentChat'));

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

export function GarageCardMenu({ vehicle, x, y, onClose, onSheet, onMerge }: {
  vehicle: GarageVehicle; x: number; y: number; onClose: () => void;
  onSheet: (sheet: GarageSheet) => void; onMerge: (vehicle: GarageVehicle) => void;
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

const ROLES = [['owner', 'Owner'], ['representative', 'Representative'], ['shop', 'Shop'], ['previous_owner', 'Previous owner'], ['seller_agent', "Seller's agent"]] as const;
const KINDS = [['assertion', 'A fact'], ['recollection', 'From memory'], ['estimate', 'An estimate']] as const;

function LogBook({ vehicle }: { vehicle: GarageVehicle }) {
  const [rows, setRows] = useState<Statement[] | null>(null);
  const [text, setText] = useState('');
  const [role, setRole] = useState<string>(['OWNER', 'VERIFIED OWNER', 'CO-OWNER'].includes(vehicle.relationship_type) ? 'owner'
    : vehicle.relationship_type === 'PREVIOUSLY OWNED' ? 'previous_owner' : 'representative');
  const [kind, setKind] = useState<string>('assertion');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // One key per draft, so a retry of the same note never stores it twice.
  const requestId = useRef(crypto.randomUUID());

  const read = useCallback(async () => {
    const { data, error } = await supabase.rpc('vehicle_statements', { p_vehicle_id: vehicle.id });
    if (error) { setNotice('The log book could not be read.'); setRows([]); return; }
    setRows(((data as any)?.statements ?? []) as Statement[]);
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
  </div>;
}

export function GarageSheetPanel({ sheet, onClose }: { sheet: GarageSheet; onClose: () => void }) {
  const { vehicle, kind } = sheet;
  return <aside className="garage-sheet" onKeyDown={event => { if (event.key === 'Escape') onClose(); }} role="dialog" aria-label={`${kind === 'agent' ? 'Agent' : 'Log book'} for ${vehicleName(vehicle)}`}>
    <header>
      <div><h2>{kind === 'agent' ? 'Agent' : 'Log book'}</h2><p>{vehicleName(vehicle)}{vehicle.vin ? ` · ${vehicle.vin}` : ''}</p></div>
      <Button variant="secondary" type="button" onClick={onClose}>Close</Button>
    </header>
    {kind === 'agent'
      ? <Suspense fallback={<p className="garage-sheet-note">Opening the agent…</p>}><VehicleAgentChat vehicleId={vehicle.id} defaultCollapsed={false} /></Suspense>
      : <LogBook vehicle={vehicle} />}
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
