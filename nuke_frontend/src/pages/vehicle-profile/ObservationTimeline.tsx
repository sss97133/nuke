/**
 * ObservationTimeline.tsx
 *
 * Chronological list of all vehicle_observations for this vehicle.
 * Every observation is attributed: source, kind, confidence, timestamp.
 * This is the dossier view — every fact traced to where it came from.
 *
 * Design system: Arial labels, Courier data, 2px borders, zero radius,
 * zero shadows, ALL CAPS section labels at 8-9px.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { useVehicleProfile } from './VehicleProfileContext';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Observation {
  id: string;
  kind: string;
  observed_at: string | null;
  ingested_at: string;
  source_url: string | null;
  confidence: string | null;
  confidence_score: number | null;
  content_text: string | null;
  structured_data: Record<string, unknown> | null;
  source_name: string | null;
  source_slug: string | null;
}

/* ------------------------------------------------------------------ */
/*  Kind display config                                                */
/* ------------------------------------------------------------------ */

const KIND_CONFIG: Record<string, { label: string; border: string }> = {
  listing:       { label: 'LISTING',       border: 'var(--text-secondary)' },
  sale_result:   { label: 'SALE RESULT',   border: '#16825d' },
  comment:       { label: 'COMMENT',       border: '#6040a0' },
  bid:           { label: 'BID',           border: '#2a6fa0' },
  work_record:   { label: 'WORK RECORD',   border: '#b05a00' },
  ownership:     { label: 'OWNERSHIP',     border: 'var(--text)' },
  specification: { label: 'SPEC',          border: 'var(--text-secondary)' },
  provenance:    { label: 'PROVENANCE',    border: '#16825d' },
  valuation:     { label: 'VALUATION',     border: '#b05a00' },
  condition:     { label: 'CONDITION',     border: '#2a6fa0' },
  media:         { label: 'MEDIA',         border: 'var(--text-disabled)' },
};

function getKindConfig(kind: string): { label: string; border: string } {
  return KIND_CONFIG[kind] || { label: kind.toUpperCase().replace(/_/g, ' '), border: 'var(--text-disabled)' };
}

/* ------------------------------------------------------------------ */
/*  Confidence display                                                 */
/* ------------------------------------------------------------------ */

function confidenceColor(conf: string | null, score: number | null): string {
  if (conf === 'high' || (score !== null && score >= 0.8)) return '#16825d';
  if (conf === 'medium' || (score !== null && score >= 0.4)) return '#b05a00';
  if (conf === 'low' || (score !== null && score > 0)) return '#d13438';
  return 'var(--text-disabled)';
}

function confidenceLabel(conf: string | null, score: number | null): string {
  if (score !== null && score > 0) return `${Math.round(score * 100)}%`;
  if (conf) return conf.toUpperCase();
  return '';
}

/* ------------------------------------------------------------------ */
/*  Date formatting                                                    */
/* ------------------------------------------------------------------ */

