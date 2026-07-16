/**
 * ModeSwitcher — the "silent switch" for identity.
 *
 * Lists the modes derived from the signed-in user's REAL graph (org memberships
 * + ownership-confirmed vehicles) and reskins the whole app on tap. Manual only:
 * auto proposes, manual disposes — this is the manual half, and it's the half
 * that has to exist and feel good before any auto-trigger is worth building.
 *
 * No fabricated entries. If the personal list is empty it's because no vehicle
 * is ownership-confirmed yet — shown as an intake gap, not hidden, not faked.
 */

import React, { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useBranding } from './BrandingContext';
import { LIVERY_ICON_COLORS, monogramFor } from './brandIdentity';
import { deriveModes, type DerivedModes, type Mode } from './deriveModes';
import {
  getAutoMode,
  setAutoMode,
  getSchedules,
  setSchedule,
  type AutoMode,
  type ModeWindow,
} from './modeSchedule';
import { MODE_AUTO_EVENT } from './ModeAutoController';
import { getGeofences, setGeofence, getCurrentPosition } from './modeLocation';

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function notifyAutoChange() {
  window.dispatchEvent(new CustomEvent(MODE_AUTO_EVENT));
}

function AutoModeSelector() {
  const [auto, setAuto] = useState<AutoMode>(getAutoMode());
  const opts: { v: AutoMode; label: string; hint: string }[] = [
    { v: 'off', label: 'Off', hint: 'manual only' },
    { v: 'suggest', label: 'Suggest', hint: 'propose, one-tap' },
    { v: 'auto', label: 'Auto', hint: 'switch silently' },
  ];
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
      {opts.map((o) => (
        <button
          key={o.v}
          title={o.hint}
          onClick={() => {
            setAutoMode(o.v);
            setAuto(o.v);
            notifyAutoChange();
          }}
          style={{
            padding: '6px 10px',
            border: auto === o.v ? '2px solid var(--text)' : '2px solid var(--border)',
            background: auto === o.v ? 'var(--text)' : 'transparent',
            color: auto === o.v ? 'var(--bg)' : 'var(--text)',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            cursor: 'pointer',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function GeofenceControl({ subjectId }: { subjectId: string }) {
  const existing = getGeofences()[subjectId];
  const [fence, setFence] = useState(existing ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const capture = async () => {
    setBusy(true);
    setErr(null);
    try {
      const pos = await getCurrentPosition();
      const f = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        radius: 150,
        source: 'gps' as const,
      };
      setGeofence(subjectId, f);
      setFence(f);
      notifyAutoChange();
    } catch {
      setErr('location unavailable / denied');
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    setGeofence(subjectId, null);
    setFence(null);
    notifyAutoChange();
  };

  return (
    <div style={{ padding: '0 0 10px 40px', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <button
        onClick={capture}
        disabled={busy}
        style={{
          border: '2px solid var(--border)',
          background: 'transparent',
          color: 'var(--text)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          padding: '5px 8px',
          cursor: busy ? 'wait' : 'pointer',
        }}
      >
        {busy ? 'reading GPS…' : 'Use my current location'}
      </button>
      {fence && (
        <>
          <span style={{ fontSize: 10, color: 'var(--text-disabled)' }}>
            {fence.source === 'gps' ? 'learned by presence' : 'from shop record'} ·{' '}
            {fence.lat.toFixed(4)}, {fence.lng.toFixed(4)} · {fence.radius}m
          </span>
          <button
            onClick={clear}
            style={{ border: 'none', background: 'transparent', color: 'var(--text-disabled)', fontSize: 10, cursor: 'pointer', textDecoration: 'underline' }}
          >
            clear
          </button>
        </>
      )}
      {err && <span style={{ fontSize: 10, color: 'var(--accent)' }}>{err}</span>}
    </div>
  );
}

function ScheduleEditor({ subjectId }: { subjectId: string }) {
  const existing = getSchedules()[subjectId];
  const [win, setWin] = useState<ModeWindow>(
    existing ?? { days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00' },
  );

  const save = (next: ModeWindow) => {
    setWin(next);
    setSchedule(subjectId, next.days.length ? next : null);
    notifyAutoChange();
  };

  return (
    <div style={{ padding: '6px 0 10px 40px', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      <div style={{ display: 'flex', gap: 2 }}>
        {DAYS.map((d, i) => {
          const on = win.days.includes(i);
          return (
            <button
              key={d}
              onClick={() =>
                save({ ...win, days: on ? win.days.filter((x) => x !== i) : [...win.days, i].sort() })
              }
              style={{
                width: 22,
                height: 22,
                padding: 0,
                border: on ? '2px solid var(--text)' : '2px solid var(--border)',
                background: on ? 'var(--text)' : 'transparent',
                color: on ? 'var(--bg)' : 'var(--text-disabled)',
                fontSize: 9,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {d}
            </button>
          );
        })}
      </div>
      <input
        type="time"
        value={win.start}
        onChange={(e) => save({ ...win, start: e.target.value })}
        style={{ border: '2px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 11, padding: '2px 4px' }}
      />
      <span style={{ fontSize: 10, color: 'var(--text-disabled)' }}>→</span>
      <input
        type="time"
        value={win.end}
        onChange={(e) => save({ ...win, end: e.target.value })}
        style={{ border: '2px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 11, padding: '2px 4px' }}
      />
    </div>
  );
}

const label: React.CSSProperties = {
  fontSize: 8,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--text-disabled)',
  display: 'block',
  margin: '0 0 6px',
};

function ModeRow({
  mode,
  active,
  scheduled,
  onPick,
  onToggleSchedule,
}: {
  mode: Mode;
  active: boolean;
  scheduled: boolean;
  onPick: () => void;
  onToggleSchedule: () => void;
}) {
  const c = LIVERY_ICON_COLORS[mode.accent];
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        border: active ? '2px solid var(--text)' : '2px solid var(--border)',
        background: active ? 'var(--surface)' : 'transparent',
        marginBottom: 6,
      }}
    >
      <button
        onClick={onPick}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flex: 1,
          minWidth: 0,
          textAlign: 'left',
          border: 'none',
          background: 'transparent',
          color: 'var(--text)',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 30,
            height: 30,
            flexShrink: 0,
            background: c.bg,
            color: c.fg,
            fontSize: 11,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {mode.logoUrl ? (
            <img src={mode.logoUrl} alt="" width={30} height={30} style={{ width: 30, height: 30, objectFit: 'cover' }} />
          ) : (
            monogramFor(mode.name)
          )}
        </span>
        <span style={{ minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 700, display: 'block' }}>{mode.name}</span>
          <span style={{ fontSize: 10, color: 'var(--text-disabled)' }}>
            {mode.role}
            {mode.group === 'work' && mode.verificationMethod && (
              <span style={{ marginLeft: 6 }}>
                {mode.verificationMethod === 'self_claimed'
                  ? '· self-claimed'
                  : `· ✓ ${mode.verificationMethod.replace(/_/g, ' ')}`}
              </span>
            )}
          </span>
        </span>
      </button>
      {active && <span style={{ fontSize: 9, color: 'var(--text-disabled)' }}>ACTIVE</span>}
      <button
        onClick={onToggleSchedule}
        title="Set a schedule for this mode"
        style={{
          border: scheduled ? '2px solid var(--text)' : '2px solid var(--border)',
          background: 'transparent',
          color: scheduled ? 'var(--text)' : 'var(--text-disabled)',
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.06em',
          padding: '4px 6px',
          cursor: 'pointer',
        }}
      >
        {scheduled ? 'SCHEDULED' : 'SCHEDULE'}
      </button>
    </div>
  );
}

export default function ModeSwitcher() {
  const { user } = useAuth();
  const { brand, activateBrand, resetBrand } = useBranding();
  const [modes, setModes] = useState<DerivedModes | null>(null);
  const [loading, setLoading] = useState(true);
  const [openSched, setOpenSched] = useState<string | null>(null);
  // Bumped on every schedule save so SCHEDULED badges re-read localStorage.
  const [schedTick, setSchedTick] = useState(0);

  useEffect(() => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    deriveModes(user.id)
      .then((m) => !cancelled && setModes(m))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Keep SCHEDULED badges in sync when a window is saved/cleared.
  useEffect(() => {
    const onChange = () => setSchedTick((t) => t + 1);
    window.addEventListener(MODE_AUTO_EVENT, onChange);
    return () => window.removeEventListener(MODE_AUTO_EVENT, onChange);
  }, []);

  if (!user) {
    return (
      <p style={{ fontSize: 11, color: 'var(--text-disabled)' }}>
        Sign in to see the modes derived from your graph.
      </p>
    );
  }
  if (loading) return <p style={{ fontSize: 11, color: 'var(--text-disabled)' }}>reading your graph…</p>;

  const activeId = brand?.subjectId ?? null;
  const scheduled = getSchedules();
  void schedTick; // dependency: re-read schedules after a save

  const renderRow = (m: Mode) => {
    const id = String(m.subjectId);
    return (
      <React.Fragment key={`${m.kind}:${id}`}>
        <ModeRow
          mode={m}
          active={activeId === m.subjectId}
          scheduled={!!scheduled[id]}
          onPick={() => activateBrand(m)}
          onToggleSchedule={() => setOpenSched((cur) => (cur === id ? null : id))}
        />
        {openSched === id && (
          <div key={`panel-${id}-${schedTick}`}>
            <ScheduleEditor subjectId={id} />
            <GeofenceControl subjectId={id} />
          </div>
        )}
      </React.Fragment>
    );
  };

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <span style={label}>Automation · the silent switch</span>
        <AutoModeSelector />
        <p style={{ fontSize: 10, color: 'var(--text-disabled)', margin: '6px 0 0', lineHeight: 1.5 }}>
          Suggest = propose when a scheduled window opens. Auto = flip silently (always
          reversible). Set a window per mode below.
        </p>
      </div>

      <div style={{ marginBottom: 16 }}>
        <span style={label}>Work modes · from your affiliations</span>
        {modes?.work.length ? (
          modes.work.map(renderRow)
        ) : (
          <p style={{ fontSize: 11, color: 'var(--text-disabled)' }}>No org affiliations yet.</p>
        )}
      </div>

      <div style={{ marginBottom: 16 }}>
        <span style={label}>Personal modes · ownership-confirmed vehicles</span>
        {modes?.personal.length ? (
          modes.personal.map(renderRow)
        ) : (
          <p style={{ fontSize: 11, color: 'var(--text-disabled)', lineHeight: 1.5 }}>
            No ownership-confirmed vehicles yet — so there's nothing honest to put here.
            Confirm ownership on a vehicle and it becomes a personal mode. (Scraped /
            research vehicles are deliberately excluded.)
          </p>
        )}
      </div>

      <button
        onClick={resetBrand}
        style={{
          padding: '8px 14px',
          border: '2px solid var(--border)',
          background: 'transparent',
          color: 'var(--text)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          cursor: 'pointer',
        }}
      >
        Back to Nuke
      </button>
    </div>
  );
}
