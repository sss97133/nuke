/**
 * UserWorkLedger — the decade-of-wrenching card.
 *
 * Substrate: work_sessions WHERE user_id = profile user (production table —
 * read it, don't rebuild it). One query, client-side aggregation (~325 rows).
 *
 * Three bands in one bordered card:
 *   (a) headline stat row in Courier New — SESSIONS / HRS / VEHICLES / JOB COST
 *   (b) per-year hours as flat 2px-bordered horizontal bars
 *   (c) recent-10 sessions list: date / title (or work_type) / hours
 *
 * Dollars are owner-only (isOwnProfile). Self-guards: returns null at 0 rows.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface WorkSessionRow {
  session_date: string;
  duration_minutes: number;
  total_job_cost: number | string | null;
  vehicle_id: string;
  title: string | null;
  work_type: string | null;
}

interface UserWorkLedgerProps {
  userId: string;
  isOwnProfile: boolean;
}

const MONO = '"Courier New", Courier, monospace';
const INK = '#1a1a1a';

const fmtHours = (minutes: number): string => {
  const hrs = minutes / 60;
  return hrs >= 100 ? String(Math.round(hrs)) : hrs.toFixed(1);
};

const fmtCostK = (cost: number): string => {
  if (cost >= 1000) return `$${(cost / 1000).toFixed(1)}K`;
  return `$${Math.round(cost)}`;
};

const fmtDate = (iso: string): string => {
  // session_date is a bare DATE — keep it literal, no TZ math
  const [y, m, d] = iso.split('-');
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const mi = parseInt(m, 10) - 1;
  return `${y}-${months[mi] || m}-${d}`;
};

const UserWorkLedger: React.FC<UserWorkLedgerProps> = ({ userId, isOwnProfile }) => {
  const [sessions, setSessions] = useState<WorkSessionRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from('work_sessions')
        .select('session_date, duration_minutes, total_job_cost, vehicle_id, title, work_type')
        .eq('user_id', userId)
        .order('session_date', { ascending: false })
        .limit(2000);

      if (cancelled) return;
      if (error) {
        setSessions([]);
      } else {
        setSessions(data || []);
      }
      setLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const agg = useMemo(() => {
    if (sessions.length === 0) return null;

    let totalMinutes = 0;
    let totalCost = 0;
    const vehicles = new Set<string>();
    const minutesByYear = new Map<number, number>();
    let minYear = Infinity;
    let maxYear = -Infinity;

    for (const s of sessions) {
      const mins = s.duration_minutes || 0;
      totalMinutes += mins;
      totalCost += Number(s.total_job_cost) || 0;
      if (s.vehicle_id) vehicles.add(s.vehicle_id);

      const year = parseInt(s.session_date.slice(0, 4), 10);
      if (!Number.isNaN(year)) {
        minutesByYear.set(year, (minutesByYear.get(year) || 0) + mins);
        if (year < minYear) minYear = year;
        if (year > maxYear) maxYear = year;
      }
    }

    // Every year in range gets a row, including zero-hour years — the gaps
    // are part of the decade's story.
    const years: Array<{ year: number; minutes: number }> = [];
    let maxYearMinutes = 0;
    if (minYear <= maxYear) {
      for (let y = minYear; y <= maxYear; y++) {
        const m = minutesByYear.get(y) || 0;
        years.push({ year: y, minutes: m });
        if (m > maxYearMinutes) maxYearMinutes = m;
      }
    }

    return {
      count: sessions.length,
      totalMinutes,
      totalCost,
      vehicleCount: vehicles.size,
      years,
      maxYearMinutes,
      recent: sessions.slice(0, 10),
    };
  }, [sessions]);

  // Self-guard: nothing until loaded, null forever when the substrate is empty
  if (!loaded) return null;
  if (!agg || agg.count === 0) return null;

  const stats: Array<{ value: string; label: string }> = [
    { value: String(agg.count), label: 'SESSIONS' },
    { value: fmtHours(agg.totalMinutes), label: 'HRS' },
    { value: String(agg.vehicleCount), label: 'VEHICLES' },
  ];
  if (isOwnProfile && agg.totalCost > 0) {
    stats.push({ value: fmtCostK(agg.totalCost), label: 'JOB COST' });
  }

  return (
    <div
      className="up-work-ledger"
      style={{
        border: `2px solid ${INK}`,
        padding: '12px',
        marginBottom: '8px',
        fontFamily: 'Arial, sans-serif',
        color: INK,
      }}
      data-user-id={userId}
      data-session-count={agg.count}
    >
      {/* Card label */}
      <div
        style={{
          fontSize: '9px',
          fontWeight: 700,
          letterSpacing: '0.1em',
          marginBottom: '8px',
          paddingBottom: '6px',
          borderBottom: `1px solid ${INK}`,
        }}
      >
        WORK LEDGER
      </div>

      {/* (a) Headline stat row — Courier New */}
      <div
        style={{
          display: 'flex',
          gap: '16px',
          flexWrap: 'wrap',
          marginBottom: '12px',
        }}
      >
        {stats.map((s) => (
          <div key={s.label}>
            <div style={{ fontFamily: MONO, fontSize: '16px', fontWeight: 700, lineHeight: 1.1 }}>
              {s.value}
            </div>
            <div style={{ fontSize: '8px', color: '#666', letterSpacing: '0.1em' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* (b) Per-year hours — flat 2px-bordered horizontal bars */}
      {agg.years.length > 0 && agg.maxYearMinutes > 0 && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '8px', color: '#666', letterSpacing: '0.1em', marginBottom: '4px' }}>
            HOURS BY YEAR
          </div>
          {agg.years.map(({ year, minutes }) => {
            const pct = Math.round((minutes / agg.maxYearMinutes) * 100);
            const hrs = minutes / 60;
            return (
              <div
                key={year}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}
              >
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: '9px',
                    width: '32px',
                    flexShrink: 0,
                    textAlign: 'right',
                  }}
                >
                  {year}
                </span>
                <div style={{ flex: 1, position: 'relative', height: '10px' }}>
                  {minutes > 0 && (
                    <div
                      style={{
                        width: `${Math.max(pct, 2)}%`,
                        height: '10px',
                        background: INK,
                        border: `2px solid ${INK}`,
                        boxSizing: 'border-box',
                      }}
                    />
                  )}
                </div>
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: '9px',
                    width: '44px',
                    flexShrink: 0,
                    textAlign: 'right',
                    color: minutes > 0 ? INK : '#999',
                  }}
                >
                  {minutes > 0 ? `${hrs >= 100 ? Math.round(hrs) : hrs.toFixed(1)}h` : '—'}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* (c) Recent 10 sessions — dense rows */}
      {agg.recent.length > 0 && (
        <div>
          <div style={{ fontSize: '8px', color: '#666', letterSpacing: '0.1em', marginBottom: '4px' }}>
            RECENT SESSIONS
          </div>
          {agg.recent.map((s, i) => {
            const label = s.title || s.work_type || 'work session';
            const hrs = (s.duration_minutes || 0) / 60;
            return (
              <div
                key={`${s.session_date}-${i}`}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: '8px',
                  padding: '2px 0',
                  borderBottom: i < agg.recent.length - 1 ? '1px solid #e5e5e5' : 'none',
                  fontSize: '10px',
                }}
              >
                <span style={{ fontFamily: MONO, fontSize: '9px', flexShrink: 0, color: '#666' }}>
                  {fmtDate(s.session_date)}
                </span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={label}
                >
                  {s.vehicle_id ? (
                    <a
                      href={`/vehicle/${s.vehicle_id}`}
                      style={{ color: INK, textDecoration: 'none' }}
                    >
                      {label}
                    </a>
                  ) : (
                    label
                  )}
                </span>
                <span
                  style={{ fontFamily: MONO, fontSize: '9px', flexShrink: 0, textAlign: 'right' }}
                >
                  {hrs > 0 ? `${hrs.toFixed(1)}h` : '—'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default UserWorkLedger;