function formatObsDate(iso: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

function formatTimeAgo(iso: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const ms = Date.now() - d.getTime();
    if (ms < 0) return '';
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(days / 365)}yr ago`;
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------------ */
/*  Extract a useful summary from structured_data                      */
/* ------------------------------------------------------------------ */

function extractSummary(obs: Observation): string | null {
  if (obs.content_text) {
    const text = obs.content_text.trim();
    if (text.length > 200) return text.substring(0, 197) + '...';
    return text;
  }

  const sd = obs.structured_data;
  if (!sd) return null;

  // Sale result
  if (obs.kind === 'sale_result') {
    const price = (sd as any).sale_price ?? (sd as any).price ?? (sd as any).final_price;
    if (price) return `Sold for $${Number(price).toLocaleString()}`;
  }

  // Bid
  if (obs.kind === 'bid') {
    const amount = (sd as any).bid_amount ?? (sd as any).amount;
    const bidder = (sd as any).bidder ?? (sd as any).author;
    if (amount) {
      return `$${Number(amount).toLocaleString()}${bidder ? ` by ${bidder}` : ''}`;
    }
  }

  // Listing
  if (obs.kind === 'listing') {
    const title = (sd as any).title ?? (sd as any).listing_title;
    if (title) return String(title).substring(0, 120);
  }

  // Specification
  if (obs.kind === 'specification') {
    const entries = Object.entries(sd).filter(([k, v]) => v != null && k !== 'vehicle_id' && k !== 'id');
    if (entries.length > 0) {
      return entries.slice(0, 3).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(', ');
    }
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  Source host extraction                                              */
/* ------------------------------------------------------------------ */

function extractHost(url: string | null): string | null {
  if (!url) return null;
  try {
    const h = new URL(url).hostname;
    return h.startsWith('www.') ? h.slice(4) : h;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Kind filter                                                        */
/* ------------------------------------------------------------------ */

const ALL_KINDS = ['listing', 'sale_result', 'comment', 'bid', 'work_record', 'ownership', 'specification', 'provenance', 'valuation', 'condition', 'media'] as const;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

const ObservationTimeline: React.FC = () => {
  const { vehicle, observationCount } = useVehicleProfile();
  const [observations, setObservations] = useState<Observation[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const fetchObservations = useCallback(async () => {
    if (!vehicle?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('vehicle_observations')
        .select(`
          id, kind, observed_at, ingested_at, source_url,
          confidence, confidence_score, content_text, structured_data,
          observation_sources!left(display_name, slug)
        `)
        .eq('vehicle_id', vehicle.id)
        .eq('is_superseded', false)
        .order('observed_at', { ascending: false, nullsFirst: false })
        .limit(200);

      if (error) {
        console.warn('[ObservationTimeline] query error:', error.message);
        // Fallback without join
        const { data: fallback } = await supabase
          .from('vehicle_observations')
          .select('id, kind, observed_at, ingested_at, source_url, confidence, confidence_score, content_text, structured_data')
          .eq('vehicle_id', vehicle.id)
          .eq('is_superseded', false)
          .order('observed_at', { ascending: false, nullsFirst: false })
          .limit(200);

        if (fallback) {
          setObservations(fallback.map((r: any) => ({
            ...r,
            source_name: null,
            source_slug: null,
          })));
        }
        return;
      }

      if (data) {
        setObservations(data.map((r: any) => ({
          id: r.id,
          kind: r.kind,
          observed_at: r.observed_at,
          ingested_at: r.ingested_at,
          source_url: r.source_url,
          confidence: r.confidence,
          confidence_score: r.confidence_score,
          content_text: r.content_text,
          structured_data: r.structured_data,
          source_name: r.observation_sources?.display_name ?? null,
          source_slug: r.observation_sources?.slug ?? null,
        })));
      }
    } catch (err) {
      console.error('[ObservationTimeline] error:', err);
    } finally {
      setLoading(false);
    }
  }, [vehicle?.id]);

  useEffect(() => {
    fetchObservations();
  }, [fetchObservations]);

  // Kind counts for filter badges
  const kindCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const obs of observations) {
      counts[obs.kind] = (counts[obs.kind] || 0) + 1;
    }
    return counts;
  }, [observations]);

  // Filtered observations
  const filtered = useMemo(() => {
    if (!activeFilter) return observations;
    return observations.filter(o => o.kind === activeFilter);
  }, [observations, activeFilter]);

  const displayed = showAll ? filtered : filtered.slice(0, 25);

  if (!vehicle) return null;

  // Empty state
  if (!loading && observations.length === 0) {
    return (
      <div style={{
        background: 'var(--surface-elevated, var(--surface))',
        border: '2px solid var(--border)',
        padding: '16px',
      }}>
        <div style={{
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '9px',
          fontWeight: 700,
          letterSpacing: '1px',
          textTransform: 'uppercase',
          marginBottom: '8px',
        }}>
          OBSERVATION HISTORY
        </div>
        <div style={{
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '9px',
          color: 'var(--text-disabled)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          NO OBSERVATIONS RECORDED YET
        </div>
        <div style={{
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '9px',
          color: 'var(--text-secondary)',
          marginTop: '4px',
        }}>
          Observations are added as the vehicle appears on auction platforms, forums, and marketplaces.
        </div>
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--surface-elevated, var(--surface))',
      border: '2px solid var(--border)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '6px 10px',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
      }}>
        <span style={{
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '9px',
          fontWeight: 700,
          letterSpacing: '1px',
          textTransform: 'uppercase',
        }}>
          OBSERVATION HISTORY
        </span>
        <span style={{
          fontFamily: "'Courier New', Courier, monospace",
          fontSize: '8px',
          fontWeight: 400,
          color: 'var(--text-secondary)',
          letterSpacing: '0.06em',
        }}>
          {observationCount || observations.length} TOTAL
        </span>
      </div>

      {/* Kind filter badges */}
      {Object.keys(kindCounts).length > 1 && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '4px',
          padding: '6px 10px',
          borderBottom: '1px solid var(--border)',
        }}>
          <button
            type="button"
            onClick={() => setActiveFilter(null)}
            style={{
              fontFamily: 'Arial, Helvetica, sans-serif',
              fontSize: '8px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              padding: '2px 6px',
              border: `1px solid ${!activeFilter ? 'var(--text)' : 'var(--border)'}`,
              background: !activeFilter ? 'var(--text)' : 'transparent',
              color: !activeFilter ? 'var(--bg, #f5f5f5)' : 'var(--text)',
              cursor: 'pointer',
            }}
          >
            ALL {observations.length}
          </button>
          {ALL_KINDS.filter(k => kindCounts[k]).map(kind => {
            const kc = getKindConfig(kind);
            const isActive = activeFilter === kind;
            return (
              <button
                key={kind}
                type="button"
                onClick={() => setActiveFilter(isActive ? null : kind)}
                style={{
                  fontFamily: 'Arial, Helvetica, sans-serif',
                  fontSize: '8px',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  padding: '2px 6px',
                  border: `1px solid ${isActive ? 'var(--text)' : 'var(--border)'}`,
                  background: isActive ? 'var(--text)' : 'transparent',
                  color: isActive ? 'var(--bg, #f5f5f5)' : 'var(--text)',
                  cursor: 'pointer',
                }}
              >
                {kc.label} {kindCounts[kind]}
              </button>
            );
          })}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div style={{
          padding: '12px 10px',
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '8px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          color: 'var(--text-disabled)',
        }}>
          LOADING OBSERVATIONS...
        </div>
      )}

      {/* Observation rows */}
      {!loading && displayed.map((obs) => {
        const kc = getKindConfig(obs.kind);
        const summary = extractSummary(obs);
        const host = extractHost(obs.source_url);
        const confLabel = confidenceLabel(obs.confidence, obs.confidence_score);
        const confColor = confidenceColor(obs.confidence, obs.confidence_score);
        const dateDisplay = formatObsDate(obs.observed_at);
        const ago = formatTimeAgo(obs.observed_at || obs.ingested_at);

        return (
          <div
            key={obs.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '80px 1fr auto',
              alignItems: 'start',
              padding: '5px 10px',
              borderBottom: '1px solid var(--border)',
              gap: '8px',
              minHeight: '28px',
            }}
          >
            {/* Kind badge */}
            <span style={{
              fontFamily: "'Courier New', Courier, monospace",
              fontSize: '8px',
              fontWeight: 700,
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
              padding: '1px 5px',
              border: `2px solid ${kc.border}`,
              color: kc.border,
              lineHeight: 1.4,
              whiteSpace: 'nowrap',
              alignSelf: 'center',
            }}>
              {kc.label}
            </span>

            {/* Content */}
            <div style={{ minWidth: 0 }}>
              {/* Source + summary */}
              <div style={{
                fontFamily: 'Arial, Helvetica, sans-serif',
                fontSize: '9px',
                color: 'var(--text)',
                lineHeight: 1.4,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {obs.source_name && (
                  <span style={{ fontWeight: 700 }}>{obs.source_name}</span>
                )}
                {obs.source_name && summary && (
                  <span style={{ color: 'var(--text-disabled)', margin: '0 4px' }}>&middot;</span>
                )}
                {summary && (
                  <span style={{ color: 'var(--text-secondary)' }}>{summary}</span>
                )}
                {!obs.source_name && !summary && host && (
                  <span style={{ color: 'var(--text-secondary)' }}>{host}</span>
                )}
                {!obs.source_name && !summary && !host && (
                  <span style={{ color: 'var(--text-disabled)', textTransform: 'uppercase', fontSize: '8px', letterSpacing: '0.5px' }}>
                    {obs.kind.replace(/_/g, ' ')} observation
                  </span>
                )}
              </div>

              {/* Source URL (truncated) */}
              {obs.source_url && (
                <a
                  href={obs.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontFamily: "'Courier New', Courier, monospace",
                    fontSize: '7px',
                    color: 'var(--text-disabled)',
                    textDecoration: 'none',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    display: 'block',
                    maxWidth: '300px',
                  }}
                  title={obs.source_url}
                >
                  {host || obs.source_url.substring(0, 60)}
                </a>
              )}
            </div>

            {/* Right: confidence + date */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: '2px',
              flexShrink: 0,
            }}>
              {confLabel && (
                <span style={{
                  fontFamily: "'Courier New', Courier, monospace",
                  fontSize: '8px',
                  fontWeight: 700,
                  color: confColor,
                }}>
                  {confLabel}
                </span>
              )}
              {(dateDisplay || ago) && (
                <span style={{
                  fontFamily: 'Arial, Helvetica, sans-serif',
                  fontSize: '7px',
                  color: 'var(--text-disabled)',
                  whiteSpace: 'nowrap',
                }}
                  title={dateDisplay}
                >
                  {ago || dateDisplay}
                </span>
              )}
            </div>
          </div>
        );
      })}

      {/* Show more */}
      {!loading && filtered.length > 25 && (
        <div style={{
          padding: '6px 10px',
          borderTop: '1px solid var(--border)',
          textAlign: 'center',
        }}>
          <button
            type="button"
            onClick={() => setShowAll(!showAll)}
            style={{
              fontFamily: 'Arial, Helvetica, sans-serif',
              fontSize: '8px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              padding: '3px 10px',
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text)',
              cursor: 'pointer',
            }}
          >
            {showAll ? 'SHOW FEWER' : `SHOW ALL ${filtered.length} OBSERVATIONS`}
          </button>
        </div>
      )}
    </div>
  );
};

export default ObservationTimeline;
