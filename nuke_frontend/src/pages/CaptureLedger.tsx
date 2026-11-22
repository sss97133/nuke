// The capture ledger: the signed-in owner's photos by day, from the phone's gate to the vehicle each one landed on.
// One read (get_capture_ledger) draws the days; opening a day reads it once (get_capture_ledger_day). The words and
// the row shape are the capture app's ingest bar (CaptureIngestBar.swift, CaptureIngestStatus.swift), so a photo reads
// the same on the phone and here. "Re-scan my library" writes a request the phone claims the next time it runs.
// A held set (photos taken together that the matcher could not place) asks "Which vehicle?" in the words of the app's
// vehicle picker (SessionConfirmView.swift), first in its day. Picking a car writes nothing; only the File tap on the
// confirm line files the photos left in (attribute_image_session), then the day and the totals are read again.
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { optimizeImageUrl } from '../lib/imageOptimizer';
import { getVehiclePrimaryName } from '../utils/vehicleDisplayName';
import { Text, plural } from '../kit';
import './capture-ledger.css';

type State = 'on_vehicle' | 'unverified' | 'duplicate' | 'waiting' | 'held' | 'pulled' | 'private' | 'unsorted' | 'failed' | 'no_file' | 'non_vehicle' | 'junk';
type DayRow = { day: string; taken: number; on_vehicle: number; unverified: number; waiting: number; held: number; pulled: number;
  private: number; unsorted: number; failed: number; duplicate?: number; skipped: number;
  // optional until the reader sends them; a missing key is 0
  no_file?: number; non_vehicle?: number; junk?: number; vehicles: { vehicle_id: string; name: string; n: number }[];
  held_reasons: Record<string, number>; skip_reasons: Record<string, number> };
type Rescan = { id: string; requested_at: string; acked_at: string | null; device: string | null; finished_at: string | null; result: Record<string, unknown> | null };
type Ledger = { generated_at: string; tz: string; days: DayRow[]; days_total: number; totals: Omit<DayRow, 'day' | 'vehicles' | 'held_reasons' | 'skip_reasons'>;
  rescan: Rescan | null; last_rescan: Rescan | null };
type Frame = { image_id: string; taken_at: string; state: State; reason: string | null; vehicle_id: string | null; vehicle: string | null;
  source: string | null; file_name: string | null; thumb: string | null; set_key: string | null; candidates: { vehicle_id: string; name: string | null; score: number | null }[] | null };
type Skip = { asset_id: string; reason: string; taken_at: string | null; decided_at: string; device: string | null };
type Day = { day: string; frames: Frame[]; skipped: Skip[] };
// His vehicles, read the way the phone's picker reads them (AttributionEngine.swift loadConfirmData): the vehicles he
// created or owns, unresolved records left out, last updated first. Unlike the phone, records that were removed or
// merged into another are left out too: the filing writer would take photos onto them. These five columns only:
// vehicles grants SELECT column by column, and one column more fails the whole read.
type OwnCar = { id: string; year: number | null; make: string | null; model: string | null; primary_image_url: string | null };
// null: signed out, so nothing can be filed from here
type Garage = OwnCar[] | 'loading' | 'error' | null;
// undefined: the tap was ignored (this set is already being filed); null: filed; a string: the error to show.
type FileSet = (key: string, ids: string[], vehicleId: string, label: string) => Promise<string | null | undefined>;

const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles'; } catch { return 'America/Los_Angeles'; } })();
const WINDOW_DAYS = 365;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const shiftDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return isoDate(d); };
const n = (v: number) => v.toLocaleString('en-US');
const dayLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
const relative = (iso: string, now: number) => {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TZ });
};
const shortName = (f: Frame) => (f.file_name ? f.file_name.replace(/\.[^.]+$/, '') : 'Photo');

// The app's words (CaptureIngestStatus.swift failureReason / stageLabel), kept word for word where the state is the same.
const FAILURE: Record<string, string> = { timeout: 'it took too long', network: 'the connection dropped', rate_limited: "we're busy right now",
  too_large: 'the photo is too large', unreadable: 'the photo was hard to read', not_receipt: "it didn't look like a receipt",
  not_found: "the photo couldn't be found", auth: "we couldn't sign in to check it", server: 'our server had a hiccup' };
const HELD: Record<string, string> = { no_clear_lead: 'no clear match', score_below_threshold: 'not sure enough', score_below_2_5: 'not sure enough',
  multi_vin_segment: 'more than one VIN in the set', color_era_conflict: "color or era doesn't fit",
  priors_only: "only the day's pattern pointed to it, nothing in the photo" };
const SKIP: Record<string, string> = { no_location: 'no location on the photo', off_site: 'outside a work site', screenshot: 'a screenshot',
  not_library: 'not in the photo library', not_own_camera: "not from this phone's camera", personal: 'held as personal on the phone', gave_up: 'stopped retrying' };
const words = (table: Record<string, string>, key: string | null | undefined, fallback: string) =>
  key ? table[key] ?? table[key.replace(/\./g, '_')] ?? key.replace(/_/g, ' ') : fallback;
