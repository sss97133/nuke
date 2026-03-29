import React, { useState, useCallback, useMemo, useEffect } from 'react';
import type { WorkSession, DailyReceipt, DayPhoto } from './hooks/useBuildLog';

// ── Helpers ──

const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtCents = (c: number) => fmt(c / 100);

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const fmtDate = (d: string) => {
  const date = new Date(d + 'T12:00:00');
  const month = date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  const day = date.getDate();
  const weekday = WEEKDAYS[date.getDay()];
  return { month, day, weekday };
};

const fmtDuration = (mins: number) => {
  if (mins <= 0) return null;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
};

const WORK_TYPE_COLORS: Record<string, string> = {
  fabrication: 'var(--error)',
  heavy_work: 'var(--warning)',
  parts_and_work: 'var(--info)',
  parts_received: 'var(--text-secondary)',
  work: 'var(--text)',
};

const WORK_TYPE_LABELS: Record<string, string> = {
  fabrication: 'FAB',
  heavy_work: 'HEAVY',
  parts_and_work: 'PARTS+WORK',
  parts_received: 'PARTS',
  work: 'WORK',
};

// ── Day Card Context (Seven-Level Analysis — Levels 1-2) ──

interface DayCardContext {
  sessionNumber: number;
  totalSessions: number;
  totalMinutes: number;
  signals: { widget_slug: string; score: number; label: string; reasons: string[]; evidence: any }[];
}

function useDayCardContext(vehicleId: string | undefined, sessionDate: string): DayCardContext | null {
  const [ctx, setCtx] = useState<DayCardContext | null>(null);

  useEffect(() => {
    if (!vehicleId || vehicleId.length < 20) return;
    let cancelled = false;

    import('../../lib/supabase').then(({ supabase }) => {
      supabase.rpc('get_day_card_context', {
        p_vehicle_id: vehicleId,
        p_date: sessionDate,
      }).then(({ data, error }: any) => {
        if (cancelled || error || !data) return;
        const d = typeof data === 'string' ? JSON.parse(data) : data;
        const totalSessions = Number(d.total_sessions) || 0;
        if (totalSessions === 0) { setCtx(null); return; }

        const signals = Array.isArray(d.signals) ? d.signals : [];
        setCtx({
          sessionNumber: Number(d.session_number) || 0,
          totalSessions,
          totalMinutes: Number(d.total_minutes) || 0,
          signals: signals.map((s: any) => ({
            widget_slug: s.widget_slug || '',
            score: Number(s.score) || 0,
            label: s.label || '',
            reasons: Array.isArray(s.reasons) ? s.reasons : [],
            evidence: s.evidence,
          })),
        });
      });
    });

    return () => { cancelled = true; };
  }, [vehicleId, sessionDate]);

  return ctx;
}

// ── Narrative computation (template-based, no LLM) ──

const WORK_TYPE_READABLE: Record<string, string> = {
  fabrication: 'fabrication',
  heavy_work: 'heavy work',
  parts_and_work: 'parts and work',
  parts_received: 'parts received',
  work: 'work',
};

