import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useVehicleProfile } from './VehicleProfileContext';
import { usePopup } from '../../components/popups/usePopup';

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
  hasWorkSession?: boolean;
  workMeta?: {
    work_type: string;
    image_count: number;
    duration_minutes: number;
    total_parts_cost: number;
    total_labor_cost: number;
    total_job_cost: number;
    work_description: string;
  };
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
  work_session: 'Work Session',
  pending_analysis: 'Pending Analysis',
  service: 'Service',
  other: 'Activity',
};

const WORK_TYPE_LABELS: Record<string, string> = {
  fabrication: 'Fabrication',
  heavy_work: 'Heavy Work',
  parts_and_work: 'Parts + Work',
  parts_received: 'Parts Received',
  work: 'Work',
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

  // Work session: show work type from metadata
  if (eventType === 'work_session') {
    const workType = ev.metadata?.work_type || ev.category || 'work';
    const workLabel = WORK_TYPE_LABELS[workType] || workType.replace(/_/g, ' ');
    const imgCount = ev.metadata?.image_count || 0;
    const desc = ev.metadata?.work_description;
    let label = `Work: ${workLabel}`;
    if (imgCount > 0) label += ` (${imgCount} photos)`;
    return label;
  }

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

// Lazy-load DayCard for popup rendering
const DayCardPopupContent = React.lazy(() => import('./DayCard'));

// ---------------------------------------------------------------------------
// Timeline filter definitions — client-side only, no new queries
// ---------------------------------------------------------------------------

const TIMELINE_FILTERS: { key: string; label: string; match: (ev: any) => boolean }[] = [
  { key: 'all', label: 'ALL', match: () => true },
  { key: 'work', label: 'WORK', match: (ev) => {
    const t = String(ev.event_type || '').toLowerCase();
    return t === 'work_session' || t === 'repair' || t === 'modification' || t === 'maintenance' || t === 'service';
  }},
  { key: 'photos', label: 'PHOTOS', match: (ev) => {
    const t = String(ev.event_type || '').toLowerCase();
    return t === 'photo_session' || (ev.metadata?.image_count > 0);
  }},
  { key: 'sales', label: 'SALES', match: (ev) => {
    const t = String(ev.event_type || '').toLowerCase();
    return t.startsWith('auction_') || t === 'sale' || t === 'purchase';
  }},
  { key: 'discovery', label: 'DISCOVERY', match: (ev) => {
    const t = String(ev.event_type || '').toLowerCase();
    return t === 'vehicle_added' || t === 'mileage_reading' || t === 'registration';
  }},
];

const BarcodeTimeline: React.FC<BarcodeTimelineProps> = () => {
  const { vehicle, vehicleId, timelineEvents, setGalleryFilter } = useVehicleProfile();
  const { openPopup } = usePopup();
  const [expanded, setExpanded] = useState(true);
  const [activeFilter, setActiveFilter] = useState('all');
  const [receiptDate, setReceiptDate] = useState<string | null>(null);
  const [receiptPos, setReceiptPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [tooltipContent, setTooltipContent] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [highlightGroup, setHighlightGroup] = useState<string | null>(null);
  const heatmapRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  // Filter counts — always computed from the full set so pills show totals before clicking
  const filterCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of TIMELINE_FILTERS) {
      counts[f.key] = f.key === 'all' ? timelineEvents.length : timelineEvents.filter(f.match).length;
    }
    return counts;
  }, [timelineEvents]);

  // Filtered events for heatmap — client-side only
  const filteredEvents = useMemo(() => {
    const filter = TIMELINE_FILTERS.find(f => f.key === activeFilter);
    if (!filter || activeFilter === 'all') return timelineEvents;
    return timelineEvents.filter(filter.match);
  }, [timelineEvents, activeFilter]);

  // Helper: build an EventDay map from a list of events
  const buildEventMap = useCallback((events: any[]) => {
    const map: Record<string, EventDay> = {};
    for (const ev of events) {
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
        map[ds] = { date: ds, label, level: 1, items: [], total: '—' };
      }
      map[ds].items.push({ k: formatEventLabel(ev), v: costStr });

      // Tag work_session days with rich metadata for Day Card popup
      const eventType = String(ev.event_type || '').trim().toLowerCase();
      if (eventType === 'work_session' && ev.metadata?.source === 'work_sessions') {
        map[ds].hasWorkSession = true;
        map[ds].workMeta = {
          work_type: ev.metadata.work_type || 'work',
          image_count: ev.metadata.image_count || 0,
          duration_minutes: ev.metadata.duration_minutes || 0,
          total_parts_cost: ev.metadata.total_parts_cost || 0,
          total_labor_cost: ev.metadata.total_labor_cost || 0,
          total_job_cost: ev.metadata.total_job_cost || 0,
          work_description: ev.metadata.work_description || '',
        };
      }

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
    mergeAdjacentSessions(map);
    return map;
  }, []);

  // eventMap from FILTERED events (heatmap); weeks from ALL events (barcode strip always shows everything)
  const { eventMap, startDate, endDate, weeks, sortedDates } = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const vehicleYear = (vehicle as any).year || currentYear;

    // Build map from ALL events first for barcode weeks + date range
    const allMap = buildEventMap(timelineEvents);

    // Build the filtered map for heatmap rendering
    const map = activeFilter === 'all' ? allMap : buildEventMap(filteredEvents);

    // Date range uses ALL events so the heatmap grid stays stable across filters
    const allYears = Object.keys(allMap).map((d) => new Date(d + 'T00:00:00').getFullYear());
    const minYear = Math.min(vehicleYear, ...allYears, currentYear - 3);
    const maxYear = Math.max(currentYear, ...allYears);

    const start = new Date(minYear, 0, 1);
    start.setDate(start.getDate() - start.getDay()); // align to Sunday
    const end = new Date(maxYear, 11, 31);

    // Build weeks for barcode from ALL events (collapsed strip always shows everything)
    const wks: { start: Date; level: number; events: { date: string; label: string }[] }[] = [];
    const cur = new Date(start);
    while (cur <= end) {
      let maxLevel = 0;
      const weekEvents: { date: string; label: string }[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(cur);
        const s = dateStr(d);
        if (allMap[s]) {
          if (allMap[s].level > maxLevel) maxLevel = allMap[s].level;
          weekEvents.push({ date: s, label: allMap[s].label });
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
  }, [vehicle, timelineEvents, filteredEvents, activeFilter, buildEventMap]);

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
        setGalleryFilter(null);
      }
      return !prev;
    });
  }, [setGalleryFilter]);

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
        setGalleryFilter(null);
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
        setGalleryFilter(null);
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
      // Emit gallery filter for this day's photos
      setGalleryFilter({ dateRange: [ds, ds] });
    },
    [eventMap, setGalleryFilter]
  );

  // Receipt navigation
  const navigateReceipt = useCallback(
    (dir: -1 | 1) => {
      if (!receiptDate) return;
      const idx = sortedDates.indexOf(receiptDate);
      if (idx === -1) return;
      const nextIdx = idx + dir;
      if (nextIdx >= 0 && nextIdx < sortedDates.length) {
        const nextDate = sortedDates[nextIdx];
        setReceiptDate(nextDate);
        const nextEv = eventMap[nextDate];
        if (nextEv?.group) setHighlightGroup(nextEv.group);
        else setHighlightGroup(null);
        setGalleryFilter({ dateRange: [nextDate, nextDate] });
      }
    },
    [receiptDate, sortedDates, eventMap, setGalleryFilter]
  );

  const receiptEvent = receiptDate ? eventMap[receiptDate] : null;

  // Open full Day Card detail in a popup
  const openDayCardPopup = useCallback(
    (date: string) => {
      const ev = eventMap[date];
      if (!ev) return;
      const dateLabel = formatDate(date);
      openPopup(
        <React.Suspense fallback={null}>
          <DayCardPopupContent
            session={{
              date,
              title: ev.label,
              work_type: ev.workMeta?.work_type || 'work',
              image_count: ev.workMeta?.image_count || 0,
              duration_minutes: ev.workMeta?.duration_minutes || 0,
              total_parts_cost: ev.workMeta?.total_parts_cost || 0,
              has_receipts: (ev.workMeta?.total_parts_cost || 0) > 0,
              work_description: ev.workMeta?.work_description || '',
              status: 'complete',
            }}
            detail={null}
            isLoading={false}
            onExpand={() => {}}
            vehicleId={vehicleId}
            isPopup={true}
          />
        </React.Suspense>,
        `DAY CARD — ${dateLabel}`,
        520,
        false,
      );
      // Close the inline receipt when opening popup
      setReceiptDate(null);
    },
    [eventMap, vehicleId, openPopup]
  );

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
          {/* Filter pills — one data source, filtered views */}
          <div className="timeline-filter-pills">
            {TIMELINE_FILTERS.map((f) => (
              <button
                key={f.key}
                className={`timeline-filter-pill${activeFilter === f.key ? ' timeline-filter-pill--active' : ''}`}
                onClick={() => setActiveFilter(f.key)}
              >
                {f.label} ({filterCounts[f.key] ?? 0})
              </button>
            ))}
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
              {heatmapWeeks.map((week, wi) => {
                // Detect year boundary: compare first in-range day of this week vs previous week
                let isYearBoundary = false;
                if (wi > 0) {
                  const prevFirst = heatmapWeeks[wi - 1].find(d => d.inRange);
                  const curFirst = week.find(d => d.inRange);
                  if (prevFirst && curFirst && prevFirst.d.getFullYear() !== curFirst.d.getFullYear()) {
                    isYearBoundary = true;
                  }
                }
                return (
                  <React.Fragment key={wi}>
                    {isYearBoundary && (
                      <div className="hm-year-sep" title={String(week.find(d => d.inRange)?.d.getFullYear() || '')}>
                        <div className="hm-year-sep__line" />
                      </div>
                    )}
                    <div className="hm-week">
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
                  </React.Fragment>
                );
              })}
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
              {/* Work session summary — duration, photos, parts */}
              {receiptEvent.hasWorkSession && receiptEvent.workMeta && (
                <>
                  <hr className="receipt__divider" />
                  <div style={{ fontSize: '7px', fontFamily: 'var(--vp-font-mono, Courier New, monospace)', color: 'var(--text-disabled)', lineHeight: 1.6 }}>
                    {receiptEvent.workMeta.duration_minutes > 0 && (
                      <div>{Math.floor(receiptEvent.workMeta.duration_minutes / 60)}h {receiptEvent.workMeta.duration_minutes % 60}m session</div>
                    )}
                    {receiptEvent.workMeta.image_count > 0 && (
                      <div>{receiptEvent.workMeta.image_count} photos</div>
                    )}
                    {receiptEvent.workMeta.work_description && (
                      <div style={{ color: 'var(--text-disabled)', fontFamily: 'Arial, sans-serif', marginTop: '2px' }}>
                        {receiptEvent.workMeta.work_description.length > 100
                          ? receiptEvent.workMeta.work_description.slice(0, 100) + '...'
                          : receiptEvent.workMeta.work_description}
                      </div>
                    )}
                  </div>
                </>
              )}
              <hr className="receipt__divider" />
              <div className="receipt__total">
                <span>TOTAL</span>
                <span>{receiptEvent.total}</span>
              </div>
              {receiptEvent.group && receiptEvent.groupDay && (
                <div style={{ fontSize: '8px', color: 'var(--text-disabled)', fontFamily: "var(--vp-font-mono)", marginTop: '2px' }}>
                  Day {receiptEvent.groupDay} · Group total: {receiptEvent.groupTotal || '—'}
                </div>
              )}
              <div className="receipt__nav">
                <a onClick={() => navigateReceipt(-1)}>{'\u2190'} PREV</a>
                <a
                  onClick={() => openDayCardPopup(receiptDate)}
                  style={{ fontWeight: 700, color: 'var(--surface-elevated)' }}
                >
                  +
                </a>
                <a onClick={() => navigateReceipt(1)}>NEXT {'\u2192'}</a>
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