export function stageLabel(f: Frame): string {
  switch (f.state) {
    case 'on_vehicle': return `Added to ${f.vehicle ?? 'a vehicle'}`;
    case 'unverified': return `On ${f.vehicle ?? 'a vehicle'}, not yet checked`;
    case 'duplicate': return `Copy of a photo on ${f.vehicle ?? 'a vehicle'}`;
    case 'waiting': return 'Waiting on a check';
    case 'held': return `Held: ${words(HELD, f.reason, 'no clear match')}`;
    case 'pulled': return `Taken back off${f.vehicle ? ` ${f.vehicle}` : ''}`;
    case 'private': return 'Kept private';
    case 'failed': return `Didn't work: ${words(FAILURE, f.reason, 'something went wrong')}`;
    // the phone sent the time and a rough place only; a reason is named only when it is one the phone reports
    case 'no_file': return `Picture kept on the phone${f.reason && Object.hasOwn(SKIP, f.reason) ? `: ${SKIP[f.reason]}` : ''}`;
    case 'non_vehicle': return 'Not a vehicle photo';
    case 'junk': return 'Not a photo';
    default: return 'Not sorted yet';
  }
}
export function liveLine(f: Frame): string {
  const name = shortName(f);
  if (f.state === 'held' && f.candidates?.length) {
    // the names only: a matcher score means nothing to the owner
    const top = f.candidates.slice(0, 2).map(c => c.name ?? 'a vehicle').join(', ');
    return `${name} · closest: ${top}`;
  }
  if (f.state === 'waiting') return `${name} · a viewed sample decides the set`;
  if (f.state === 'unsorted') return `${name} · not scored yet`;
  if (f.state === 'no_file') return `${name} · ${timeLabel(f.taken_at)} · only the time and rough place were sent`;
  if (f.state === 'non_vehicle') return `${name} · ${timeLabel(f.taken_at)} · checked: no vehicle in it`;
  if (f.state === 'junk') return `${name} · ${timeLabel(f.taken_at)} · no stored picture`;
  return `${name} · ${timeLabel(f.taken_at)}${f.source ? ` · ${f.source.replace(/_/g, ' ')}` : ''}`;
}
// The three states nothing more happens to, in the same words in the summary and the day pills.
const settledParts = (t: Pick<DayRow, 'no_file' | 'non_vehicle' | 'junk'>) => [
  t.no_file ? `${n(t.no_file)} kept on the phone` : '',
  t.non_vehicle ? plural(t.non_vehicle, 'not a vehicle photo', 'not vehicle photos') : '',
  t.junk ? plural(t.junk, 'not a photo', 'not photos') : ''].filter(Boolean);
// "12 photos · 9 on 1973 Firebird · 2 held · 1 skipped on the phone · 1 failed", zero parts dropped except the first.
export function summaryLine(t: Ledger['totals'], vehicles: { name: string; n: number }[]): string {
  const parts = [plural(t.taken, 'photo')];
  const onVehicle = vehicles.slice(0, 2).map(v => `${n(v.n)} on ${v.name}`);
  const rest = t.on_vehicle + t.unverified - vehicles.slice(0, 2).reduce((s, v) => s + v.n, 0);
  parts.push(...onVehicle);
  if (rest > 0) parts.push(`${n(rest)} on other vehicles`);
  if (t.waiting) parts.push(`${n(t.waiting)} waiting on a check`);
  if (t.held) parts.push(`${n(t.held)} held`);
  if (t.unsorted) parts.push(`${n(t.unsorted)} not sorted yet`);
  if (t.duplicate) parts.push(`${plural(t.duplicate, 'copy', 'copies')} of filed photos`);
  if (t.pulled) parts.push(`${n(t.pulled)} taken back off`);
  if (t.private) parts.push(`${n(t.private)} kept private`);
  if (t.skipped) parts.push(`${n(t.skipped)} skipped on the phone`);
  parts.push(...settledParts(t));
  if (t.failed) parts.push(`${n(t.failed)} failed`);
  return parts.join(' · ');
}
const rescanLine = (l: Ledger, now: number): string => {
  if (l.rescan) return l.rescan.acked_at ? `Your phone picked it up ${relative(l.rescan.acked_at, now)}${l.rescan.device ? ` (${l.rescan.device})` : ''} and is scanning.`
    : `Asked ${relative(l.rescan.requested_at, now)} · it runs the next time the capture app opens on your phone.`;
  if (l.last_rescan?.finished_at) {
    const r = l.last_rescan.result ?? {};
    const bits = ['uploaded', 'skipped', 'failed'].filter(k => typeof r[k] === 'number').map(k => `${n(r[k] as number)} ${k}`);
    return `Last re-scan finished ${relative(l.last_rescan.finished_at, now)}${bits.length ? `: ${bits.join(', ')}` : ''}.`;
  }
  return 'Re-detects your work sites and re-confirms what uploads. Already-uploaded photos are not sent again.';
};
// A day's rows: the held frames of each set folded into one question, the questions first (they are the only rows
// waiting on his hand), then every other row in the reader's time order. The reader already orders frames by taken_at.
export type DayItem = { kind: 'frame'; f: Frame } | { kind: 'set'; key: string; frames: Frame[] };
export function dayItems(frames: Frame[]): DayItem[] {
  const sets = new Map<string, Frame[]>();
  const rows: DayItem[] = [];
  for (const f of frames) {
    if (f.state !== 'held' || !f.set_key) { rows.push({ kind: 'frame', f }); continue; }
    const set = sets.get(f.set_key);
    if (set) set.push(f); else sets.set(f.set_key, [f]);
  }
  return [...[...sets].map(([key, fs]): DayItem => ({ kind: 'set', key, frames: fs })), ...rows];
}
const carLabel = (c: Pick<OwnCar, 'year' | 'make' | 'model'>) =>
  getVehiclePrimaryName({ year: c.year ?? 0, make: c.make ?? '', model: c.model ?? undefined }) || 'Vehicle';
