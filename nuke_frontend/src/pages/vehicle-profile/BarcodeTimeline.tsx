import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useVehicleProfile } from './VehicleProfileContext';

interface BarcodeTimelineProps {}


interface EventDay {
  date: string;
  label: string;
  level: number;
  items: { k: string; v: string }[];
  total: string;
  group?: string;
  groupDay?: number;
  groupTotal?: string;
}

function dateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Normalize to YYYY-MM-DD in local timezone so midnight UTC doesn't shift days. */
function toDateOnly(d: string | undefined): string | null {
  if (!d) return null;
  const date = new Date(String(d).trim());
  if (isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-CA'); // YYYY-MM-DD in local tz
}

/** Merge adjacent days that belong to the same session (spanning midnight). */
function mergeAdjacentSessions(map: Record<string, EventDay>): void {
  const sorted = Object.keys(map).sort();
  for (let i = 0; i < sorted.length - 1; i++) {
    const dayA = sorted[i];
    const dayB = sorted[i + 1];
    const evA = map[dayA];
    const evB = map[dayB];
    if (!evA || !evB) continue;

    // Check if dayB is the next calendar day
    const dA = new Date(dayA + 'T12:00:00');
    const dB = new Date(dayB + 'T12:00:00');
    const diffMs = dB.getTime() - dA.getTime();
    if (diffMs < 0 || diffMs > 2 * 86400000) continue; // not adjacent

    // If dayA has late events (after 8pm) and dayB has early events (before 8am), merge
    const hasLateA = evA.items.length > 0; // simplified: if adjacent days both have events, merge
    const hasEarlyB = evB.items.length > 0;
    if (hasLateA && hasEarlyB && diffMs <= 86400000) {
      const groupId = evA.group || dayA;
      evA.group = groupId;
      evB.group = groupId;

      // Build session label: "Oct 9-10, 2023"
      const startDate = new Date(dayA + 'T12:00:00');
      const endDate = new Date(dayB + 'T12:00:00');
      const startMonth = startDate.toLocaleDateString('en-US', { month: 'short' });
      const endMonth = endDate.toLocaleDateString('en-US', { month: 'short' });
      const year = endDate.getFullYear();

      const sessionLabel = startMonth === endMonth
        ? `${startMonth} ${startDate.getDate()}-${endDate.getDate()}, ${year}`
        : `${startMonth} ${startDate.getDate()} - ${endMonth} ${endDate.getDate()}, ${year}`;

      // Set group metadata on all days in this group
      const groupDays = Object.keys(map).filter(k => map[k].group === groupId).sort();
      groupDays.forEach((k, idx) => {
        map[k].groupDay = idx + 1;
        map[k].groupTotal = String(groupDays.length);
      });

      // Combine totals
      const totalCost = groupDays.reduce((sum, k) => {
        const t = map[k].total;
        if (t === '—') return sum;
        return sum + parseFloat(t.replace(/[$,]/g, ''));
      }, 0);
      const combinedTotal = totalCost > 0 ? `$${Math.round(totalCost).toLocaleString()}` : '—';
      groupDays.forEach(k => { map[k].groupTotal = combinedTotal; });
    }
  }
}

const EVENT_LABELS: Record<string, string> = {
  auction_listed: 'Listed for Sale',
  auction_sold: 'Sold',
  auction_started: 'Auction Started',
  auction_ended: 'Auction Ended',
  vehicle_added: 'Profile Created',
  mileage_reading: 'Mileage Recorded',
  repair: 'Repair',
  modification: 'Modification',
  maintenance: 'Maintenance',
  inspection: 'Inspection',
  purchase: 'Purchased',
  sale: 'Sold',
  registration: 'Registered',
  insurance: 'Insurance',
  photo_session: 'Photo Session',
  other: 'Activity',
};

const SOURCE_PLATFORM_LABELS: Record<string, string> = {
  bat: 'BaT',
  bat_import: 'BaT',
  craigslist: 'Craigslist',
  craigslist_listing: 'Craigslist',
  facebook_marketplace: 'FB Marketplace',
  mecum: 'Mecum',
  pcarmarket: 'PCarMarket',
  hagerty: 'Hagerty',
  gooding: 'Gooding',
  broad_arrow: 'Broad Arrow',
  bonhams: 'Bonhams',
};

/** Context-aware human-readable event label. */
function formatEventLabel(ev: any): string {
  const eventType = String(ev.event_type || ev.category || 'event').trim().toLowerCase();
  const source = String(ev.source || '').trim().toLowerCase();
  const sourceType = String(ev.source_type || '').trim().toLowerCase();
  const dataSource = String(ev.data_source || '').trim().toLowerCase();
  const platform = SOURCE_PLATFORM_LABELS[source] || SOURCE_PLATFORM_LABELS[dataSource] || '';

  // System-ingested / extracted data: prefix with "Discovered on"
  const isSystemIngested = sourceType === 'system' || dataSource.startsWith('extract');

  // Photo session: show session type if available in metadata
  if (eventType === 'photo_session') {
    const sessionType = ev.metadata?.session_type_label || ev.metadata?.session_type_key;
    if (sessionType) return `Photo Session: ${String(sessionType).replace(/_/g, ' ')}`;
    const count = ev.metadata?.image_count || (Array.isArray(ev.image_urls) ? ev.image_urls.length : 0);
    if (count > 0) return `Photo Session (${count} photos)`;
    return 'Photo Session';
  }

  if (eventType === 'vehicle_added') {
    if (platform) return `Added via ${platform}`;
    if (ev.user_id) return 'Added by User';
    return 'Profile Created';
  }

  if (eventType === 'auction_listed') {
    if (platform) return isSystemIngested ? `Discovered on ${platform}` : `Listed on ${platform}`;
    return isSystemIngested ? 'Discovered Listing' : 'Listed for Sale';
  }

  if (eventType === 'auction_sold' && platform) return `Sold on ${platform}`;

  const base = EVENT_LABELS[eventType];
  if (base) return base;

  // Fallback: title-case the raw string
  const raw = ev.title || ev.event_type || ev.category || 'Event';
  return String(raw).trim().replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase());
}

