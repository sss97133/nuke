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

        {/* Expanded heatmap — full timeline from vehicle year to present */}
        <div className="barcode-heatmap" ref={heatmapRef}>
          <div className="timeline-section__header">
            Activity Timeline · {yearRange}
          </div>
          <div className="timeline-heatmap">
            <div className="hm-day-labels">
              {['', 'MON', '', 'WED', '', 'FRI', ''].map((name, i) => (
                <span key={i} style={name ? undefined : { visibility: 'hidden' }}>
                  {name || 'X'}
                </span>
              ))}
            </div>
            <div className="hm-wrap">
              {heatmapWeeks.map((week, wi) => (
                <div className="hm-week" key={wi}>
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
              ))}
            </div>
            <div className="hm-months">
              {heatmapWeeks.reduce<React.ReactNode[]>((acc, week, wi) => {
                const firstDay = week.find((d) => d.inRange && d.d.getDate() <= 7);
                if (firstDay && firstDay.d.getDate() <= 7) {
                  const month = firstDay.d.getMonth();
                  const year = firstDay.d.getFullYear();
                  const key = `${year}-${month}`;
                  if (!acc.find((n) => n && (n as React.ReactElement).key === key)) {
                    acc.push(
                      <span key={key} style={{ left: `${wi * 11 + 22}px` }}>
                        {MONTH_NAMES[month]}
                        {month === 0 ? ` ${year}` : ''}
                      </span>
                    );
                  }
                }
                return acc;
              }, [])}
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