// the "Another vehicle" filter: a car shows when its name holds what he typed
const matches = (c: OwnCar, query: string) => carLabel(c).toLowerCase().includes(query.trim().toLowerCase());
// The result line after File. `still`: how many of the photos sent still ask below (null when the day could not be read again).
export function filedLine(filed: number, sent: number, car: string, still: number | null = null): string {
  if (filed >= sent) return `Filed ${plural(filed, 'photo')} to ${car}.`;
  const head = `Filed ${n(filed)} of ${n(sent)} to ${car}.`;
  if (still === null) return `${head} The others were already filed or couldn't be filed.`;
  const gone = sent - filed - still;
  return [head, still > 0 ? `${plural(still, 'photo')} still ${still === 1 ? 'waits' : 'wait'} below.` : '',
    gone > 0 ? `${n(gone)} ${gone === 1 ? 'was' : 'were'} already filed or couldn't be filed.` : ''].filter(Boolean).join(' ');
}
// What the block says when File did not file. The writer's own text is never shown: a refusal (42501) is permanent for
// that car, anything else (a dropped connection, a timeout) is worth another tap, and nothing moved is the phone's words.
export const FILE_REFUSED = "You can't file photos onto this vehicle. Pick one you own or can edit.";
export const FILE_FAILED = "Couldn't file these just now. They're still waiting here. Try again.";
export const NONE_MOVED = 'No photos were moved. Try again, or pick another vehicle.';
// The closest records he cannot file onto, on one line: merged into another record, removed, or not tied to his account.
export const notLinkedLine = (names: string[]) => `Closest, but can't take photos (merged, removed or not linked to your account): ${names.join(', ')}.`;

