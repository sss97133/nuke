// The capture ledger: the signed-in owner's photos by day, from the phone's gate to the vehicle each one landed on.
// One read (get_capture_ledger) draws the days; opening a day reads it once (get_capture_ledger_day). The words and
// the row shape are the capture app's ingest bar (CaptureIngestBar.swift, CaptureIngestStatus.swift), so a photo reads
// the same on the phone and here. "Re-scan my library" writes a request the phone claims the next time it runs.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Text } from '../kit';
import './capture-ledger.css';

type State = 'on_vehicle' | 'unverified' | 'waiting' | 'held' | 'pulled' | 'private' | 'unsorted' | 'failed';
type DayRow = { day: string; taken: number; on_vehicle: number; unverified: number; waiting: number; held: number; pulled: number;
  private: number; unsorted: number; failed: number; skipped: number; vehicles: { vehicle_id: string; name: string; n: number }[];
  held_reasons: Record<string, number>; skip_reasons: Record<string, number> };
type Rescan = { id: string; requested_at: string; acked_at: string | null; device: string | null; finished_at: string | null; result: Record<string, unknown> | null };
type Ledger = { generated_at: string; tz: string; days: DayRow[]; days_total: number; totals: Omit<DayRow, 'day' | 'vehicles' | 'held_reasons' | 'skip_reasons'>;
  rescan: Rescan | null; last_rescan: Rescan | null };
type Frame = { image_id: string; taken_at: string; state: State; reason: string | null; vehicle_id: string | null; vehicle: string | null;
  source: string | null; file_name: string | null; thumb: string | null; set_key: string | null; candidates: { vehicle_id: string; name: string | null; score: number | null }[] | null };
type Skip = { asset_id: string; reason: string; taken_at: string | null; decided_at: string; device: string | null };
type Day = { day: string; frames: Frame[]; skipped: Skip[] };

const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles'; } catch { return 'America/Los_Angeles'; } })();
const WINDOW_DAYS = 365;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const shiftDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return isoDate(d); };
const n = (v: number) => v.toLocaleString('en-US');
const plural = (v: number, one: string, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`;
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
    case 'waiting': return 'Waiting on a check';
    case 'held': return `Held: ${words(HELD, f.reason, 'no clear match')}`;
    case 'pulled': return `Taken back off${f.vehicle ? ` ${f.vehicle}` : ''}`;
    case 'private': return 'Kept private';
    case 'failed': return `Didn't work: ${words(FAILURE, f.reason, 'something went wrong')}`;
    default: return 'Not sorted yet';
  }
}
export function liveLine(f: Frame): string {
  const name = shortName(f);
  if (f.state === 'held' && f.candidates?.length) {
    const top = f.candidates.slice(0, 2).map(c => `${c.name ?? 'a vehicle'}${c.score != null ? ` ${Number(c.score).toFixed(1)}` : ''}`).join(', ');
    return `${name} · closest: ${top}`;
  }
  if (f.state === 'waiting') return `${name} · a viewed sample decides the set`;
  if (f.state === 'unsorted') return `${name} · not scored yet`;
  return `${name} · ${timeLabel(f.taken_at)}${f.source ? ` · ${f.source.replace(/_/g, ' ')}` : ''}`;
}
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
  if (t.pulled) parts.push(`${n(t.pulled)} taken back off`);
  if (t.private) parts.push(`${n(t.private)} kept private`);
  if (t.skipped) parts.push(`${n(t.skipped)} skipped on the phone`);
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

const Icon = ({ kind, className }: { kind: 'up' | 'warn' | 'check' | 'check-fill' | 'dots' | 'chevron' | 'lock'; className?: string }) => {
  const common = { className, viewBox: '0 0 24 24', width: 24, height: 24, 'aria-hidden': true as const, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (kind) {
    case 'up': return <svg {...common}><circle cx="12" cy="12" r="9.5" /><path d="M12 16V8m-4 4 4-4 4 4" /></svg>;
    case 'warn': return <svg {...common}><path d="M12 3 2.5 20h19L12 3z" /><path d="M12 9v5m0 3h.01" /></svg>;
    case 'check': return <svg {...common}><circle cx="12" cy="12" r="9.5" /><path d="m8 12.5 2.5 2.5L16 9.5" /></svg>;
    case 'check-fill': return <svg {...common} fill="currentColor" stroke="var(--surface)"><circle cx="12" cy="12" r="10" stroke="none" /><path d="m8 12.5 2.5 2.5L16 9.5" /></svg>;
    case 'lock': return <svg {...common}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
    case 'chevron': return <svg {...common}><path d="m6 9 6 6 6-6" /></svg>;
    default: return <svg {...common}><circle cx="12" cy="12" r="9.5" /><path d="M8 12h.01M12 12h.01M16 12h.01" /></svg>;
  }
};
const frameIcon = (s: State) => s === 'on_vehicle' ? 'check-fill' : s === 'failed' || s === 'pulled' ? 'warn' : s === 'private' ? 'lock' : s === 'unverified' ? 'check' : s === 'waiting' || s === 'held' || s === 'unsorted' ? 'dots' : 'up';

function DayPills({ d }: { d: DayRow }) {
  const pills: { key: string; text: string; tone?: string }[] = [];
  for (const v of d.vehicles.slice(0, 2)) pills.push({ key: `v-${v.vehicle_id}`, text: `${n(v.n)} on ${v.name}`, tone: 'on' });
  const rest = d.on_vehicle + d.unverified - d.vehicles.slice(0, 2).reduce((s, v) => s + v.n, 0);
  if (rest > 0) pills.push({ key: 'rest', text: `${n(rest)} on other vehicles`, tone: 'on' });
  if (d.waiting) pills.push({ key: 'waiting', text: `${n(d.waiting)} waiting` });
  if (d.held) pills.push({ key: 'held', text: `${n(d.held)} held` });
  if (d.unsorted) pills.push({ key: 'unsorted', text: `${n(d.unsorted)} not sorted` });
  if (d.pulled) pills.push({ key: 'pulled', text: `${n(d.pulled)} taken off`, tone: 'pulled' });
  if (d.private) pills.push({ key: 'private', text: `${n(d.private)} private` });
  if (d.skipped) pills.push({ key: 'skipped', text: `${n(d.skipped)} skipped` });
  if (d.failed) pills.push({ key: 'failed', text: `${n(d.failed)} failed`, tone: 'failed' });
  return <span className="cl-day__pills">{pills.map(p => <span key={p.key} className={`cl-pill${p.tone ? ` cl-pill--${p.tone}` : ''}`}><Text role="label">{p.text}</Text></span>)}</span>;
}

function FrameRow({ f }: { f: Frame }) {
  return <li><div className={`cl-frame cl-frame--${f.state}`}>
    {f.thumb ? <img className="cl-frame__thumb" src={f.thumb} alt="" width={56} height={56} loading="lazy" decoding="async" />
      : <span className="cl-frame__thumb" aria-hidden="true"><Icon kind={f.state === 'private' ? 'lock' : 'dots'} /></span>}
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

  return <main className="cl-page">
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
            : <ul className="cl-frames">{detail.frames.map(f => <FrameRow key={f.image_id} f={f} />)}{detail.skipped.map(s => <SkipRow key={s.asset_id} s={s} />)}</ul>}
        </div>}
      </li>; })}
    </ol>}
    {ledger && <button type="button" className="cl-more" onClick={showEarlier} disabled={loading}><Text role="label">{loading ? 'Reading…' : `Show the year before ${dayLabel(from)}`}</Text></button>}
  </main>;
}