function formatDate(ds: string): string {
  try {
    const d = new Date(ds + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return ds;
  }
}

const BARCODE_COLORS: Record<number, string> = {
  0: 'transparent',
  1: 'var(--heat-2, #a7f3d0)',
  2: 'var(--heat-3, #34d399)',
  3: 'var(--heat-4, #059669)',
  4: 'var(--heat-5, #047857)',
};

const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const BarcodeTimeline: React.FC<BarcodeTimelineProps> = () => {
  const { vehicle, timelineEvents } = useVehicleProfile();
  const [expanded, setExpanded] = useState(true);
  const [receiptDate, setReceiptDate] = useState<string | null>(null);
  const [receiptPos, setReceiptPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [tooltipContent, setTooltipContent] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [highlightGroup, setHighlightGroup] = useState<string | null>(null);
  const heatmapRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  // Build event data map from timelineEvents
  const { eventMap, startDate, endDate, weeks, sortedDates } = useMemo(() => {
    const map: Record<string, EventDay> = {};
    const currentYear = new Date().getFullYear();
    const vehicleYear = (vehicle as any).year || currentYear;

    for (const ev of timelineEvents) {
      const d = ev.event_date || ev.created_at;
      const ds = toDateOnly(d);
      if (!ds) continue;
      const label = formatEventLabel(ev);
      const costNum = ev.cost_amount != null ? Number(ev.cost_amount) : ev.cost != null ? Number(ev.cost) : null;
      const costStr = costNum != null && Number.isFinite(costNum) ? `$${Number(costNum).toLocaleString()}` : (() => {
        const urls = Array.isArray(ev.image_urls) ? ev.image_urls : [];
        const metaImages = Array.isArray((ev.metadata || {}).image_urls) ? (ev.metadata as any).image_urls : [];
        const count = urls.length || metaImages.length;
        if (count > 0) return `${count} photo${count === 1 ? '' : 's'}`;
        return '—';
      })();

      if (!map[ds]) {
        map[ds] = {
          date: ds,
          label,
          level: 1,
          items: [],
          total: '—',
        };
      }
      map[ds].items.push({
        k: formatEventLabel(ev),
        v: costStr,
      });

      // Accumulate cost (only dollar amounts; photo counts don't add to total)
      const existingTotal = map[ds].total === '—' ? 0 : parseFloat(map[ds].total.replace(/[$,]/g, ''));
      const newCost = costNum != null && Number.isFinite(costNum) ? costNum : 0;
      const sum = existingTotal + newCost;
      map[ds].total = sum > 0 ? `$${Math.round(sum).toLocaleString()}` : '—';

      // Bump level based on item count
      const itemCount = map[ds].items.length;
      if (itemCount >= 4) map[ds].level = 4;
      else if (itemCount >= 3) map[ds].level = 3;
      else if (itemCount >= 2) map[ds].level = 2;
      else map[ds].level = 1;
    }

    // Merge adjacent-day sessions spanning midnight
    mergeAdjacentSessions(map);

    // Date range
    const allYears = Object.keys(map).map((d) => new Date(d + 'T00:00:00').getFullYear());
    const minYear = Math.min(vehicleYear, ...allYears, currentYear - 3);
    const maxYear = Math.max(currentYear, ...allYears);

    const start = new Date(minYear, 0, 1);
    start.setDate(start.getDate() - start.getDay()); // align to Sunday
    const end = new Date(maxYear, 11, 31);

    // Build weeks for barcode
    const wks: { start: Date; level: number; events: { date: string; label: string }[] }[] = [];
    const cur = new Date(start);
    while (cur <= end) {
      let maxLevel = 0;
      const weekEvents: { date: string; label: string }[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(cur);
        const s = dateStr(d);
        if (map[s]) {
          if (map[s].level > maxLevel) maxLevel = map[s].level;
          weekEvents.push({ date: s, label: map[s].label });
        }
        cur.setDate(cur.getDate() + 1);
      }
      wks.push({ start: new Date(cur.getTime() - 7 * 86400000), level: maxLevel, events: weekEvents });
    }

    const sorted = Object.keys(map).sort();

    return {
      eventMap: map,
      startDate: start,
      endDate: end,
      weeks: wks,
      sortedDates: sorted,
    };
  }, [vehicle, timelineEvents]);

  // Heatmap weeks for expanded view
  const heatmapWeeks = useMemo(() => {
    const wks: { d: Date; s: string; inRange: boolean }[][] = [];
    const cur = new Date(startDate);
    const rangeStart = new Date(startDate);
    rangeStart.setDate(rangeStart.getDate() + rangeStart.getDay()); // first day in range

    while (cur <= endDate) {
      const w: { d: Date; s: string; inRange: boolean }[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(cur);
        w.push({ d, s: dateStr(d), inRange: d >= startDate && d <= endDate });
        cur.setDate(cur.getDate() + 1);
      }
      wks.push(w);
    }
    return wks;
  }, [startDate, endDate]);

  // Year range label
  const yearRange = useMemo(() => {
    const s = startDate.getFullYear();
    const e = endDate.getFullYear();
    return s === e ? String(s) : `${s}—${e}`;
  }, [startDate, endDate]);

  // Compressed heatmap: only show years that have events + current year, with gap indicators
  type HeatmapSegment =
    | { type: 'year'; year: number; weeks: { d: Date; s: string; inRange: boolean }[][]; weekOffset: number }
    | { type: 'gap'; gapYears: number; weekOffset: number };

  const { compressedHeatmap, compressedMonthLabels } = useMemo(() => {
    const currentYear = new Date().getFullYear();

    // Find which years have events, and which months within each year
    const eventYears = new Set<number>();
    const eventMonthsByYear: Record<number, Set<number>> = {};
    for (const ds of Object.keys(eventMap)) {
      const d = new Date(ds + 'T00:00:00');
      const yr = d.getFullYear();
      const mo = d.getMonth();
      eventYears.add(yr);
      if (!eventMonthsByYear[yr]) eventMonthsByYear[yr] = new Set();
      eventMonthsByYear[yr].add(mo);
    }
    // Always include current year for context
    eventYears.add(currentYear);

    const startYear = startDate.getFullYear();
    const endYear = endDate.getFullYear();

    // Group heatmapWeeks by year
    const weeksByYear: Record<number, { d: Date; s: string; inRange: boolean }[][]> = {};
    for (const week of heatmapWeeks) {
      // Use the Thursday of the week to determine which year (ISO week convention)
      const thursday = week[3] || week[0];
      if (!thursday) continue;
      const yr = thursday.d.getFullYear();
      if (!weeksByYear[yr]) weeksByYear[yr] = [];
      weeksByYear[yr].push(week);
    }

    // Trim year weeks to only include months with events +/- 1 month padding
    const trimWeeksToEventMonths = (yr: number, weeks: { d: Date; s: string; inRange: boolean }[][]): { d: Date; s: string; inRange: boolean }[][] => {
      const months = eventMonthsByYear[yr];
      if (!months || months.size === 0) return weeks; // current year with no events: show all
      const minMonth = Math.max(0, Math.min(...months) - 1);
      const maxMonth = Math.min(11, Math.max(...months) + 1);
      return weeks.filter((week) => {
        const thursday = week[3] || week[0];
        if (!thursday) return false;
        const mo = thursday.d.getMonth();
        return thursday.d.getFullYear() === yr && mo >= minMonth && mo <= maxMonth;
      });
    };

    // Build segments: include years with events, compress gaps
    const segments: HeatmapSegment[] = [];
    let weekOffset = 0;
    let gapStart: number | null = null;

    for (let yr = startYear; yr <= endYear; yr++) {
      const hasEvents = eventYears.has(yr);
      const yearWeeks = weeksByYear[yr] || [];

      if (!hasEvents && yearWeeks.length > 0) {
        // Empty year -- start or extend gap
        if (gapStart === null) gapStart = yr;
      } else {
        // Flush any accumulated gap
        if (gapStart !== null) {
          const gapYears = yr - gapStart;
          segments.push({ type: 'gap', gapYears, weekOffset });
          weekOffset += 1; // gap takes ~1 column width
          gapStart = null;
        }
        if (yearWeeks.length > 0) {
          const trimmed = trimWeeksToEventMonths(yr, yearWeeks);
          if (trimmed.length > 0) {
            segments.push({ type: 'year', year: yr, weeks: trimmed, weekOffset });
            weekOffset += trimmed.length;
          }
        }
      }
    }
    // Flush trailing gap
    if (gapStart !== null) {
      const gapYears = endYear - gapStart + 1;
      segments.push({ type: 'gap', gapYears, weekOffset });
    }

    // Build month labels for compressed layout
    const monthLabels: { key: string; left: number; label: string }[] = [];
    for (const seg of segments) {
      if (seg.type !== 'year') continue;
      seg.weeks.forEach((week, wi) => {
        const firstDay = week.find((d) => d.inRange && d.d.getDate() <= 7);
        if (firstDay && firstDay.d.getDate() <= 7) {
          const month = firstDay.d.getMonth();
          const year = firstDay.d.getFullYear();
          const key = `${year}-${month}`;
          if (!monthLabels.find((m) => m.key === key)) {
            monthLabels.push({
              key,
              left: (seg.weekOffset + wi) * 11 + 22,
              label: MONTH_NAMES[month] + ` ${year}`,
            });
          }
        }
      });
    }

    return { compressedHeatmap: segments, compressedMonthLabels: monthLabels };
  }, [heatmapWeeks, eventMap, startDate, endDate]);

  // Toggle expand
  const toggleExpand = useCallback(() => {
    setExpanded((prev) => {
      if (prev) {
        setReceiptDate(null);
        setHighlightGroup(null);
      }
      return !prev;
    });
  }, []);

  // Auto-scroll heatmap to right (most recent events) when expanded
  useEffect(() => {
    if (expanded && heatmapRef.current) {
      const scrollContainer = heatmapRef.current.querySelector('.timeline-heatmap') as HTMLElement;
      if (scrollContainer) {
        requestAnimationFrame(() => {
          scrollContainer.scrollLeft = scrollContainer.scrollWidth;
        });
      }
    }
  }, [expanded]);

  // Collapse on scroll down, re-expand when scrolled back to top
  useEffect(() => {
    const onScroll = () => {
      const atTop = window.scrollY <= 10;
      if (atTop && !expanded) {
        setExpanded(true);
      } else if (!atTop && expanded) {
        setExpanded(false);
        setReceiptDate(null);
        setHighlightGroup(null);
      }
    };
    // Defer so the expand click's own scroll doesn't immediately collapse
    const raf = requestAnimationFrame(() => {
      window.addEventListener('scroll', onScroll, { passive: true });
    });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
    };
  }, [expanded]);

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && expanded) {
        setExpanded(false);
        setReceiptDate(null);
        setHighlightGroup(null);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [expanded]);

  // Barcode stripe hover
  const onStripeMouseMove = useCallback(
    (e: React.MouseEvent, weekEvents: { date: string; label: string }[]) => {
      if (weekEvents.length === 0) {
        setTooltipContent(null);
        return;
      }
      const text = weekEvents.map((ev) => `${ev.date}  ${ev.label}`).join('\n');
      setTooltipContent(text);
      setTooltipPos({ x: e.clientX + 10, y: e.clientY - 28 });
    },
    []
  );

  const onStripeMouseLeave = useCallback(() => {
    setTooltipContent(null);
  }, []);

  // Heatmap cell click
  const onCellClick = useCallback(
    (ds: string, e: React.MouseEvent) => {
      const ev = eventMap[ds];
      if (!ev) return;
      setReceiptDate(ds);
      // Position receipt using viewport-relative coords (fixed positioning)
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      const POPUP_WIDTH = 290;
      setReceiptPos({
        x: Math.min(rect.left + rect.width + 4, window.innerWidth - POPUP_WIDTH - 8),
        y: rect.top,
      });
      // Highlight group if multi-day
      if (ev.group) {
        setHighlightGroup(ev.group);
      } else {
        setHighlightGroup(null);
      }
    },
    [eventMap]
  );

  // Receipt navigation
  const navigateReceipt = useCallback(
    (dir: -1 | 1) => {
      if (!receiptDate) return;
      const idx = sortedDates.indexOf(receiptDate);
      if (idx === -1) return;
      const nextIdx = idx + dir;
      if (nextIdx >= 0 && nextIdx < sortedDates.length) {
        setReceiptDate(sortedDates[nextIdx]);
        const nextEv = eventMap[sortedDates[nextIdx]];
        if (nextEv?.group) setHighlightGroup(nextEv.group);
        else setHighlightGroup(null);
      }
    },
    [receiptDate, sortedDates, eventMap]
  );

  const receiptEvent = receiptDate ? eventMap[receiptDate] : null;

  // If no timeline events at all, hide the section entirely
  if (timelineEvents.length === 0) {
    return null;
  }

  return (
    <>
      <div
        ref={stripRef}
        className={`barcode-strip ${expanded ? 'barcode-strip--expanded' : 'barcode-strip--collapsed'}`}
      >
        {/* Collapsed bar */}
        <div className="barcode-bar" onClick={toggleExpand}>
          <span className="barcode-bar__label-left">TIMELINE</span>
          <div className="barcode-canvas">
            {weeks.map((w, i) => (
              <div
                key={i}
                className="barcode-stripe"
                onMouseMove={(e) => onStripeMouseMove(e, w.events)}
                onMouseLeave={onStripeMouseLeave}
              >
                <div
                  className="barcode-stripe__fill"
                  style={{ background: BARCODE_COLORS[w.level] || 'transparent' }}
                />
              </div>
            ))}
          </div>
          <span className="barcode-bar__label-right">{yearRange}</span>
        </div>

        {/* Expanded heatmap — compressed to only show years with events */}
        <div className="barcode-heatmap" ref={heatmapRef}>
          <div className="timeline-heatmap">
            <div className="hm-day-labels">
              {['', 'MON', '', 'WED', '', 'FRI', ''].map((name, i) => (
                <span key={i} style={name ? undefined : { visibility: 'hidden' }}>
                  {name || 'X'}
                </span>
              ))}
            </div>
            <div className="hm-wrap">
              {compressedHeatmap.map((segment, si) => (
                <React.Fragment key={si}>
                  {segment.type === 'gap' ? (
                    <div className="hm-gap" title={`${segment.gapYears} years with no events`}>
                      <span className="hm-gap__dots">···</span>
                    </div>
                  ) : (
                    segment.weeks.map((week, wi) => (
                      <div className="hm-week" key={`${si}-${wi}`}>
                        {week.map((day, di) => {
                          if (!day.inRange) {
                            return <div className="hm-c empty" key={di} />;
                          }
                          const ev = eventMap[day.s];
                          const level = ev ? ev.level : 0;
                          const isHighlighted = highlightGroup && ev?.group === highlightGroup;
                          return (
                            <div
                              key={di}
                              className={`hm-c ${level > 0 ? `l${level}` : ''} ${isHighlighted ? 'hl' : ''}`}
                              data-date={ev ? day.s : undefined}
                              title={ev ? `${day.s}: ${ev.label}` : undefined}
                              onClick={ev ? (e) => onCellClick(day.s, e) : undefined}
                            />
                          );
                        })}
                      </div>
                    ))
                  )}
                </React.Fragment>
              ))}
            </div>
            <div className="hm-months">
              {/* Month labels positioned by accumulated week offset */}
              {compressedMonthLabels.map(({ key, left, label }) => (
                <span key={key} style={{ left: `${left}px` }}>
                  {label}
                </span>
              ))}
            </div>
          </div>

          {/* Receipt popup */}
          {receiptEvent && receiptDate && (
            <div
              className="receipt receipt--visible"
              style={{ left: receiptPos.x, top: receiptPos.y }}
            >
              <div className="receipt__header">{formatDate(receiptDate)}</div>
              <div className="receipt__header" style={{ fontSize: '8px', fontWeight: 400, marginTop: '-2px' }}>
                {receiptEvent.label}
              </div>
              <hr className="receipt__divider" />
              {receiptEvent.items.map((item, i) => (
                <div className="receipt__line" key={i}>
                  <span className="receipt__line-label">{item.k}</span>
                  <span className="receipt__line-value">{item.v}</span>
                </div>
              ))}
              <hr className="receipt__divider" />
              <div className="receipt__total">
                <span>TOTAL</span>
                <span>{receiptEvent.total}</span>
              </div>
              {receiptEvent.group && receiptEvent.groupDay && (
                <div style={{ fontSize: '8px', color: '#bbb', fontFamily: "var(--vp-font-mono)", marginTop: '2px' }}>
                  Day {receiptEvent.groupDay} · Group total: {receiptEvent.groupTotal || '—'}
                </div>
              )}
              <div className="receipt__nav">
                <a onClick={() => navigateReceipt(-1)}>← PREV DAY</a>
                <a onClick={() => navigateReceipt(1)}>NEXT DAY →</a>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Floating tooltip for barcode stripes */}
      {tooltipContent && (
        <div
          className="barcode-tooltip barcode-tooltip--visible"
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
        >
          {tooltipContent.split('\n').map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
    </>
  );
};

export default BarcodeTimeline;
