import React, { useMemo, useState, useCallback, useRef } from 'react';
import { CollapsibleWidget } from '../../components/ui/CollapsibleWidget';
import { useBuildLog } from './hooks/useBuildLog';
import type { WorkSession } from './hooks/useBuildLog';

// Lazy-load heavy sub-components
const DayCard = React.lazy(() => import('./DayCard'));
const WorkOrderProgress = React.lazy(() => import('./WorkOrderProgress'));
const GenerateBill = React.lazy(() => import('./GenerateBill'));

// ── Helpers ──

const WORK_TYPE_COLORS: Record<string, string> = {
  fabrication: '#C8102E',
  heavy_work: '#EE7623',
  parts_and_work: '#6AADE4',
  parts_received: '#C8A951',
  work: '#1a1a1a',
};

const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

// ── Calendar strip — horizontal date chips ──

const CalendarStrip: React.FC<{
  sessions: WorkSession[];
  selectedDate: string | null;
  onSelect: (date: string) => void;
}> = ({ sessions, selectedDate, onSelect }) => {
  const stripRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={stripRef}
      style={{
        display: 'flex',
        gap: '2px',
        overflowX: 'auto',
        overflowY: 'hidden',
        paddingBottom: '2px',
        marginBottom: '6px',
        scrollbarWidth: 'none',
      }}
    >
      {sessions.map((s) => {
        const d = new Date(s.date + 'T12:00:00');
        const day = d.getDate();
        const isSelected = s.date === selectedDate;
        const color = WORK_TYPE_COLORS[s.work_type] || WORK_TYPE_COLORS.work;

        return (
          <div
            key={s.date}
            onClick={() => onSelect(s.date)}
            title={`${s.date} — ${s.work_type.replace(/_/g, ' ')} — ${s.image_count} photos`}
            style={{
              minWidth: '20px',
              height: '24px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              border: isSelected ? '2px solid var(--vp-ink)' : '2px solid transparent',
              background: isSelected ? 'var(--vp-row-alt, #f9f9f9)' : 'transparent',
              position: 'relative',
              flexShrink: 0,
            }}
          >
            <span style={{
              fontSize: '8px',
              fontFamily: 'var(--vp-font-mono)',
              fontWeight: 700,
              color: isSelected ? 'var(--vp-ink)' : 'var(--vp-pencil)',
              lineHeight: 1,
            }}>
              {day}
            </span>
            {/* Activity indicator bar */}
            <div style={{
              position: 'absolute',
              bottom: 0,
              left: '2px',
              right: '2px',
              height: '2px',
              background: color,
            }} />
          </div>
        );
      })}
    </div>
  );
};

// ── Main BuildLog ──

interface Props {
  vehicleId: string;
  vehicle: any;
  workOrders?: any[];
  totals?: any;
  contact?: any;
  isOwnerView: boolean;
}