function computeNarrative(
  session: { work_type: string; duration_minutes: number; total_parts_cost: number; image_count: number; work_description: string },
  detail: DailyReceipt | null,
  ctx: DayCardContext | null,
): string | null {
  const isWorkSession = session.work_type && session.work_type !== '';
  const hasPhotosOnly = session.image_count > 0 && session.duration_minutes <= 0 && session.total_parts_cost <= 0;

  // No work session data and no photos — nothing to narrate
  if (!isWorkSession && !hasPhotosOnly) return null;

  // Photo-only session (no work data)
  if (hasPhotosOnly) {
    const photoCount = detail?.photo_count || session.image_count;
    const areas = detail?.photos
      ?.map((p) => p.area)
      .filter((a): a is string => !!a && a !== 'general');
    const uniqueAreas = areas ? [...new Set(areas)] : [];
    if (uniqueAreas.length > 0) {
      return `Photo session documenting ${photoCount} images across ${uniqueAreas.slice(0, 3).join(', ')}${uniqueAreas.length > 3 ? ' and more' : ''}.`;
    }
    return `Photo session documenting ${photoCount} image${photoCount === 1 ? '' : 's'}.`;
  }

  // Work session but no context data loaded yet
  if (!ctx) return null;
  // Session not found in the vehicle's sessions (shouldn't happen but guard)
  if (ctx.sessionNumber === 0) return null;

  const parts: string[] = [];

  // Level 1: Build arc position
  const workLabel = WORK_TYPE_READABLE[session.work_type] || session.work_type.replace(/_/g, ' ');

  // Session X of Y
  parts.push(`Session ${ctx.sessionNumber} of ${ctx.totalSessions}.`);

  // Duration sentence
  const durStr = fmtDuration(session.duration_minutes);
  if (durStr) {
    parts.push(`${workLabel.charAt(0).toUpperCase() + workLabel.slice(1)} session — ${durStr}.`);
  }

  // Parts cost
  if (session.total_parts_cost > 0) {
    parts.push(`Parts: ${fmt(session.total_parts_cost)}.`);
  }

  // Labor cost from detail
  if (detail?.work_session) {
    const ws = detail.work_session;
    if (ws.total_labor_cost > 0) {
      parts.push(`Labor: ${fmt(ws.total_labor_cost)}.`);
    }
    if (ws.total_job_cost > 0 && ws.total_job_cost !== ws.total_labor_cost && ws.total_job_cost !== session.total_parts_cost) {
      parts.push(`Day total: ${fmt(ws.total_job_cost)}.`);
    }
  }

  // Total build hours (only show if we have enough sessions to be meaningful — 3+)
  if (ctx.totalSessions >= 3 && ctx.totalMinutes > 0) {
    const totalHours = Math.round(ctx.totalMinutes / 60);
    parts.push(`${totalHours} total hours logged across all sessions.`);
  }

  // Photos documented
  if (session.image_count > 0) {
    parts.push(`${session.image_count} photo${session.image_count === 1 ? '' : 's'} documented.`);
  }

  // Level 2: Comparison signals (if any exist)
  for (const sig of ctx.signals) {
    if (sig.reasons.length > 0) {
      // Use the first reason as the comparative insight
      parts.push(sig.reasons[0]);
    }
  }

  if (parts.length === 0) return null;
  return parts.join(' ');
}

// ── Photo grid grouped by area ──

const PhotoAreaGroup: React.FC<{
  area: string;
  photos: DayPhoto[];
}> = ({ area, photos }) => {
  const [expandedPhoto, setExpandedPhoto] = useState<string | null>(null);

  return (
    <div style={{ marginBottom: '8px' }}>
      <div style={{
        fontSize: '7px',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        color: 'var(--vp-pencil, #888)',
        marginBottom: '3px',
        fontFamily: 'var(--vp-font-sans)',
      }}>
        {area.toUpperCase()} <span style={{ fontFamily: 'var(--vp-font-mono)', fontWeight: 400 }}>{photos.length}</span>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))',
        gap: '2px',
      }}>
        {photos.map((photo) => (
          <div
            key={photo.id}
            style={{
              position: 'relative',
              aspectRatio: '1',
              overflow: 'hidden',
              cursor: 'pointer',
              border: expandedPhoto === photo.id ? '2px solid var(--vp-ink)' : '2px solid transparent',
            }}
            onClick={() => setExpandedPhoto(expandedPhoto === photo.id ? null : photo.id)}
          >
            <img
              src={photo.thumbnail_url || photo.image_url}
              alt={photo.caption || photo.file_name || 'Work photo'}
              loading="lazy"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
            />
            {photo.operation && (
              <div style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                background: 'rgba(0,0,0,0.7)',
                color: '#fff',
                fontSize: '6px',
                fontFamily: 'var(--vp-font-mono)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                padding: '1px 3px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {photo.operation}
              </div>
            )}
          </div>
        ))}
      </div>
      {/* Expanded photo caption */}
      {expandedPhoto && (() => {
        const photo = photos.find(p => p.id === expandedPhoto);
        if (!photo?.caption) return null;
        return (
          <div style={{
            fontSize: '8px',
            fontFamily: 'var(--vp-font-sans)',
            color: 'var(--vp-ink)',
            padding: '4px 0 2px',
            lineHeight: 1.4,
          }}>
            {photo.caption}
          </div>
        );
      })()}
    </div>
  );
};

