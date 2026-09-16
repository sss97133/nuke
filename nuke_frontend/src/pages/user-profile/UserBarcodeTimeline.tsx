import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useUserProfile } from './UserProfileContext';
import { supabase } from '../../lib/supabase';
import { getThumbnailUrl } from '../../lib/imageOptimizer';
import type { ContributionEvent } from './types';
import '../../styles/barcode-timeline.css';

/**
 * UserBarcodeTimeline -- Contribution heatmap adapted from VehicleBarcodeTimeline.
 *
 * Shares barcode-strip / hm-* CSS with the vehicle profile via
 * styles/barcode-timeline.css (imported above — previously these classes lived
 * only in vehicle-profile.css's lazy chunk and were unstyled on /profile).
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

// Skill-fingerprint doctrine: a pill renders ONLY when its facet has data
// (count > 0 from the ALL set). The set below is the open superset — what a
// given profile shows is what that user IS.
const FILTERS: FilterDef[] = [
  { key: 'all', label: 'ALL', match: () => true },
  { key: 'photos', label: 'PHOTOS', match: (ev) => ev.type === 'image_upload' },
  {
    key: 'vehicles',
    label: 'VEHICLES',
    match: (ev) => ev.type === 'vehicle_added' || ev.type === 'timeline_event',
  },
  { key: 'work', label: 'WORK', match: (ev) => ev.type === 'work' },
  { key: 'auctions', label: 'AUCTIONS', match: (ev) => ev.type === 'auction_activity' },
  { key: 'business', label: 'BUSINESS', match: (ev) => ev.type === 'business_event' },
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

function formatDayHeader(ds: string): string {
  const d = new Date(ds + 'T00:00:00');
  if (isNaN(d.getTime())) return ds;
  return d.toDateString().toUpperCase(); // e.g. "FRI JUN 06 2026"
}

function formatMinutes(min: number | null | undefined): string {
  const m = Number(min) || 0;
  if (m <= 0) return '';
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h > 0) return rem > 0 ? `${h}H ${rem}M` : `${h}H`;
  return `${rem}M`;
}

function formatMoney(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '';
  return `$${Math.round(v).toLocaleString()}`;
}

// ── Interfaces ──

// Grid cells are STRUCTURE ONLY (date string); counts/colors are resolved at
// render from the filtered map so filter clicks never rebuild the grid.
interface WeekCol {
  days: (string | null)[];
  monthLabel?: string;
}

// Shape of get_user_day_receipt(p_user_id, p_date) → jsonb
interface DayReceiptPhoto {
  id: string;
  url: string;
  thumb: string;
  vehicle_id: string | null;
  taken_at: string | null;
}
interface DayReceiptWork {
  id: string;
  title: string;
  vehicle_id: string | null;
  duration_minutes: number | null;
  total_job_cost: number | null;
}
interface DayReceiptRow {
  id: string;
  vendor: string | null;
  total: number | null;
  vehicle_id?: string | null;
}
interface DayReceipt {
  date: string;
  is_owner_view: boolean;
  photos: DayReceiptPhoto[];
  work_sessions: DayReceiptWork[];
  receipts: DayReceiptRow[];
  facets: { photos: number; work: number; receipts: number };
}

// ── Component ──

const UserBarcodeTimeline: React.FC = () => {
  const { userId, contributionEvents } = useUserProfile();
  const [expanded, setExpanded] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all');
  const [receiptDate, setReceiptDate] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<DayReceipt | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const receiptCache = useRef<Map<string, DayReceipt>>(new Map());
  const drawerRef = useRef<HTMLDivElement>(null);
  const heatmapRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  // ── PINNED WINDOW (vehicle BarcodeTimeline pattern) ──
  // allMap is built from ALL contribution events exactly once. The date range,
  // week grid, and collapsed barcode all derive from allMap ONLY — filter
  // clicks re-color the same fixed grid (filteredMap) and can never move it.

  const allMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const ev of contributionEvents) {
      if (!ev.date) continue;
      const key = ev.date.slice(0, 10);
      map.set(key, (map.get(key) || 0) + (ev.count || 1));
    }
    return map;
  }, [contributionEvents]);

  // ── Filter counts from the ALL set — pills show totals, never shift ──
  const filterCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of FILTERS) {
      let n = 0;
      for (const ev of contributionEvents) {
        if (f.match(ev)) n += ev.count || 1;
      }
      counts[f.key] = n;
    }
    return counts;
  }, [contributionEvents]);

  // If a data reload empties the active facet, fall back to ALL.
  useEffect(() => {
    if (activeFilter !== 'all' && !(filterCounts[activeFilter] > 0)) {
      setActiveFilter('all');
    }
  }, [filterCounts, activeFilter]);

  // ── Filtered map: colors only ──
  const filteredMap = useMemo(() => {
    if (activeFilter === 'all') return allMap;
    const filterDef = FILTERS.find((f) => f.key === activeFilter) || FILTERS[0];
    const map = new Map<string, number>();
    for (const ev of contributionEvents) {
      if (!ev.date || !filterDef.match(ev)) continue;
      const key = ev.date.slice(0, 10);
      map.set(key, (map.get(key) || 0) + (ev.count || 1));
    }
    return map;
  }, [contributionEvents, activeFilter, allMap]);

  // ── Date range — from the ALL set ONLY, never the filtered set ──
  // Range clamp ported from the vehicle BarcodeTimeline: (1) events dated
  // before 2000 are bogus EXIF (camera-default 1981 phantoms) and are ignored;
  // (2) the start year floors at the first year with >=10 events so a handful
  // of stray early dates can't stretch the strip into a decade of empty space.
  const { startDate, endDate } = useMemo(() => {
    const today = new Date();
    if (contributionEvents.length === 0) return { startDate: today, endDate: today };

    const MIN_VALID_YEAR = 2000;
    const MIN_EVENTS_PER_YEAR = 10;

    const yearCounts = new Map<number, number>();
    for (const ev of contributionEvents) {
      const d = ev.date?.slice(0, 10);
      if (!d) continue;
      const y = Number(d.slice(0, 4));
      if (!Number.isFinite(y) || y < MIN_VALID_YEAR) continue;
      yearCounts.set(y, (yearCounts.get(y) || 0) + (ev.count || 1));
    }
    if (yearCounts.size === 0) return { startDate: today, endDate: today };

    const years = Array.from(yearCounts.keys()).sort((a, b) => a - b);
    const firstDenseYear =
      years.find((y) => (yearCounts.get(y) || 0) >= MIN_EVENTS_PER_YEAR) ?? years[0];

    return {
      startDate: new Date(firstDenseYear, 0, 1),
      endDate: today,
    };
  }, [contributionEvents]);

  // ── Level assignment — quantile thresholds computed ONCE per filtered map
  // (the old levelFor sorted the whole map on every cell: O(n² log n)) ──
  const levelThresholds = useMemo(() => {
    const counts = Array.from(filteredMap.values()).sort((a, b) => a - b);
    if (counts.length === 0) return null;
    return {
      p25: counts[Math.floor(counts.length * 0.25)] || 1,
      p50: counts[Math.floor(counts.length * 0.5)] || 1,
      p75: counts[Math.floor(counts.length * 0.75)] || 1,
    };
  }, [filteredMap]);

  const levelFor = useCallback(
    (count: number): number => {
      if (count === 0) return 0;
      if (!levelThresholds) return 1;
      if (count >= levelThresholds.p75) return 4;
      if (count >= levelThresholds.p50) return 3;
      if (count >= levelThresholds.p25) return 2;
      return 1;
    },
    [levelThresholds],
  );

  // ── Build collapsed barcode stripes — from the ALL set (always everything) ──
  const barcodeWeeks = useMemo(() => {
    const ws = startOfWeek(startDate);
    const weeks: { stripes: number[] }[] = [];
    let cursor = new Date(ws);
    while (cursor <= endDate) {
      const stripes: number[] = [];
      for (let d = 0; d < 7; d++) {
        const key = toDateStr(cursor);
        const count = allMap.get(key) || 0;
        stripes.push(count > 0 ? 1 : 0);
        cursor = addDays(cursor, 1);
      }
      weeks.push({ stripes });
    }
    return weeks;
  }, [startDate, endDate, allMap]);

  // ── Build expanded heatmap weeks — STRUCTURE ONLY (date strings).
  // Depends solely on the pinned range: a filter click does not touch this
  // memo, so the grid, its scroll position, and the auto-scroll effect below
  // are all undisturbed. Cell counts/colors come from filteredMap at render.
  const heatmapWeeks = useMemo((): WeekCol[] => {
    const ws = startOfWeek(startDate);
    const weeks: WeekCol[] = [];
    let cursor = new Date(ws);
    let prevMonth = -1;

    while (cursor <= endDate) {
      const days: (string | null)[] = [];
      let monthLabel: string | undefined;

      for (let d = 0; d < 7; d++) {
        if (cursor < startDate || cursor > endDate) {
          days.push(null);
        } else {
          days.push(toDateStr(cursor));

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
  }, [startDate, endDate]);

  // ── Year range label ──
  const yearRange = useMemo(() => {
    const sy = startDate.getFullYear();
    const ey = endDate.getFullYear();
    return sy === ey ? String(sy) : `${sy}-${ey}`;
  }, [startDate, endDate]);

  // ── Auto-scroll heatmap to right (newest) when expanded ──
  // Must also re-fire when the week grid grows: contribution events load
  // async, so on first paint scrollWidth covers an empty grid and a
  // single-fire on [expanded] left the user parked at the left edge
  // (vehicle BarcodeTimeline fix — deps [expanded, weeks.length]).
  useEffect(() => {
    if (expanded && heatmapRef.current) {
      const el = heatmapRef.current;
      requestAnimationFrame(() => {
        el.scrollLeft = el.scrollWidth;
      });
    }
  }, [expanded, heatmapWeeks.length]);

  // ── Collapse on scroll down, re-expand at top ──
  useEffect(() => {
    if (!expanded) return;
    let lastY = window.scrollY;

    const onScroll = () => {
      const y = window.scrollY;
      if (y > lastY + 20 && expanded) {
        setExpanded(false);
        setReceiptDate(null);
      }
      lastY = y;
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [expanded]);

  // ── Escape: close the drawer first, then the strip ──
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (receiptDate) setReceiptDate(null);
      else setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded, receiptDate]);

  // ── Click-out closes the drawer (cell clicks are handled by handleDayClick) ──
  useEffect(() => {
    if (!receiptDate) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (drawerRef.current?.contains(t)) return;
      if (t.closest('.hm-c')) return; // day cells toggle/switch themselves
      setReceiptDate(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [receiptDate]);

  // ── Day click -> inline day-receipt drawer (toggle on same day) ──
  const handleDayClick = useCallback((date: string) => {
    setReceiptDate((cur) => (cur === date ? null : date));
  }, []);

  const toggleExpanded = useCallback(() => {
    setExpanded((v) => !v);
    setReceiptDate(null);
  }, []);

  // ── Fetch the day receipt (cached per date for the session) ──
  useEffect(() => {
    if (!receiptDate || !userId) return;
    const cached = receiptCache.current.get(receiptDate);
    if (cached) {
      setReceipt(cached);
      setReceiptLoading(false);
      return;
    }
    let cancelled = false;
    setReceipt(null);
    setReceiptLoading(true);
    supabase
      .rpc('get_user_day_receipt', { p_user_id: userId, p_date: receiptDate })
      .then(({ data, error }) => {
        if (cancelled) return;
        setReceiptLoading(false);
        if (error || !data) {
          // Don't render a lying "NO ACTIVITY" on an RPC failure — just close.
          setReceiptDate(null);
          return;
        }
        receiptCache.current.set(receiptDate, data as DayReceipt);
        setReceipt(data as DayReceipt);
      });
    return () => {
      cancelled = true;
    };
  }, [receiptDate, userId]);

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
        <div className="barcode-bar" onClick={toggleExpanded}>
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
          {/* Filter pills — adaptive: only facets with data render (skill
              fingerprint, not navigation). Counts come from the ALL set so
              the pill row itself never changes on filter clicks. */}
          <div className="timeline-filter-pills">
            {FILTERS.filter((f) => (filterCounts[f.key] || 0) > 0).map((f) => (
              <button
                key={f.key}
                className={`timeline-filter-pill${activeFilter === f.key ? ' timeline-filter-pill--active' : ''}`}
                onClick={() => setActiveFilter(f.key)}
              >
                {f.label} ({filterCounts[f.key]})
              </button>
            ))}
          </div>

          {/* Heatmap grid — same structure as vehicle BarcodeTimeline:
              day labels are a sibling BEFORE .hm-wrap, month labels render
              inside each .hm-week column after its day cells */}
          <div className="timeline-heatmap" ref={heatmapRef}>
            <div className="hm-day-labels">
              {DAY_LABELS.map((lbl, i) => (
                <span key={i}>{i % 2 === 1 ? lbl : ''}</span>
              ))}
            </div>
            <div className="hm-wrap">
              {/* Week columns — structure is pinned; only colors react to the
                  active filter (count/level resolved from filteredMap here) */}
              {heatmapWeeks.map((week, wi) => (
                <div key={wi} className="hm-week">
                  {week.days.map((date, di) => {
                    if (!date) {
                      return <div key={di} className="hm-c empty" />;
                    }
                    const count = filteredMap.get(date) || 0;
                    const level = levelFor(count);
                    return (
                      <div
                        key={di}
                        className={`hm-c${level > 0 ? ` l${level}` : ''}`}
                        data-date={date}
                        data-count={count}
                        title={`${date}: ${count} event${count !== 1 ? 's' : ''}`}
                        onClick={() => handleDayClick(date)}
                      />
                    );
                  })}
                  {/* Month label — inside the week column, vehicle-style */}
                  {week.monthLabel && (
                    <span className="hm-month-inline">{week.monthLabel}</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Day-receipt drawer — the end layer. Inline below the grid, stays
              in context. Empty day = one tiny line, never an empty shell. */}
          {receiptDate && (
            <div ref={drawerRef} className="up-day-receipt">
              <div className="up-day-receipt__header">
                <span>{formatDayHeader(receiptDate)}</span>
                <button
                  className="up-day-receipt__close"
                  onClick={() => setReceiptDate(null)}
                  aria-label="Close day receipt"
                >
                  ✕
                </button>
              </div>

              {receiptLoading && (
                <div className="up-day-receipt__empty">LOADING…</div>
              )}

              {!receiptLoading && receipt && (
                (receipt.facets.photos + receipt.facets.work + receipt.facets.receipts) === 0 ? (
                  <div className="up-day-receipt__empty">NO ACTIVITY</div>
                ) : (
                  <>
                    {/* Facet chips — only the facets this day touched */}
                    <div className="up-day-receipt__facets">
                      {receipt.facets.photos > 0 && (
                        <span className="up-day-receipt__facet">PHOTOS {receipt.facets.photos}</span>
                      )}
                      {receipt.facets.work > 0 && (
                        <span className="up-day-receipt__facet">WORK {receipt.facets.work}</span>
                      )}
                      {receipt.facets.receipts > 0 && (
                        <span className="up-day-receipt__facet">RECEIPTS {receipt.facets.receipts}</span>
                      )}
                    </div>

                    {/* Photo thumb strip — lazy; click-through to the full-page
                        day receipt at /journal/:date */}
                    {receipt.photos.length > 0 && (
                      <div className="up-day-receipt__photos">
                        {receipt.photos.map((p) => (
                          <Link key={p.id} to={`/journal/${receiptDate}`}>
                            <img
                              src={getThumbnailUrl(p.thumb) || p.thumb}
                              loading="lazy"
                              alt=""
                            />
                          </Link>
                        ))}
                      </div>
                    )}

                    {/* Work lines — hours always; dollars owner-only (the RPC
                        already nulls cost for visitors; gate again here) */}
                    {receipt.work_sessions.map((w) => {
                      const hrs = formatMinutes(w.duration_minutes);
                      const cost = receipt.is_owner_view ? formatMoney(w.total_job_cost) : '';
                      return (
                        <div className="up-day-receipt__line" key={w.id}>
                          <span className="up-day-receipt__line-label">{w.title}</span>
                          <span className="up-day-receipt__line-value">
                            {[hrs, cost].filter(Boolean).join(' · ') || '—'}
                          </span>
                        </div>
                      );
                    })}

                    {/* Receipt lines — RPC returns [] for visitors */}
                    {receipt.receipts.map((r) => (
                      <div className="up-day-receipt__line" key={r.id}>
                        <span className="up-day-receipt__line-label">
                          {(r.vendor || 'RECEIPT').toUpperCase()}
                        </span>
                        <span className="up-day-receipt__line-value">
                          {formatMoney(r.total) || '—'}
                        </span>
                      </div>
                    ))}
                  </>
                )
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default UserBarcodeTimeline;