const BuildLog: React.FC<Props> = ({ vehicleId, vehicle, workOrders, totals, contact, isOwnerView }) => {
  const { workDates, loading, error, dayDetails, loadingDays, loadDayDetail } = useBuildLog(vehicleId);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  // Sort sessions most recent first for the card list
  const sessions = useMemo(() => {
    if (!workDates?.sessions?.length) return [];
    return [...workDates.sessions].reverse();
  }, [workDates?.sessions]);

  // Sessions for calendar strip (chronological)
  const chronSessions = useMemo(() => workDates?.sessions || [], [workDates?.sessions]);

  const handleCalendarSelect = useCallback((date: string) => {
    setSelectedDate(prev => prev === date ? null : date);
    // Scroll to the card (done via CSS highlight, no DOM manipulation)
  }, []);

  const handleDayExpand = useCallback((date: string) => {
    loadDayDetail(date);
  }, [loadDayDetail]);

  // Show first 10 or all
  const visibleSessions = showAll ? sessions : sessions.slice(0, 10);

  if (loading) return null;
  if (!workDates || workDates.total_sessions === 0) return null;

  return (
    <CollapsibleWidget
      variant="profile"
      title="Build Log"
      defaultCollapsed={false}
      badge={<span className="widget__count">{workDates.total_sessions} DAYS</span>}
    >
    <div style={{ fontFamily: 'var(--vp-font-sans)', fontSize: '9px' }}>
      {/* Summary stats */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: '2px',
        marginBottom: '6px',
      }}>
        <div style={{ border: '2px solid var(--vp-ghost, #ddd)', padding: '4px 6px' }}>
          <div style={{
            fontSize: '7px',
            color: 'var(--vp-pencil)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            fontWeight: 700,
          }}>SESSIONS</div>
          <div style={{
            fontFamily: 'var(--vp-font-mono)',
            fontSize: '11px',
            fontWeight: 700,
          }}>{workDates.total_sessions}</div>
        </div>
        <div style={{ border: '2px solid var(--vp-ghost, #ddd)', padding: '4px 6px' }}>
          <div style={{
            fontSize: '7px',
            color: 'var(--vp-pencil)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            fontWeight: 700,
          }}>PHOTOS</div>
          <div style={{
            fontFamily: 'var(--vp-font-mono)',
            fontSize: '11px',
            fontWeight: 700,
          }}>{workDates.total_photos}</div>
        </div>
        <div style={{ border: '2px solid var(--vp-ghost, #ddd)', padding: '4px 6px' }}>
          <div style={{
            fontSize: '7px',
            color: 'var(--vp-pencil)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            fontWeight: 700,
          }}>PARTS SPEND</div>
          <div style={{
            fontFamily: 'var(--vp-font-mono)',
            fontSize: '11px',
            fontWeight: 700,
          }}>{fmt(workDates.total_parts_spend)}</div>
        </div>
      </div>

      {/* Calendar strip */}
      <CalendarStrip
        sessions={chronSessions}
        selectedDate={selectedDate}
        onSelect={handleCalendarSelect}
      />

      {/* Work type legend */}
      <div style={{
        display: 'flex',
        gap: '8px',
        marginBottom: '6px',
        fontSize: '6px',
        color: 'var(--vp-pencil)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        fontWeight: 700,
        flexWrap: 'wrap',
      }}>
        {Object.entries(WORK_TYPE_COLORS).map(([type, color]) => (
          <span key={type} style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
            <span style={{ display: 'inline-block', width: '6px', height: '6px', background: color }} />
            {type.replace(/_/g, ' ')}
          </span>
        ))}
      </div>

      {/* Work Order Sign-off (owner only) */}
      {isOwnerView && (
        <React.Suspense fallback={null}>
          <WorkOrderProgress vehicleId={vehicleId} isOwnerView={isOwnerView} />
        </React.Suspense>
      )}

      {/* Generate Bill (owner only) */}
      {isOwnerView && workOrders && totals && totals.orderCount > 0 && (
        <div style={{ marginBottom: '8px' }}>
          <React.Suspense fallback={null}>
            <GenerateBill
              vehicleId={vehicleId}
              workOrders={workOrders}
              totals={totals}
              contact={contact}
              vehicle={vehicle}
              isOwnerView={isOwnerView}
            />
          </React.Suspense>
        </div>
      )}

      {/* Day cards */}
      <React.Suspense fallback={
        <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', padding: '8px 0' }}>Loading...</div>
      }>
        {visibleSessions.map((s) => (
          <DayCard
            key={s.date}
            session={s}
            detail={dayDetails[s.date] || null}
            isLoading={loadingDays.has(s.date)}
            onExpand={handleDayExpand}
          />
        ))}
      </React.Suspense>

      {/* Show more */}
      {!showAll && sessions.length > 10 && (
        <button
          onClick={() => setShowAll(true)}
          style={{
            display: 'block',
            width: '100%',
            padding: '6px 12px',
            fontFamily: 'var(--vp-font-sans)',
            fontSize: '7px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            border: '2px solid var(--vp-ghost, #ddd)',
            background: 'transparent',
            color: 'var(--vp-pencil)',
            cursor: 'pointer',
            marginTop: '4px',
          }}
        >
          SHOW ALL {sessions.length} SESSIONS
        </button>
      )}

      {error && (
        <div style={{
          fontSize: '7px',
          fontFamily: 'var(--vp-font-mono)',
          color: 'var(--vp-martini-red)',
          marginTop: '4px',
        }}>
          {error}
        </div>
      )}
    </div>
    </CollapsibleWidget>
  );
};

export default BuildLog;
