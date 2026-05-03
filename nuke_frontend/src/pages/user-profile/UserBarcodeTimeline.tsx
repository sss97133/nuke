import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useUserProfile } from './UserProfileContext';
import type { ContributionEvent } from './types';

/**
 * UserBarcodeTimeline -- Contribution heatmap adapted from VehicleBarcodeTimeline.
 *
 * Reuses barcode-strip / hm-* CSS classes from vehicle-profile.css.
 * Sticky position comes from a wrapper div using --up-stick-barcode token.
 */

// ── Colour scale ──

const BARCODE_COLORS: Record<number, string> = {
  0: 'transparent',
  1: 'var(--heat-2, #a7f3d0)',
  2: 'var(--heat-3, #34d399)',
  3: 'var(--heat-4, #059669)',
  4: 'var(--heat-5, #047857)',
};

// ── Filter definitions ──

interface FilterDef {
  key: string;
  label: string;
  match: (ev: ContributionEvent) => boolean;
}

const FILTERS: FilterDef[] = [
  { key: 'all', label: 'ALL', match: () => true },
  { key: 'photos', label: 'PHOTOS', match: (ev) => ev.type === 'image_upload' },
  {
    key: 'vehicles',
    label: 'VEHICLES',
    match: (ev) => ev.type === 'vehicle_added' || ev.type === 'timeline_event',
  },
  { key: 'auctions', label: 'AUCTIONS', match: (ev) => ev.type === 'auction_activity' },
  { key: 'comments', label: 'COMMENTS', match: (ev) => ev.type === 'comment' },
];

// ── Helpers ──

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function startOfWeek(d: Date): Date {
  const r = new Date(d);
  r.setDate(r.getDate() - r.getDay());
  return r;
}

const MONTH_LABELS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// ── Interfaces ──

interface EventDay {
  date: string;
  count: number;
  level: number; // 0-4
}

interface WeekCol {
  days: (EventDay | null)[];
  monthLabel?: string;
}

// ── Component ──