const Icon = ({ kind, className }: { kind: 'up' | 'warn' | 'check' | 'check-fill' | 'circle' | 'dots' | 'chevron' | 'lock'; className?: string }) => {
  const common = { className, viewBox: '0 0 24 24', width: 24, height: 24, 'aria-hidden': true as const, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (kind) {
    case 'up': return <svg {...common}><circle cx="12" cy="12" r="9.5" /><path d="M12 16V8m-4 4 4-4 4 4" /></svg>;
    case 'warn': return <svg {...common}><path d="M12 3 2.5 20h19L12 3z" /><path d="M12 9v5m0 3h.01" /></svg>;
    case 'check': return <svg {...common}><circle cx="12" cy="12" r="9.5" /><path d="m8 12.5 2.5 2.5L16 9.5" /></svg>;
    case 'check-fill': return <svg {...common} fill="currentColor" stroke="var(--surface)"><circle cx="12" cy="12" r="10" stroke="none" /><path d="m8 12.5 2.5 2.5L16 9.5" /></svg>;
    case 'circle': return <svg {...common}><circle cx="12" cy="12" r="9.5" /></svg>;
    case 'lock': return <svg {...common}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
    case 'chevron': return <svg {...common}><path d="m6 9 6 6 6-6" /></svg>;
    default: return <svg {...common}><circle cx="12" cy="12" r="9.5" /><path d="M8 12h.01M12 12h.01M16 12h.01" /></svg>;
  }
};
// no_file, non_vehicle and junk: nothing more happens to them, so an empty circle, not the pending dots
const SETTLED: ReadonlySet<State> = new Set(['no_file', 'non_vehicle', 'junk']);
const frameIcon = (s: State) => SETTLED.has(s) ? 'circle' : s === 'on_vehicle' ? 'check-fill' : s === 'failed' || s === 'pulled' ? 'warn' : s === 'private' ? 'lock' : s === 'unverified' || s === 'duplicate' ? 'check' : s === 'waiting' || s === 'held' || s === 'unsorted' ? 'dots' : 'up';

function DayPills({ d }: { d: DayRow }) {
  const pills: { key: string; text: string; tone?: string }[] = [];
  for (const v of d.vehicles.slice(0, 2)) pills.push({ key: `v-${v.vehicle_id}`, text: `${n(v.n)} on ${v.name}`, tone: 'on' });
  const rest = d.on_vehicle + d.unverified - d.vehicles.slice(0, 2).reduce((s, v) => s + v.n, 0);
  if (rest > 0) pills.push({ key: 'rest', text: `${n(rest)} on other vehicles`, tone: 'on' });
  if (d.waiting) pills.push({ key: 'waiting', text: `${n(d.waiting)} waiting` });
  if (d.held) pills.push({ key: 'held', text: `${n(d.held)} held` });
  if (d.unsorted) pills.push({ key: 'unsorted', text: `${n(d.unsorted)} not sorted` });
  if (d.duplicate) pills.push({ key: 'duplicate', text: plural(d.duplicate, 'copy', 'copies') });
  if (d.pulled) pills.push({ key: 'pulled', text: `${n(d.pulled)} taken off`, tone: 'pulled' });
  if (d.private) pills.push({ key: 'private', text: `${n(d.private)} private` });
  if (d.skipped) pills.push({ key: 'skipped', text: `${n(d.skipped)} skipped` });
  for (const text of settledParts(d)) pills.push({ key: text, text });
  if (d.failed) pills.push({ key: 'failed', text: `${n(d.failed)} failed`, tone: 'failed' });
  return <span className="cl-day__pills">{pills.map(p => <span key={p.key} className={`cl-pill${p.tone ? ` cl-pill--${p.tone}` : ''}`}><Text role="label">{p.text}</Text></span>)}</span>;
}

function FrameRow({ f }: { f: Frame }) {
  // a junk frame's thumb is an address that is not a stored picture: never asked for. A kept-on-the-phone frame's thumb
  // is the empty address the record holds (blank, not null), so a blank address draws the placeholder too.
  return <li><div className={`cl-frame cl-frame--${f.state}`}>
    {f.thumb?.trim() && f.state !== 'junk' ? <img className="cl-frame__thumb" src={optimizeImageUrl(f.thumb, 'thumbnail') ?? f.thumb} alt="" width={56} height={56} loading="lazy" decoding="async" />
      : <span className="cl-frame__thumb" aria-hidden="true"><Icon kind={f.state === 'private' ? 'lock' : SETTLED.has(f.state) ? 'circle' : 'dots'} /></span>}
    <Icon kind={frameIcon(f.state)} className="cl-frame__icon" />
    <span className="cl-frame__text"><Text role="body">{stageLabel(f)}</Text><Text role="caption">{liveLine(f)}</Text></span>
    {f.vehicle_id && (f.state === 'on_vehicle' || f.state === 'unverified') && <Link className="cl-frame__open" to={`/vehicle/${f.vehicle_id}?day=${f.taken_at.slice(0, 10)}`} aria-label={`Open ${f.vehicle ?? 'the vehicle'} on this day`}><Text role="label">Open</Text></Link>}
  </div></li>;
}
function SkipRow({ s }: { s: Skip }) {
  return <li><div className="cl-frame cl-frame--skipped">
    <span className="cl-frame__thumb" aria-hidden="true"><Icon kind="dots" /></span>
    <Icon kind="dots" className="cl-frame__icon" />
    <span className="cl-frame__text"><Text role="body">{`Skipped on the phone: ${words(SKIP, s.reason, s.reason)}`}</Text>
      <Text role="caption">{`${s.taken_at ? timeLabel(s.taken_at) : 'time unknown'}${s.device ? ` · ${s.device}` : ''} · never uploaded`}</Text></span>
  </div></li>;
}

// One choice: the car's picture and its name, and a check when it is the picked car. Never a score.
function CarChoice({ label, picture, selected, disabled, onPick }: { label: string; picture: string | null; selected: boolean; disabled: boolean; onPick: (el: HTMLButtonElement) => void }) {
  const src = optimizeImageUrl(picture, 'thumbnail');
  return <button type="button" className="cl-ask__choice" aria-pressed={selected} disabled={disabled} onClick={e => onPick(e.currentTarget)}>
    {src ? <img className="cl-frame__thumb" src={src} alt="" width={72} height={72} loading="lazy" decoding="async" />
      : <span className="cl-frame__thumb" aria-hidden="true"><Icon kind="dots" /></span>}
    <Text role="body">{label}</Text>
    {selected && <Icon kind="check-fill" className="cl-ask__check" />}
  </button>;
}
// In view, clear of the fixed header and the phone's tab bar (scroll-margin in the CSS). jsdom has no scrollIntoView.
const reveal = (el: Element | null | undefined) => el?.scrollIntoView?.({ block: 'nearest' });
export const ARM_MS = 400;

// "Which vehicle?" for one held set: the photos (each one can be left out), the matcher's closest cars in its order,
// and every one of his vehicles behind "Another vehicle". A pick only opens the confirm line beside it; File writes.
// A closest car that is not one of his vehicles is a line, not a choice: the writer would refuse it. Until his vehicles
// are read no closest car can be tapped; when they could not be read, every named closest car is offered.
function HeldSet({ setKey, frames, garage, filing, onFile, onRetryGarage }: { setKey: string; frames: Frame[]; garage: Garage; filing: boolean; onFile: FileSet; onRetryGarage: () => void }) {
  const headingId = useId();
  const box = useRef<HTMLElement>(null);
  const pickedEl = useRef<HTMLButtonElement | null>(null);
  const [out, setOut] = useState<ReadonlySet<string>>(() => new Set());
  const [picked, setPicked] = useState<{ id: string; label: string; where: 'closest' | 'all' } | null>(null);
  // null: the list's default, open when no closest car can be tapped; true or false once he opens or closes it
  const [all, setAll] = useState<boolean | null>(null);
  const [query, setQuery] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const cars = Array.isArray(garage) ? garage : null;
  const byId = useMemo(() => new Map((cars ?? []).map(c => [c.id, c])), [cars]);
  const candidates = useMemo(() => {
    const seen = new Set<string>();
    return (frames.find(f => f.candidates?.length)?.candidates ?? []).filter(c => c.vehicle_id && !seen.has(c.vehicle_id) && Boolean(seen.add(c.vehicle_id)));
  }, [frames]);
  // what each closest car becomes: a choice (his, or any named one when his vehicles could not be read), a line saying
  // it cannot take the photos (named and not his), or nothing (still reading, signed out, or not his and nameless)
  const tappable = useMemo(() => cars ? candidates.filter(c => byId.has(c.vehicle_id)).map(c => ({ id: c.vehicle_id, label: c.name || carLabel(byId.get(c.vehicle_id)!), picture: byId.get(c.vehicle_id)!.primary_image_url }))
    : garage === 'error' ? candidates.filter(c => c.name).map(c => ({ id: c.vehicle_id, label: c.name!, picture: null })) : [], [candidates, cars, byId, garage]);
  const notMine = cars ? candidates.filter(c => !byId.has(c.vehicle_id) && c.name).map(c => ({ id: c.vehicle_id, name: c.name! })) : [];
  const listOpen = all ?? Boolean(cars && tappable.length === 0);
  const shown = useMemo(() => !cars ? [] : cars.filter(c => matches(c, query)), [cars, query]);
  const included = frames.filter(f => !out.has(f.image_id));
  const first = frames[0], last = frames[frames.length - 1];
  const span = timeLabel(first.taken_at) === timeLabel(last.taken_at) ? timeLabel(first.taken_at) : `${timeLabel(first.taken_at)} to ${timeLabel(last.taken_at)}`;
  const toggle = (id: string) => setOut(prev => { const next = new Set(prev); if (!next.delete(id)) next.add(id); return next; });
  const pick = (id: string, label: string, where: 'closest' | 'all', el: HTMLButtonElement) => { pickedEl.current = el; setFailure(null); setPicked({ id, label, where }); };
  // A pick opens the confirm line and brings it into view. File stays off for a moment after each pick, so the second
  // tap of a double tap (or a held Enter) that lands on it once the line scrolls in is not taken as his File (Sign).
  useEffect(() => {
    if (!picked) return;
    reveal(box.current?.querySelector('.cl-ask__confirm'));
    setArmed(false);
    const t = setTimeout(() => setArmed(true), ARM_MS);
    return () => clearTimeout(t);
  }, [picked]);
  useEffect(() => { if (failure) reveal(box.current?.querySelector('.cl-ask__failure')); }, [failure]);
  // The list opens below the button: bring its filter into view (not focused, so a phone keeps its keyboard down). Only
  // when he opened it: a list open by default stays where it is, so opening the day never scrolls the question away.
  useEffect(() => { if (all) reveal(box.current?.querySelector('.cl-ask__filter')); }, [all, garage]);
  const cancel = () => { setPicked(null); setFailure(null); pickedEl.current?.focus({ preventScroll: true }); };
  // A car picked from his list carries its confirm line in its row: when the filter hides that row, or the list is
  // closed, the pick goes with it, so File never waits off screen and clearing the filter brings nothing back.
  const hidePick = (stillShown: boolean) => { if (picked?.where === 'all' && !stillShown) { setPicked(null); setFailure(null); } };
  const filterBy = (q: string) => { setQuery(q); hidePick(Boolean(cars?.some(c => c.id === picked?.id && matches(c, q)))); };
  const toggleList = () => { setAll(!listOpen); hidePick(!listOpen); };
  const file = async () => {
    if (!picked || included.length === 0) return;
    setFailure(null);
    const result = await onFile(setKey, included.map(f => f.image_id), picked.id, picked.label);
    if (result === undefined) return;
    if (result) { setFailure(result); return; }
    // filed: what is still held asks again from the start, every photo in, the list back to its default
    setPicked(null); setOut(new Set()); setAll(null); setQuery('');
  };
  const confirm = (id: string, where: 'closest' | 'all') => picked?.id === id && picked.where === where && <div className="cl-ask__confirm">
    <p role="status"><Text role="body">{included.length ? `File ${plural(included.length, 'photo')} to ${picked.label}?` : 'Every photo is left out. Tap one to put it back.'}</Text></p>
    <span className="cl-ask__actions">
      <button type="button" className="cl-rescan__button" disabled={filing || !armed || included.length === 0 || failure === FILE_REFUSED} aria-busy={filing} onClick={() => void file()}><Text role="label">{filing ? 'Filing…' : 'File'}</Text></button>
      <button type="button" className="cl-more cl-more--inline" disabled={filing} onClick={cancel}><Text role="label">Cancel</Text></button>
    </span>
    {failure && <p role="alert" className="cl-ask__failure"><Icon kind="warn" /><Text role="body">{failure}</Text></p>}
  </div>;

  return <li><section className="cl-ask" aria-labelledby={headingId} ref={box}>
    <div className="cl-ask__head">
      <Icon kind="dots" className="cl-frame__icon" />
      <span className="cl-frame__text"><Text role="measure" as="h2" id={headingId}>Which vehicle?</Text>
        <Text role="caption">{`${plural(frames.length, 'photo')} · ${span} · ${stageLabel(first)}`}</Text></span>
    </div>
    <p className="cl-ask__hint"><Text role="caption">Every photo is in. Tap one to leave it out.</Text></p>
    <div className="cl-ask__photos">
      {frames.map(f => { const left = out.has(f.image_id); const src = optimizeImageUrl(f.thumb, 'small'); return <button key={f.image_id} type="button"
        className={`cl-ask__photo${left ? ' cl-ask__photo--out' : ''}`} aria-pressed={!left} aria-label={`${shortName(f)}, ${timeLabel(f.taken_at)}`} disabled={filing} onClick={() => toggle(f.image_id)}>
        {src ? <img src={src} alt="" width={160} height={160} loading="lazy" decoding="async" />
          : <span className="cl-frame__thumb" aria-hidden="true"><Icon kind="dots" /></span>}
        <Icon kind={left ? 'circle' : 'check-fill'} className="cl-ask__mark" />
      </button>; })}
    </div>
    {(tappable.length > 0 || notMine.length > 0) && <p className="cl-ask__hint"><Text role="label">Closest matches</Text></p>}
    {garage === 'loading' && <p className="cl-ask__hint" role="status"><Text role="caption">Reading your vehicles…</Text></p>}
    <ul className="cl-ask__choices">
      {tappable.map(c => <li key={c.id}>
        <CarChoice label={c.label} picture={c.picture} selected={picked?.id === c.id} disabled={filing} onPick={el => pick(c.id, c.label, 'closest', el)} />
        {confirm(c.id, 'closest')}
      </li>)}
      {notMine.length > 0 && <li><p className="cl-ask__hint"><Text role="caption">{notLinkedLine(notMine.map(c => c.name))}</Text></p></li>}
      {garage !== 'error' && garage !== null && <li><button type="button" className="cl-ask__choice cl-ask__more" aria-expanded={listOpen} disabled={filing} onClick={toggleList}>
        <Text role="body">Another vehicle</Text><Icon kind="chevron" className="cl-ask__chevron" /></button></li>}
    </ul>
    {garage === 'error' && <div className="cl-ask__retry"><p><Text role="caption">{tappable.length ? "Couldn't read your other vehicles. Pick from the closest matches, or try again." : "Couldn't read your vehicles. Try again."}</Text></p>
      <button type="button" className="cl-more cl-more--inline" disabled={filing} onClick={onRetryGarage}><Text role="label">Try again</Text></button></div>}
    {listOpen && cars && <div className="cl-ask__all">
      <input className="form-input cl-ask__filter" type="search" value={query} onChange={e => filterBy(e.target.value)} placeholder="Year, make or model" aria-label="Find a vehicle: year, make or model" disabled={filing} />
      {shown.length === 0 ? <p className="cl-ask__hint"><Text role="caption">No vehicle matches. If it's not here, </Text><Link className="cl-ask__add" to="/vehicle/add"><Text role="caption">add it</Text></Link><Text role="caption"> first.</Text></p>
        : <ul className="cl-ask__choices">{shown.map(c => { const label = carLabel(c); return <li key={c.id}>
          <CarChoice label={label} picture={c.primary_image_url} selected={picked?.id === c.id} disabled={filing} onPick={el => pick(c.id, label, 'all', el)} />
          {confirm(c.id, 'all')}
        </li>; })}</ul>}
    </div>}
  </section></li>;
}

export default function CaptureLedger() {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [earlier, setEarlier] = useState<DayRow[]>([]);
  const [from, setFrom] = useState(() => shiftDays(isoDate(new Date()), -WINDOW_DAYS));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [days, setDays] = useState<Record<string, Day | 'loading' | 'error'>>({});
  const [asking, setAsking] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const { user } = useAuth();
  const [garage, setGarage] = useState<Garage>(null);
  const garageAsked = useRef(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [filing, setFiling] = useState<Record<string, boolean>>({});
  const filingNow = useRef(new Set<string>());
  const noteToShow = useRef<string | null>(null);
  const noteEls = useRef(new Map<string, HTMLDivElement>());

  const read = useCallback(async () => {
    setLoading(true); setError(null);
    const { data, error: e } = await supabase.rpc('get_capture_ledger', { p_tz: TZ, p_from: from, p_to: null, p_limit: 400 });
    if (e) { setError(e.message); setLedger(null); } else { setLedger(data as Ledger); setNow(Date.now()); }
    setLoading(false);
  }, [from]);
  useEffect(() => { void read(); }, [read]);

  const showEarlier = useCallback(async () => {
    const to = shiftDays(from, -1), start = shiftDays(from, -WINDOW_DAYS);
    setLoading(true);
    const { data, error: e } = await supabase.rpc('get_capture_ledger', { p_tz: TZ, p_from: start, p_to: to, p_limit: 400 });
    if (e) setError(e.message); else { setEarlier(prev => [...prev, ...((data as Ledger).days ?? [])]); setFrom(start); }
    setLoading(false);
  }, [from]);

  const openDay = useCallback(async (day: string) => {
    setOpen(prev => (prev === day ? null : day));
    if (days[day]) return;
    setDays(prev => ({ ...prev, [day]: 'loading' }));
    const { data, error: e } = await supabase.rpc('get_capture_ledger_day', { p_day: day, p_tz: TZ });
    setDays(prev => ({ ...prev, [day]: e ? 'error' : (data as Day) }));
  }, [days]);

  // His vehicles, read the first time an opened day holds a set that asks "Which vehicle?", and again on "Try again".
  // The phone's picker read (AttributionEngine.swift loadConfirmData) without removed or merged-away records: every
  // car offered is a live record the filing writer takes.
  const userId = user?.id ?? null;
  const loadGarage = useCallback(async () => {
    if (!userId) return;
    garageAsked.current = true; setGarage('loading');
    const { data, error: e } = await supabase.from('vehicles').select('id, year, make, model, primary_image_url')
      .or(`user_id.eq.${userId},owner_id.eq.${userId}`).neq('make', 'UNRESOLVED')
      .is('deleted_at', null).is('merged_into_vehicle_id', null).order('updated_at', { ascending: false });
    setGarage(e || !Array.isArray(data) ? 'error' : (data as OwnCar[]));
  }, [userId]);
  useEffect(() => {
    if (garageAsked.current || !userId || !open) return;
    const d = days[open];
    if (!d || typeof d === 'string' || !d.frames.some(f => f.state === 'held' && f.set_key)) return;
    void loadGarage();
  }, [open, days, userId, loadGarage]);

  // After File: the day again (null when that read fails, keeping what is shown), and the totals without emptying the
  // page when that read fails (read() would).
  const rereadDay = useCallback(async (day: string): Promise<Day | null> => {
    const { data, error: e } = await supabase.rpc('get_capture_ledger_day', { p_day: day, p_tz: TZ });
    if (e || !data) return null;
    setDays(prev => ({ ...prev, [day]: data as Day }));
    return data as Day;
  }, []);
  const refreshTotals = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('get_capture_ledger', { p_tz: TZ, p_from: from, p_to: null, p_limit: 400 });
    if (!e && data) { setLedger(data as Ledger); setNow(Date.now()); }
  }, [from]);

  // The one write on a held set, at the File tap: the photos left in, onto the car he picked. Then the day and the
  // totals are read again so the photos show as added and the pills follow. One File per day at a time: a second tap,
  // or another set of the same day, sends nothing until it is back, so two day reads never race.
  const fileSet = useCallback(async (day: string, key: string, ids: string[], vehicleId: string, label: string): Promise<string | null | undefined> => {
    if (filingNow.current.has(day)) return undefined;
    filingNow.current.add(day); setFiling(prev => ({ ...prev, [day]: true }));
    try {
      const { data, error: e } = await supabase.rpc('attribute_image_session', { p_image_ids: ids, p_vehicle_id: vehicleId, p_reason: 'owner_ledger_answer' });
      if (e) {
        if (e.code === '42501') return FILE_REFUSED;
        // the write may have landed before the connection dropped: read the day again so filed photos stop asking
        await rereadDay(day);
        return FILE_FAILED;
      }
      const filed = Number(data) || 0;
      const [fresh] = await Promise.all([rereadDay(day), filed > 0 ? refreshTotals() : null]);
      if (filed === 0) return NONE_MOVED;
      const still = fresh ? fresh.frames.filter(f => f.state === 'held' && f.set_key === key && ids.includes(f.image_id)).length : null;
      noteToShow.current = day;
      setNotes(prev => ({ ...prev, [day]: `${filedLine(filed, ids.length, label, still)}${fresh ? '' : " This day couldn't be read again; reload to see them."}` }));
      return null;
    } finally {
      filingNow.current.delete(day);
      setFiling(prev => { const next = { ...prev }; delete next[day]; return next; });
    }
  }, [rereadDay, refreshTotals]);
  // The result line is where he looks next: in view and focused, so a screen reader reads it and Tab goes on from it.
  useEffect(() => {
    const day = noteToShow.current; if (!day) return;
    noteToShow.current = null;
    const el = noteEls.current.get(day);
    reveal(el); el?.focus({ preventScroll: true });
  }, [notes]);

  const askRescan = useCallback(async () => {
    setAsking(true);
    const { data, error: e } = await supabase.rpc('request_capture_rescan', { p_from: null, p_source: 'web' });
    if (e) setError(e.message); else setLedger(prev => (prev ? { ...prev, rescan: data as Rescan } : prev));
    setNow(Date.now()); setAsking(false);
  }, []);

  const rows = useMemo(() => [...(ledger?.days ?? []), ...earlier], [ledger, earlier]);
  const vehiclesByCount = useMemo(() => {
    const m = new Map<string, { name: string; n: number }>();
    for (const d of rows) for (const v of d.vehicles) { const cur = m.get(v.vehicle_id); m.set(v.vehicle_id, { name: v.name, n: (cur?.n ?? 0) + v.n }); }
    return [...m.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  }, [rows]);
  const anyFailed = (ledger?.totals.failed ?? 0) > 0;

  return <div className="cl-page">
    <div className="cl-heading"><div><Text role="entity" as="h1">Capture ledger</Text>
      <p><Text role="caption">Every photo you took, by day: what the phone kept, what landed on a vehicle, and what is still waiting.</Text></p></div>
      <Link className="cl-frame__open" to="/?tab=garage"><Text role="label">Garage</Text></Link>
    </div>
    {error && <section role="alert" className="cl-notice"><Text role="body">{`Couldn't read the ledger just now: ${error}`}</Text></section>}
    {ledger && <div className={`cl-bar${anyFailed ? ' cl-bar--failed' : ''}`} role="status">
      <Icon kind={anyFailed ? 'warn' : 'up'} className="cl-bar__icon" />
      <div className="cl-bar__summary"><Text role="body">{summaryLine(ledger.totals, vehiclesByCount)}</Text>
        <Text role="caption">{`Since ${dayLabel(from)}${ledger.days_total > rows.length ? ` · ${n(ledger.days_total - rows.length)} more days in this window` : ''} · days in ${TZ.replace(/_/g, ' ')}`}</Text></div>
    </div>}
    {ledger && <section className="cl-rescan" aria-label="Re-scan my library">
      <button type="button" className="cl-rescan__button" onClick={askRescan} disabled={asking || Boolean(ledger.rescan)}><Text role="label">{ledger.rescan ? 'Re-scan requested' : 'Re-scan my library'}</Text></button>
      <span className="cl-rescan__state"><Text role="caption">{rescanLine(ledger, now)}</Text></span>
    </section>}
    {loading && !ledger && <div role="status" className="cl-notice"><Text role="body">Reading your photos…</Text></div>}
    {ledger && rows.length === 0 && <section className="cl-notice"><Text role="body">{`No photos since ${dayLabel(from)}.`}</Text></section>}
    {rows.length > 0 && <ol className="cl-days">
      {rows.map(d => { const detail = days[d.day]; const expanded = open === d.day; return <li key={d.day}>
        <button type="button" className="cl-day" aria-expanded={expanded} aria-controls={`cl-day-${d.day}`} onClick={() => void openDay(d.day)}>
          <span className="cl-day__date"><Text role="body">{dayLabel(d.day)}</Text></span>
          <DayPills d={d} />
          <Icon kind="chevron" className="cl-day__chevron" />
        </button>
        {expanded && <div id={`cl-day-${d.day}`}>
          {detail === 'loading' || !detail ? <div className="cl-notice" role="status"><Text role="caption">Reading the day…</Text></div>
            : detail === 'error' ? <div className="cl-notice" role="alert"><Text role="caption">Couldn't read this day just now.</Text></div>
            : <><div className={notes[d.day] ? 'cl-notice cl-filed' : 'cl-filed'} role="status" tabIndex={-1}
                ref={el => { if (el) noteEls.current.set(d.day, el); else noteEls.current.delete(d.day); }}>{notes[d.day] && <><Icon kind="check" className="cl-filed__icon" /><Text role="body">{notes[d.day]}</Text></>}</div>
              <ul className="cl-frames">{dayItems(detail.frames).map(item => item.kind === 'frame' ? <FrameRow key={item.f.image_id} f={item.f} />
                : <HeldSet key={`set-${item.key}`} setKey={item.key} frames={item.frames} garage={userId ? garage ?? 'loading' : null} filing={Boolean(filing[d.day])}
                    onFile={(key, ids, vehicleId, label) => fileSet(d.day, key, ids, vehicleId, label)} onRetryGarage={() => void loadGarage()} />)}
                {detail.skipped.map(s => <SkipRow key={s.asset_id} s={s} />)}</ul></>}
        </div>}
      </li>; })}
    </ol>}
    {ledger && <button type="button" className="cl-more" onClick={showEarlier} disabled={loading}><Text role="label">{loading ? 'Reading…' : `Show the year before ${dayLabel(from)}`}</Text></button>}
  </div>;
}