// ── Main DayCard ──

interface Props {
  session: WorkSession;
  detail: DailyReceipt | null;
  isLoading: boolean;
  onExpand: (date: string) => void;
  /** When rendered inside a popup, auto-expand and auto-load detail */
  vehicleId?: string;
  isPopup?: boolean;
}

const DayCard: React.FC<Props> = ({ session, detail, isLoading, onExpand, vehicleId, isPopup }) => {
  const [expanded, setExpanded] = useState(!!isPopup);
  const [popupDetail, setPopupDetail] = useState<DailyReceipt | null>(detail);
  const [popupLoading, setPopupLoading] = useState(false);
  const loadedRef = React.useRef(false);

  // When in popup mode, auto-load day detail via RPC
  React.useEffect(() => {
    if (!isPopup || !vehicleId || loadedRef.current) return;
    loadedRef.current = true;
    setPopupLoading(true);
    import('../../lib/supabase').then(({ supabase }) => {
      supabase.rpc('get_daily_work_receipt', {
        p_vehicle_id: vehicleId,
        p_date: session.date,
      }).then(({ data, error }: any) => {
        if (!error && data) setPopupDetail(data as DailyReceipt);
        setPopupLoading(false);
      });
    });
  }, [isPopup, vehicleId, session.date]);

  // Use popup-loaded detail if available
  const activeDetail = popupDetail || detail;
  const activeLoading = popupLoading || isLoading;

  // Seven-level analysis context (Levels 1-2)
  const dayCardCtx = useDayCardContext(vehicleId, session.date);
  const narrative = useMemo(
    () => computeNarrative(session, activeDetail, dayCardCtx),
    [session, activeDetail, dayCardCtx],
  );

  const dateInfo = useMemo(() => fmtDate(session.date), [session.date]);
  const typeColor = WORK_TYPE_COLORS[session.work_type] || WORK_TYPE_COLORS.work;
  const typeLabel = WORK_TYPE_LABELS[session.work_type] || session.work_type.toUpperCase().replace(/_/g, ' ');
  const durationStr = fmtDuration(session.duration_minutes);

  const handleToggle = useCallback(() => {
    if (!expanded) {
      onExpand(session.date);
    }
    setExpanded(!expanded);
  }, [expanded, session.date, onExpand]);

  // Group photos by area
  const photosByArea = useMemo(() => {
    if (!activeDetail?.photos?.length) return [];
    const map = new Map<string, DayPhoto[]>();
    for (const p of activeDetail.photos) {
      const area = p.area || 'general';
      if (!map.has(area)) map.set(area, []);
      map.get(area)!.push(p);
    }
    // Sort: named areas first, then 'general' last
    return Array.from(map.entries()).sort((a, b) => {
      if (a[0] === 'general') return 1;
      if (b[0] === 'general') return -1;
      return a[0].localeCompare(b[0]);
    });
  }, [activeDetail?.photos]);

  return (
    <div style={{ marginBottom: isPopup ? 0 : '2px' }}>
      {/* Collapsed header — hidden in popup mode */}
      {!isPopup && <div
        onClick={handleToggle}
        style={{
          display: 'grid',
          gridTemplateColumns: '36px 6px 1fr auto auto',
          gap: '0 8px',
          alignItems: 'center',
          padding: '6px 8px',
          cursor: 'pointer',
          border: '2px solid var(--vp-ghost, #ddd)',
          background: expanded ? 'var(--vp-row-alt, #f9f9f9)' : 'transparent',
          userSelect: 'none',
          transition: 'background var(--vp-speed, 180ms) var(--vp-ease)',
        }}
      >
        {/* Date block */}
        <div style={{ textAlign: 'center', lineHeight: 1 }}>
          <div style={{
            fontSize: '6px',
            fontFamily: 'var(--vp-font-mono)',
            color: 'var(--vp-pencil)',
            letterSpacing: '0.08em',
          }}>
            {dateInfo.weekday}
          </div>
          <div style={{
            fontSize: '11px',
            fontFamily: 'var(--vp-font-mono)',
            fontWeight: 700,
            color: 'var(--vp-ink)',
          }}>
            {dateInfo.day}
          </div>
          <div style={{
            fontSize: '6px',
            fontFamily: 'var(--vp-font-mono)',
            color: 'var(--vp-pencil)',
            letterSpacing: '0.08em',
          }}>
            {dateInfo.month}
          </div>
        </div>

        {/* Work type dot */}
        <span style={{
          display: 'inline-block',
          width: '6px',
          height: '6px',
          background: typeColor,
          flexShrink: 0,
        }} />

        {/* Summary line */}
        <div style={{ overflow: 'hidden' }}>
          <div style={{
            fontSize: '8px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontFamily: 'var(--vp-font-sans)',
          }}>
            {expanded ? '\u25BE' : '\u25B8'} {typeLabel}
            {durationStr && (
              <span style={{ fontWeight: 400, color: 'var(--vp-pencil)', marginLeft: '6px', fontFamily: 'var(--vp-font-mono)', fontSize: '7px' }}>
                {durationStr}
              </span>
            )}
          </div>
          {session.work_description && (
            <div style={{
              fontSize: '7px',
              color: 'var(--vp-pencil)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontFamily: 'var(--vp-font-sans)',
              marginTop: '1px',
            }}>
              {session.work_description.length > 120
                ? session.work_description.slice(0, 120) + '...'
                : session.work_description}
            </div>
          )}
        </div>

        {/* Photo count */}
        {session.image_count > 0 && (
          <span style={{
            fontFamily: 'var(--vp-font-mono)',
            fontSize: '8px',
            fontWeight: 700,
            color: 'var(--vp-pencil)',
          }}>
            {session.image_count} <span style={{ fontSize: '6px', letterSpacing: '0.08em' }}>IMG</span>
          </span>
        )}

        {/* Parts cost */}
        {session.total_parts_cost > 0 && (
          <span style={{
            fontFamily: 'var(--vp-font-mono)',
            fontSize: '8px',
            fontWeight: 700,
            color: 'var(--vp-ink)',
          }}>
            {fmt(session.total_parts_cost)}
          </span>
        )}
      </div>}

      {/* Expanded detail */}
      {expanded && (
        <div style={{
          borderLeft: isPopup ? 'none' : '2px solid var(--vp-ghost, #ddd)',
          borderRight: isPopup ? 'none' : '2px solid var(--vp-ghost, #ddd)',
          borderBottom: isPopup ? 'none' : '2px solid var(--vp-ghost, #ddd)',
          padding: '8px',
        }}>
          {/* Popup mode header: show date + work type inline */}
          {isPopup && (
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '8px',
              paddingBottom: '4px',
              borderBottom: '2px solid var(--vp-ink, #1a1a1a)',
            }}>
              <div>
                <div style={{ fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', fontFamily: 'var(--vp-font-sans)', letterSpacing: '0.04em' }}>
                  {typeLabel}
                  {durationStr && (
                    <span style={{ fontWeight: 400, color: 'var(--vp-pencil)', marginLeft: '8px', fontFamily: 'var(--vp-font-mono)', fontSize: '7px' }}>
                      {durationStr}
                    </span>
                  )}
                </div>
                {session.work_description && (
                  <div style={{ fontSize: '7px', color: 'var(--vp-pencil)', fontFamily: 'var(--vp-font-sans)', marginTop: '2px', maxWidth: '360px' }}>
                    {session.work_description}
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>
                {session.image_count > 0 && (
                  <div style={{ fontFamily: 'var(--vp-font-mono)', fontSize: '8px', fontWeight: 700, color: 'var(--vp-pencil)' }}>
                    {session.image_count} PHOTOS
                  </div>
                )}
                {session.total_parts_cost > 0 && (
                  <div style={{ fontFamily: 'var(--vp-font-mono)', fontSize: '9px', fontWeight: 700, color: 'var(--vp-ink)' }}>
                    {fmt(session.total_parts_cost)}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeLoading && (
            <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', padding: '4px 0', fontFamily: 'var(--vp-font-sans)' }}>
              Loading day detail...
            </div>
          )}

          {activeDetail && (
            <>
              {/* Photos grouped by area */}
              {photosByArea.length > 0 && (
                <div style={{ marginBottom: '8px' }}>
                  {photosByArea.map(([area, photos]) => (
                    <PhotoAreaGroup key={area} area={area} photos={photos} />
                  ))}
                </div>
              )}

              {/* Component events */}
              {activeDetail.component_events.length > 0 && (
                <div style={{ marginBottom: '8px' }}>
                  <div style={{
                    fontSize: '7px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    color: 'var(--vp-pencil)',
                    marginBottom: '3px',
                    fontFamily: 'var(--vp-font-sans)',
                  }}>
                    COMPONENT EVENTS
                  </div>
                  {activeDetail.component_events.map((ev) => (
                    <div key={ev.id} style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr auto',
                      gap: '2px 8px',
                      fontSize: '8px',
                      fontFamily: 'var(--vp-font-mono)',
                      lineHeight: 1.5,
                    }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '0 3px',
                        fontSize: '6px',
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        border: '1px solid var(--vp-pencil)',
                        color: 'var(--vp-pencil)',
                        alignSelf: 'start',
                        marginTop: '1px',
                      }}>
                        {ev.event_type}
                      </span>
                      <span style={{ fontFamily: 'var(--vp-font-sans)', fontSize: '8px' }}>
                        {ev.description}
                      </span>
                      <span style={{ textAlign: 'right', fontSize: '8px' }}>
                        {ev.cost_cents ? fmtCents(ev.cost_cents) : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Receipts */}
              {activeDetail.receipts.length > 0 && (
                <div style={{ marginBottom: '8px' }}>
                  <div style={{
                    fontSize: '7px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    color: 'var(--vp-pencil)',
                    marginBottom: '3px',
                    fontFamily: 'var(--vp-font-sans)',
                  }}>
                    RECEIPTS
                  </div>
                  {activeDetail.receipts.map((r) => (
                    <div key={r.id} style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr auto',
                      gap: '2px 12px',
                      fontSize: '8px',
                      fontFamily: 'var(--vp-font-mono)',
                      lineHeight: 1.5,
                      padding: '2px 0',
                      borderBottom: '1px solid var(--vp-ghost, #ddd)',
                    }}>
                      <span style={{ fontWeight: 700, fontFamily: 'var(--vp-font-sans)' }}>
                        {r.vendor_name}
                        {r.order_number && (
                          <span style={{ fontWeight: 400, color: 'var(--vp-pencil)', fontSize: '7px', marginLeft: '6px' }}>
                            #{r.order_number}
                          </span>
                        )}
                      </span>
                      <span style={{ textAlign: 'right', fontWeight: 700 }}>
                        {fmt(Number(r.total || r.total_amount || 0))}
                      </span>
                      {/* Receipt items */}
                      {Array.isArray(r.items) && r.items.length > 0 && r.items.map((item: any, idx: number) => (
                        <React.Fragment key={idx}>
                          <span style={{
                            fontSize: '7px',
                            color: 'var(--vp-pencil)',
                            paddingLeft: '8px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}>
                            {item.description || item.name || item.part_number || '—'}
                          </span>
                          <span style={{ fontSize: '7px', color: 'var(--vp-pencil)', textAlign: 'right' }}>
                            {item.total != null ? fmt(Number(item.total)) : item.unit_price != null ? fmt(Number(item.unit_price)) : ''}
                          </span>
                        </React.Fragment>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {/* Line items */}
              {activeDetail.line_items.length > 0 && (
                <div style={{ marginBottom: '8px' }}>
                  <div style={{
                    fontSize: '7px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    color: 'var(--vp-pencil)',
                    marginBottom: '3px',
                    fontFamily: 'var(--vp-font-sans)',
                  }}>
                    WORK ITEMS
                  </div>
                  {activeDetail.line_items.map((li, i) => (
                    <div key={i} style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr auto auto',
                      gap: '1px 8px',
                      fontSize: '8px',
                      fontFamily: 'var(--vp-font-mono)',
                      lineHeight: 1.5,
                    }}>
                      <span style={{
                        fontFamily: 'var(--vp-font-sans)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {li.task_description}
                      </span>
                      <span style={{ color: 'var(--vp-pencil)', textAlign: 'right' }}>
                        {li.hours_labor ? `${Number(li.hours_labor)}h` : ''}
                      </span>
                      <span style={{ textAlign: 'right' }}>
                        {li.total_cost_cents ? fmtCents(li.total_cost_cents) : '\u2014'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Session duration/labor */}
              {activeDetail.work_session && activeDetail.work_session.duration_minutes > 0 && (
                <div style={{
                  fontSize: '7px',
                  fontFamily: 'var(--vp-font-mono)',
                  color: 'var(--vp-pencil)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  paddingTop: '4px',
                  borderTop: '1px solid var(--vp-ghost, #ddd)',
                }}>
                  SESSION: {fmtDuration(activeDetail.work_session.duration_minutes)}
                  {activeDetail.work_session.total_labor_cost > 0 && (
                    <span style={{ marginLeft: '12px' }}>
                      LABOR: {fmt(activeDetail.work_session.total_labor_cost)}
                    </span>
                  )}
                  {activeDetail.work_session.total_job_cost > 0 && (
                    <span style={{ marginLeft: '12px' }}>
                      TOTAL: {fmt(activeDetail.work_session.total_job_cost)}
                    </span>
                  )}
                </div>
              )}

              {/* Empty state */}
              {activeDetail.photos.length === 0 && activeDetail.receipts.length === 0 && activeDetail.component_events.length === 0 && activeDetail.line_items.length === 0 && (
                <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', fontFamily: 'var(--vp-font-sans)' }}>
                  No detailed records for this day
                </div>
              )}
            </>
          )}

          {/* Seven-Level Analysis Narrative */}
          {narrative && (
            <div style={{ marginTop: '8px' }}>
              <div style={{
                fontSize: '7px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                color: 'var(--vp-pencil, #888)',
                marginBottom: '3px',
                fontFamily: 'var(--vp-font-sans)',
              }}>
                ANALYSIS
              </div>
              <div style={{
                borderTop: '1px solid var(--vp-ghost, #ddd)',
                paddingTop: '4px',
              }}>
                <p style={{
                  fontSize: '9px',
                  fontFamily: 'Arial, sans-serif',
                  color: 'var(--text-secondary, var(--vp-pencil, #888))',
                  lineHeight: 1.6,
                  margin: 0,
                }}>
                  {narrative}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DayCard;