const UserBarcodeTimeline: React.FC = () => {
  const { contributionEvents, setGalleryFilter } = useUserProfile();
  const [expanded, setExpanded] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all');
  const heatmapRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  // ── Filter events ──
  const filteredEvents = useMemo(() => {
    const filterDef = FILTERS.find((f) => f.key === activeFilter) || FILTERS[0];
    return contributionEvents.filter(filterDef.match);
  }, [contributionEvents, activeFilter]);

  // ── Build event map: date -> count ──
  const eventMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const ev of filteredEvents) {
      if (!ev.date) continue;
      const key = ev.date.slice(0, 10);
      map.set(key, (map.get(key) || 0) + (ev.count || 1));
    }
    return map;
  }, [filteredEvents]);

  // ── Date range ──
  const { startDate, endDate } = useMemo(() => {
    if (filteredEvents.length === 0) return { startDate: new Date(), endDate: new Date() };
    const dates = filteredEvents
      .map((e: ContributionEvent) => e.date?.slice(0, 10))
      .filter((d): d is string => Boolean(d))
      .sort();
    return {
      startDate: new Date(dates[0]!),
      endDate: new Date(),
    };
  }, [filteredEvents]);

  // ── Level assignment (quantile-ish) ──
  const levelFor = useCallback(
    (count: number): number => {
      if (count === 0) return 0;
      const counts = Array.from(eventMap.values()).sort((a, b) => a - b);
      if (counts.length === 0) return 1;
      const p75 = counts[Math.floor(counts.length * 0.75)] || 1;
      const p50 = counts[Math.floor(counts.length * 0.5)] || 1;
      const p25 = counts[Math.floor(counts.length * 0.25)] || 1;
      if (count >= p75) return 4;
      if (count >= p50) return 3;
      if (count >= p25) return 2;
      return 1;
    },
    [eventMap],
  );

  // ── Build collapsed barcode stripes ──
  const barcodeWeeks = useMemo(() => {
    const ws = startOfWeek(startDate);
    const weeks: { stripes: number[] }[] = [];
    let cursor = new Date(ws);
    while (cursor <= endDate) {
      const stripes: number[] = [];
      for (let d = 0; d < 7; d++) {
        const key = toDateStr(cursor);
        const count = eventMap.get(key) || 0;
        stripes.push(count > 0 ? 1 : 0);
        cursor = addDays(cursor, 1);
      }
      weeks.push({ stripes });
    }
    return weeks;
  }, [startDate, endDate, eventMap]);

  // ── Build expanded heatmap weeks ──
  const heatmapWeeks = useMemo((): WeekCol[] => {
    const ws = startOfWeek(startDate);
    const weeks: WeekCol[] = [];
    let cursor = new Date(ws);
    let prevMonth = -1;

    while (cursor <= endDate) {
      const days: (EventDay | null)[] = [];
      let monthLabel: string | undefined;

      for (let d = 0; d < 7; d++) {
        if (cursor < startDate || cursor > endDate) {
          days.push(null);
        } else {
          const key = toDateStr(cursor);
          const count = eventMap.get(key) || 0;
          days.push({ date: key, count, level: levelFor(count) });

          // Month label on first occurrence of new month
          if (cursor.getMonth() !== prevMonth && d <= 1) {
            monthLabel = MONTH_LABELS[cursor.getMonth()];
            prevMonth = cursor.getMonth();
          }
        }
        cursor = addDays(cursor, 1);
      }
      weeks.push({ days, monthLabel });
    }
    return weeks;
  }, [startDate, endDate, eventMap, levelFor]);

  // ── Year range label ──
  const yearRange = useMemo(() => {
    const sy = startDate.getFullYear();
    const ey = endDate.getFullYear();
    return sy === ey ? String(sy) : `${sy}-${ey}`;
  }, [startDate, endDate]);

  // ── Auto-scroll heatmap to right when expanded ──
  useEffect(() => {
    if (expanded && heatmapRef.current) {
      const el = heatmapRef.current;
      requestAnimationFrame(() => {
        el.scrollLeft = el.scrollWidth;
      });
    }
  }, [expanded]);

  // ── Collapse on scroll down, re-expand at top ──
  useEffect(() => {
    if (!expanded) return;
    let lastY = window.scrollY;

    const onScroll = () => {
      const y = window.scrollY;
      if (y > lastY + 20 && expanded) {
        setExpanded(false);
      }
      lastY = y;
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [expanded]);

  // ── Escape to close ──
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  // ── Day click -> set gallery filter ──
  const handleDayClick = useCallback(
    (date: string) => {
      setGalleryFilter({ dateRange: [date, date] });
    },
    [setGalleryFilter],
  );

  // ── Self-guard ──
  if (contributionEvents.length === 0) return null;

  return (
    <div
      ref={stripRef}
      style={{
        position: 'sticky',
        top: 'var(--up-stick-barcode)',
        zIndex: 898,
      }}
    >
      <div
        className={`barcode-strip ${expanded ? 'barcode-strip--expanded' : 'barcode-strip--collapsed'}`}
      >
        {/* Collapsed bar */}
        <div className="barcode-bar" onClick={() => setExpanded((v) => !v)}>
          <span className="barcode-bar__label-left">TIMELINE</span>
          <span className="barcode-bar__label-right">{yearRange}</span>
          <div className="barcode-canvas">
            {barcodeWeeks.map((week, wi) => (
              <div key={wi} className="barcode-stripe">
                <div
                  className="barcode-stripe__fill"
                  style={{
                    background: week.stripes.some((s) => s > 0)
                      ? BARCODE_COLORS[2]
                      : 'transparent',
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Expanded heatmap */}
        <div className="barcode-heatmap">
          {/* Filter pills */}
          <div
            style={{
              display: 'flex',
              gap: '6px',
              marginBottom: '8px',
              flexWrap: 'wrap',
            }}
          >
            {FILTERS.map((f) => (
              <button
                key={f.key}
                className="up-btn"
                style={{
                  background: activeFilter === f.key ? '#1a1a1a' : 'transparent',
                  color: activeFilter === f.key ? '#fff' : '#1a1a1a',
                  fontSize: '7px',
                  padding: '2px 6px',
                }}
                onClick={() => setActiveFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Heatmap grid */}
          <div className="timeline-heatmap" ref={heatmapRef}>
            <div className="hm-wrap">
              {/* Day-of-week labels */}
              <div className="hm-day-labels">
                {DAY_LABELS.map((lbl, i) => (
                  <span key={i} style={{ height: 11 }}>
                    {i % 2 === 1 ? lbl : ''}
                  </span>
                ))}
              </div>

              {/* Week columns */}
              {heatmapWeeks.map((week, wi) => (
                <div key={wi} className="hm-week">
                  {/* Month label */}
                  {week.monthLabel && (
                    <div className="hm-month-inline">{week.monthLabel}</div>
                  )}
                  {week.days.map((day, di) => {
                    if (!day) {
                      return <div key={di} className="hm-c empty" />;
                    }
                    const levelClass =
                      day.level === 0
                        ? ''
                        : day.level === 1
                          ? 'l1'
                          : day.level === 2
                            ? 'l2'
                            : day.level === 3
                              ? 'l3'
                              : 'l4';
                    return (
                      <div
                        key={di}
                        className={`hm-c ${levelClass}`}
                        data-date={day.date}
                        data-count={day.count}
                        title={`${day.date}: ${day.count} event${day.count !== 1 ? 's' : ''}`}
                        onClick={() => handleDayClick(day.date)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserBarcodeTimeline;
