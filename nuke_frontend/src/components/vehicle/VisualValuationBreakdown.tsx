import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { ValuationEngine } from '../../services/valuationEngine';
import type { ValuationResult } from '../../services/valuationEngine';
import { SmartInvoiceUploader } from '../SmartInvoiceUploader';
import CitationModal from '../valuation/CitationModal';

const COLOR_PALETTE = [
  '#0EA5E9',
  '#6366F1',
  '#22D3EE',
  '#34D399',
  '#FBBF24',
  '#F472B6',
  '#FB7185',
  '#C084FC',
  '#60A5FA',
  '#14B8A6',
  '#F97316',
  '#94A3B8'
] as const;

type ChartMode = 'value' | 'confidence' | 'evidence';

const MODE_SWITCHES: Record<ChartMode, { label: string; helper: string }> = {
  value: { label: 'Value', helper: 'Share of the estimated value' },
  confidence: { label: 'Confidence', helper: 'Fact confidence distribution' },
  evidence: { label: 'Evidence', helper: 'Photo + receipt coverage' }
};

const polarToCartesian = (centerX: number, centerY: number, radius: number, angleInDegrees: number) => {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians)
  };
};

const describeDonutSegment = (
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number
) => {
  const outerStart = polarToCartesian(cx, cy, outerRadius, endAngle);
  const outerEnd = polarToCartesian(cx, cy, outerRadius, startAngle);
  const innerStart = polarToCartesian(cx, cy, innerRadius, startAngle);
  const innerEnd = polarToCartesian(cx, cy, innerRadius, endAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 0 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 1 ${innerEnd.x} ${innerEnd.y}`,
    'Z'
  ].join(' ');
};

const getComponentValue = (component: any): number => {
  return Number(
    component?.estimatedValue ??
      component?.estimated_value ??
      component?.value ??
      component?.value_usd ??
      component?.amount ??
      0
  ) || 0;
};

const getEvidenceCount = (component: any): number => {
  if (!component) return 0;
  if (typeof component?.evidence?.photoCount === 'number') return component.evidence.photoCount;
  if (typeof component?.evidence?.photo_count === 'number') return component.evidence.photo_count;
  if (Array.isArray(component?.evidence?.imageUrls)) return component.evidence.imageUrls.length;
  if (Array.isArray(component?.evidence?.image_urls)) return component.evidence.image_urls.length;
  if (Array.isArray(component?.evidence_urls)) return component.evidence_urls.length;
  return 0;
};

const getConfidenceScore = (component: any): number => {
  const raw =
    component?.fact_confidence ??
    component?.confidence ??
    component?.confidence_score ??
    component?.evidence?.confidence ??
    component?.confidenceScore;
  if (typeof raw !== 'number') return 0;
  return raw > 1 ? Math.min(raw / 100, 1) : Math.max(0, Math.min(raw, 1));
};

interface ChartSegment {
  id: string;
  label: string;
  componentType?: string;
  value: number;
  confidence: number;
  evidenceCount: number;
  color: string;
  factId?: string;
  evidenceUrls: string[];
  conditionLabel?: string;
  conditionGrade?: number;
  reasoning?: string;
  capturedAt?: string;
  valuationSource?: string;
  metric: number;
  raw: any;
  path?: string;
  startAngle?: number;
  endAngle?: number;
}

const buildChartSegments = (components: any[], chartMode: ChartMode): ChartSegment[] => {
  if (!Array.isArray(components)) return [];

  return components
    .map((component, idx) => {
      const value = getComponentValue(component);
      const evidenceCount = getEvidenceCount(component);
      const confidence = getConfidenceScore(component);
      const metric =
        chartMode === 'value'
          ? Math.max(value, 0)
          : chartMode === 'confidence'
            ? Math.max(confidence, 0.001)
            : Math.max(evidenceCount, 0.001);

      return {
        id:
          component?.fact_id ||
          component?.factId ||
          component?.id ||
          `${component?.name || 'component'}-${idx}`,
        label: component?.name || component?.component_name || component?.componentName || 'Component',
        componentType: component?.component_type || component?.componentType || component?.type,
        value,
        confidence,
        evidenceCount,
        color: COLOR_PALETTE[idx % COLOR_PALETTE.length],
        factId: component?.fact_id || component?.factId,
        evidenceUrls:
          component?.evidence_urls ||
          component?.evidence?.imageUrls ||
          component?.evidence?.image_urls ||
          [],
        conditionLabel:
          component?.component_condition || component?.condition || component?.condition_label,
        conditionGrade: component?.conditionGrade ?? component?.condition_grade,
        reasoning: component?.reasoning || component?.notes,
        capturedAt: component?.evidence?.datePhotographed || component?.evidence?.captured_at,
        valuationSource: component?.valuation_source || component?.source,
        metric,
        raw: component
      };
    })
    .filter(segment => segment.metric > 0);
};

interface VisualValuationBreakdownProps {
  vehicleId: string;
  isOwner: boolean;
  prefetchedValuation?: any | null;
  prefetchedComponents?: any[] | null;
}

/**
 * Visual Valuation Breakdown - Shows WHY the vehicle is worth what it's worth
 *
 * Prefers expert valuations generated by the Vehicle Expert Agent.
 * Falls back to legacy valuation engine when expert data is unavailable.
 */
export const VisualValuationBreakdown: React.FC<VisualValuationBreakdownProps> = ({
  vehicleId,
  isOwner,
  prefetchedValuation,
  prefetchedComponents
}) => {
  const [valuation, setValuation] = useState<ValuationResult | null>(null);
  const [expertValuation, setExpertValuation] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [showUploader, setShowUploader] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [selectedCitation, setSelectedCitation] = useState<{ type: string; name: string; value: number } | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>('value');
  const [hoveredSegment, setHoveredSegment] = useState<string | null>(null);
  const expertComponents = useMemo(() => {
    return Array.isArray(expertValuation?.components) ? expertValuation.components : [];
  }, [expertValuation]);
  const chartSegments = useMemo(() => buildChartSegments(expertComponents, chartMode), [expertComponents, chartMode]);
  const donutSegments = useMemo(() => {
    if (!chartSegments.length) return [];
    const cx = 120;
    const cy = 120;
    const outerRadius = 110;
    const innerRadius = 70;
    const totalMetric = chartSegments.reduce((sum, seg) => sum + seg.metric, 0) || 1;
    let cursor = -90;

    return chartSegments.map(segment => {
      const sweep = (segment.metric / totalMetric) * 360;
      const startAngle = cursor;
      const endAngle = cursor + sweep;
      cursor = endAngle;

      return {
        ...segment,
        path: describeDonutSegment(cx, cy, outerRadius, innerRadius, startAngle, endAngle),
        startAngle,
        endAngle
      };
    });
  }, [chartSegments]);

  const loadValuation = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Prefer expert valuation if available
      const { data: expertData, error: expertError } = await supabase
        .from('vehicle_valuations')
        .select('id, estimated_value, documented_components, confidence_score, components, environmental_context, value_justification, valuation_date')
        .eq('vehicle_id', vehicleId)
        .order('valuation_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!expertError && expertData) {
        setExpertValuation(expertData);
        setValuation(null);
        return;
      }

      // Fallback to legacy valuation engine
      const result = await ValuationEngine.calculateValuation(vehicleId);
      setValuation(result);
      setExpertValuation(null);
    } catch (err: any) {
      console.error('Valuation failed:', err);
      setError(err.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    if (prefetchedValuation === undefined) {
      setLoading(true);
      return () => {
        if (unsubscribe) unsubscribe();
      };
    }

    if (prefetchedValuation) {
      setExpertValuation({
        ...prefetchedValuation,
        components: prefetchedComponents ?? prefetchedValuation.components
      });
      setValuation(null);
      setLoading(false);
    } else {
      loadValuation();
      const handleRefresh = () => loadValuation();
      window.addEventListener('vehicle_valuation_updated', handleRefresh);
      unsubscribe = () => window.removeEventListener('vehicle_valuation_updated', handleRefresh);
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [prefetchedValuation, prefetchedComponents, loadValuation]);

  useEffect(() => {
    setHoveredSegment(null);
  }, [chartMode, expertValuation?.id]);

  const toggleExpanded = (key: string) => {
    setExpanded(prev =>
      prev.includes(key)
        ? prev.filter(c => c !== key)
        : [...prev, key]
    );
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0
    }).format(val);
  };

  if (loading) {
    return (
      <div className="card">
        <div className="card-header">Valuation Breakdown</div>
        <div className="card-body">
          <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
            Calculating valuation...
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <div className="card-header">Valuation Breakdown</div>
        <div className="card-body">
          <div style={{ textAlign: 'center', padding: '20px', color: '#ef4444' }}>
            Error loading valuation: {error}
          </div>
        </div>
      </div>
    );
  }

  /**
   * EXPERT VALUATION VIEW
   */
  if (expertValuation) {
    const environmental = expertValuation.environmental_context || {};
    const purchaseFloor = Math.max(
      0,
      (expertValuation.estimated_value || 0) - (expertValuation.documented_components || 0)
    );
    const documentedTotal =
      typeof expertValuation.documented_components === 'number'
        ? expertValuation.documented_components
        : chartSegments.reduce((sum, segment) => sum + segment.value, 0);
    const estimatedValue = expertValuation.estimated_value || 0;
    const requiredEvidence = Array.isArray(expertValuation.required_evidence)
      ? expertValuation.required_evidence
      : [];
    const activeSegmentId =
      (hoveredSegment && chartSegments.some(seg => seg.id === hoveredSegment) && hoveredSegment) ||
      chartSegments[0]?.id ||
      null;
    const activeSegment = chartSegments.find(seg => seg.id === activeSegmentId) || null;
    const totalEvidenceLinks = chartSegments.reduce((sum, seg) => sum + seg.evidenceCount, 0);

    const stats = [
      {
        label: 'Estimated Value',
        value: formatCurrency(estimatedValue),
        helper: expertValuation.valuation_date
          ? `Updated ${new Date(expertValuation.valuation_date).toLocaleDateString()}`
          : 'Awaiting timestamp',
        citation: () =>
          setSelectedCitation({
            type: 'current_value',
            name: 'Estimated Value',
            value: estimatedValue
          })
      },
      {
        label: 'Purchase Floor',
        value: formatCurrency(purchaseFloor),
        helper: 'Baseline without upgrades',
        citation: () =>
          setSelectedCitation({
            type: 'purchase_price',
            name: 'Purchase Floor',
            value: purchaseFloor
          })
      },
      {
        label: 'Documented Components',
        value: formatCurrency(documentedTotal),
        helper: `${expertComponents.length} documented items`,
        citation: () =>
          setSelectedCitation({
            type: 'part_purchase',
            name: 'Documented Components',
            value: documentedTotal
          })
      },
      {
        label: 'Confidence',
        value: `${Math.round(expertValuation.confidence_score ?? (activeSegment?.confidence ?? 0) * 100)}%`,
        helper: 'Model confidence score'
      },
      expertValuation.evidence_score !== undefined && {
        label: 'Evidence Score',
        value: `${expertValuation.evidence_score}/100`,
        helper: 'Coverage completeness'
      }
    ].filter(Boolean) as Array<{
      label: string;
      value: string;
      helper?: string;
      citation?: () => void;
    }>;

    return (
      <div className="card">
        <div
          className="card-header"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap'
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Valuation Intelligence
            </h3>
            <p className="text-small text-muted" style={{ margin: '4px 0 0' }}>
              Powered by VIFF guardrails • {chartSegments.length} documented components
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <div
              style={{
                display: 'flex',
                gap: '6px',
                padding: '4px',
                borderRadius: '999px',
                border: '1px solid var(--border)'
              }}
            >
              {(Object.keys(MODE_SWITCHES) as ChartMode[]).map(mode => (
                <button
                  key={mode}
                  className="btn-utility"
                  style={{
                    fontSize: '10px',
                    padding: '4px 10px',
                    borderRadius: '999px',
                    backgroundColor: chartMode === mode ? 'var(--text)' : 'transparent',
                    color: chartMode === mode ? 'var(--surface)' : 'var(--text)'
                  }}
                  onClick={() => setChartMode(mode)}
                >
                  {MODE_SWITCHES[mode].label}
                </button>
              ))}
            </div>
            {isOwner && (
              <button
                className="button button-primary button-small"
                style={{ fontSize: '10px' }}
                onClick={() => setShowUploader(true)}
              >
                Add Receipt
              </button>
            )}
          </div>
        </div>
        <div className="card-body">
          {chartSegments.length === 0 ? (
            <div
              style={{
                padding: '24px',
                textAlign: 'center',
                border: '1px dashed var(--border)',
                borderRadius: '8px',
                color: 'var(--text-muted)'
              }}
            >
              No documented components yet. Upload detailed photos or receipts to unlock valuation intelligence.
            </div>
          ) : (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(240px, 320px) 1fr',
                  gap: 'var(--space-4)',
                  alignItems: 'flex-start'
                }}
              >
                <div style={{ textAlign: 'center' }}>
                  <div style={{ position: 'relative', width: '240px', height: '240px', margin: '0 auto' }}>
                    <svg width={240} height={240} viewBox="0 0 240 240">
                      {donutSegments.map(segment => (
                        <path
                          key={segment.id}
                          d={segment.path || ''}
                          fill={segment.color}
                          style={{
                            cursor: 'pointer',
                            opacity:
                              hoveredSegment && hoveredSegment !== segment.id
                                ? 0.35
                                : activeSegmentId === segment.id
                                  ? 1
                                  : 0.9,
                            transition: 'opacity 0.2s ease'
                          }}
                          onMouseEnter={() => setHoveredSegment(segment.id)}
                          onMouseLeave={() => setHoveredSegment(null)}
                          onClick={() => setHoveredSegment(segment.id)}
                        />
                      ))}
                    </svg>
                    <div
                      style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        textAlign: 'center'
                      }}
                    >
                      <div
                        style={{
                          fontSize: '11px',
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          color: 'var(--text-muted)'
                        }}
                      >
                        Documented
                      </div>
                      <div style={{ fontSize: '20px', fontWeight: 700 }}>
                        {formatCurrency(documentedTotal)}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        of {formatCurrency(estimatedValue)}
                      </div>
                    </div>
                  </div>
                  <div style={{ marginTop: '12px', fontSize: '11px', color: 'var(--text-muted)' }}>
                    {MODE_SWITCHES[chartMode].helper}
                  </div>
                  {activeSegment && (
                    <div style={{ marginTop: '12px' }}>
                      <div style={{ fontWeight: 600 }}>{activeSegment.label}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        {activeSegment.componentType || 'Component'} •{' '}
                        {Math.round(activeSegment.confidence * 100)}% confidence •{' '}
                        {activeSegment.evidenceCount} evidence
                      </div>
                      <div style={{ fontSize: '16px', fontWeight: 700 }}>
                        {formatCurrency(activeSegment.value)}
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                      gap: '12px'
                    }}
                  >
                    {stats.map(stat => (
                      <div
                        key={stat.label}
                        style={{
                          border: '1px solid var(--border)',
                          borderRadius: '8px',
                          padding: '12px',
                          textAlign: 'left'
                        }}
                      >
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{stat.label}</div>
                        <div style={{ fontSize: '16px', fontWeight: 700, marginTop: '4px' }}>
                          {stat.value}
                        </div>
                        {stat.helper && (
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
                            {stat.helper}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {expertValuation.value_justification && (
                    <div
                      style={{
                        padding: '12px',
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                        background: 'var(--surface)',
                        fontSize: '11px',
                        whiteSpace: 'pre-wrap'
                      }}
                    >
                      {expertValuation.value_justification}
                    </div>
                  )}

                  {requiredEvidence.length > 0 && (
                    <div
                      style={{
                        padding: '12px',
                        borderRadius: '8px',
                        border: '1px solid #facc15',
                        background: '#fef9c3',
                        fontSize: '11px'
                      }}
                    >
                      <div style={{ fontWeight: 600, marginBottom: '6px' }}>Missing Evidence</div>
                      <ul style={{ margin: 0, paddingLeft: '18px' }}>
                        {requiredEvidence.slice(0, 4).map((item: any) => {
                          const key = typeof item === 'string' ? item : JSON.stringify(item);
                          const text =
                            typeof item === 'string'
                              ? item.replace(/_/g, ' ')
                              : JSON.stringify(item);
                          return <li key={key}>{text}</li>;
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ marginTop: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h4 style={{ margin: 0, fontSize: '12px' }}>
                    Documented Components ({chartSegments.length} items)
                  </h4>
                  <div className="text-small text-muted">
                    {totalEvidenceLinks} evidence links across all components
                  </div>
                </div>
                <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {chartSegments.map(segment => {
                    const rawImages =
                      segment.raw?.evidence?.imageUrls || segment.raw?.evidence?.image_urls || [];
                    const rowImages = Array.isArray(rawImages) ? rawImages : [];
                    const hasImages = rowImages.length > 0;
                    const isExpanded = expanded.includes(segment.id);
                    return (
                      <div
                        key={segment.id}
                        style={{
                          border: '1px solid var(--border)',
                          borderRadius: '8px',
                          padding: '12px',
                          background:
                            hoveredSegment && hoveredSegment === segment.id
                              ? 'var(--grey-50)'
                              : 'var(--surface)',
                          transition: 'background 0.15s ease'
                        }}
                        onMouseEnter={() => setHoveredSegment(segment.id)}
                        onMouseLeave={() => setHoveredSegment(null)}
                      >
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 110px 90px 120px',
                            gap: '12px',
                            alignItems: 'center'
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 600 }}>{segment.label}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                              {segment.componentType || 'Component'}
                              {segment.conditionLabel && ` • ${segment.conditionLabel}`}
                              {typeof segment.conditionGrade === 'number' &&
                                ` (${segment.conditionGrade}/10)`}
                            </div>
                            {segment.reasoning && (
                              <div
                                style={{
                                  fontSize: '10px',
                                  color: 'var(--text-muted)',
                                  marginTop: '4px'
                                }}
                              >
                                {segment.reasoning}
                              </div>
                            )}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            {segment.capturedAt
                              ? new Date(segment.capturedAt).toLocaleDateString()
                              : 'No capture date'}
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontWeight: 600 }}>
                              {Math.round(segment.confidence * 100)}%
                            </div>
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>confidence</div>
                          </div>
                          <div style={{ textAlign: 'right', fontWeight: 700 }}>
                            {formatCurrency(segment.value)}
                          </div>
                        </div>
                        <div
                          style={{
                            marginTop: '10px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: '8px'
                          }}
                        >
                          <div className="text-small text-muted">
                            {segment.evidenceCount} media links
                          </div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            {hasImages && (
                              <button
                                className="btn-utility"
                                style={{ fontSize: '10px' }}
                                onClick={() => toggleExpanded(segment.id)}
                              >
                                {isExpanded ? 'Hide media' : 'View media'}
                              </button>
                            )}
                            <button
                              className="btn-utility"
                              style={{ fontSize: '10px' }}
                              onClick={() =>
                                setSelectedCitation({
                                  type: segment.componentType || 'component',
                                  name: segment.label,
                                  value: segment.value
                                })
                              }
                            >
                              Sources
                            </button>
                          </div>
                        </div>
                        {isExpanded && hasImages && (
                          <div
                            style={{
                              marginTop: '10px',
                              borderTop: '1px solid var(--border)',
                              paddingTop: '10px'
                            }}
                          >
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
                                gap: '6px'
                              }}
                            >
                              {rowImages.map((url: string, idx: number) => (
                                <div
                                  key={`${segment.id}-img-${idx}`}
                                  style={{
                                    width: '100%',
                                    paddingBottom: '100%',
                                    borderRadius: '4px',
                                    border: '1px solid var(--border)',
                                    background: `url(${url}) center/cover`,
                                    cursor: 'pointer'
                                  }}
                                  onClick={() => window.open(url, '_blank')}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {environmental && (
                <div
                  style={{
                    marginTop: '24px',
                    padding: '12px',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    background: 'var(--grey-50)',
                    fontSize: '11px'
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: '8px' }}>
                    Environmental Context (5 W's)
                  </div>
                  <div style={{ display: 'grid', gap: '4px' }}>
                    <div>
                      <strong>Who:</strong> {(environmental.who || []).join(', ') || 'Unknown'}
                    </div>
                    <div>
                      <strong>What:</strong> {(environmental.what || []).join(', ') || 'Unknown'}
                    </div>
                    <div>
                      <strong>When:</strong> {environmental.when || 'Unknown'}
                    </div>
                    <div>
                      <strong>Where:</strong> {environmental.where || 'Unknown'}
                    </div>
                    <div>
                      <strong>Why:</strong> {environmental.why || 'Unknown'}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {showUploader && (
          <SmartInvoiceUploader
            vehicleId={vehicleId}
            onClose={() => setShowUploader(false)}
            onSaved={() => {
              setShowUploader(false);
              loadValuation();
            }}
          />
        )}

        {selectedCitation && (
          <CitationModal
            vehicleId={vehicleId}
            componentType={selectedCitation.type}
            componentName={selectedCitation.name}
            valueUsd={selectedCitation.value}
            onClose={() => setSelectedCitation(null)}
          />
        )}
      </div>
    );
  }

  /**
   * LEGACY VALUATION VIEW
   */
  if (!valuation) {
    return null;
  }

  return (
    <div className="card">
      <div
        className="card-header"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        onClick={() => setCollapsed(c => !c)}
        title={collapsed ? 'Expand' : 'Collapse'}
      >
        <span>Valuation Breakdown{collapsed ? ` — ${formatCurrency(valuation.estimatedValue)}` : ''}</span>
        <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
          {valuation.overallConfidence}% confidence
        </div>
      </div>
      
      {!collapsed && (
      <div className="card-body">
        {/* Summary */}
        <div style={{ 
          padding: '12px', 
          background: 'var(--grey-50)', 
          border: '2px solid var(--border)',
          marginBottom: '16px'
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px', fontSize: '9pt' }}>
            <div style={{ fontWeight: 'bold' }}>Purchase Price:</div>
            <div style={{ textAlign: 'right', fontWeight: 'bold' }}>
              {formatCurrency(valuation.purchasePrice)}
            </div>

            {valuation.documentedInvestments > 0 && (
              <>
                <div style={{ color: 'var(--text-muted)' }}>+ Documented Investments:</div>
                <div style={{ textAlign: 'right', color: '#10b981', fontWeight: 'bold' }}>
                  {formatCurrency(valuation.documentedInvestments)}
                </div>
              </>
            )}

            <div style={{ 
              borderTop: '2px solid var(--border)', 
              paddingTop: '8px', 
              fontWeight: 'bold',
              fontSize: '11pt'
            }}>
              Estimated Value:
            </div>
            <div style={{ 
              borderTop: '2px solid var(--border)', 
              paddingTop: '8px',
              textAlign: 'right',
              fontWeight: 'bold',
              fontSize: '11pt',
              color: 'var(--accent)'
            }}>
              {formatCurrency(valuation.estimatedValue)}
            </div>
          </div>

          {/* Market context */}
          {valuation.marketReference > 0 && (
            <div style={{ 
              marginTop: '12px', 
              paddingTop: '12px', 
              borderTop: '1px solid var(--border)',
              fontSize: '8pt',
              color: 'var(--text-muted)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Market Reference:</span>
                <span>{formatCurrency(valuation.marketReference)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                <span>Position:</span>
                <span style={{ 
                  fontWeight: 'bold',
                  color: valuation.marketPosition === 'above' ? '#10b981' : 
                         valuation.marketPosition === 'below' ? '#ef4444' : 
                         'var(--text)'
                }}>
                  {valuation.marketPosition === 'above' ? '↑ Above Market' : 
                   valuation.marketPosition === 'below' ? '↓ Below Market' : 
                   '= At Market'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Warnings */}
        {valuation.warnings.length > 0 && (
          <div style={{ 
            padding: '12px', 
            background: '#fef3c7', 
            border: '1px solid #fbbf24',
            marginBottom: '16px',
            fontSize: '8pt'
          }}>
            {valuation.warnings.map((warning, idx) => (
              <div key={idx} style={{ marginBottom: idx < valuation.warnings.length - 1 ? '6px' : '0' }}>
                {warning}
              </div>
            ))}
          </div>
        )}

        {/* Line Items with Visual Evidence */}
        <div style={{ fontSize: '8pt' }}>
          <div style={{ fontWeight: 'bold', marginBottom: '8px', fontSize: '9pt' }}>
            Investment Timeline ({valuation.lineItems.length} items)
          </div>
          
          {valuation.lineItems.map((item: any, idx: number) => (
            <div 
              key={idx}
              style={{ 
                marginBottom: '8px',
                border: '1px solid var(--border)',
                borderRadius: '2px',
                overflow: 'hidden'
              }}
            >
              {/* Line item header */}
              <div 
                onClick={() => toggleExpanded(item.category + idx)}
                style={{ 
                  padding: '8px',
                  background: 'var(--surface)',
                  cursor: item.evidence.photoCount > 0 ? 'pointer' : 'default',
                  display: 'grid',
                  gridTemplateColumns: '1fr auto auto auto',
                  gap: '8px',
                  alignItems: 'center',
                  transition: 'background 0.12s ease'
                }}
                onMouseEnter={(e) => {
                  if (item.evidence.photoCount > 0) {
                    e.currentTarget.style.background = 'var(--grey-50)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--surface)';
                }}
              >
                <div>
                  <div style={{ fontWeight: 'bold' }}>{item.category}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '7pt' }}>
                    {item.description}
                  </div>
                </div>

                <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                  {new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>

                <div style={{ 
                  fontSize: '7pt',
                  padding: '2px 6px',
                  background: item.evidence.photoCount > 3 ? '#dcfce7' : 
                              item.evidence.photoCount > 0 ? '#fef3c7' : 
                              '#fee2e2',
                  border: '1px solid ' + (
                    item.evidence.photoCount > 3 ? '#86efac' : 
                    item.evidence.photoCount > 0 ? '#fbbf24' : 
                    '#fca5a5'
                  ),
                  borderRadius: '2px'
                }}>
                  {item.evidence.photoCount} {item.evidence.photoCount === 1 ? 'photo' : 'photos'}
                </div>

                <div style={{ fontWeight: 'bold', textAlign: 'right' }}>
                  {formatCurrency(item.amount)}
                </div>
              </div>

              {/* Expandable photo evidence */}
              {expanded.includes(item.category + idx) && item.evidence.imageUrls.length > 0 && (
                <div style={{ 
                  padding: '8px',
                  background: 'var(--grey-50)',
                  borderTop: '1px solid var(--border)'
                }}>
                  <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
                    gap: '6px'
                  }}>
                    {item.evidence.imageUrls.map((url: string, imgIdx: number) => (
                      <div 
                        key={imgIdx}
                        style={{
                          width: '100%',
                          paddingBottom: '100%',
                          background: `url(${url}) center/cover`,
                          border: '1px solid var(--border)',
                          cursor: 'pointer'
                        }}
                        onClick={() => window.open(url.replace('_thumbnail', '_large'), '_blank')}
                      />
                    ))}
                  </div>
                  <div style={{ 
                    marginTop: '6px', 
                    fontSize: '7pt', 
                    color: 'var(--text-muted)',
                    textAlign: 'center'
                  }}>
                    Click images to view full size • {item.confidence}% confidence
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Documentation Score */}
        <div style={{ 
          marginTop: '16px',
          padding: '12px',
          background: 'var(--grey-50)',
          border: '1px solid var(--border)',
          fontSize: '8pt'
        }}>
          <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>Documentation Quality</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ flex: 1, background: 'var(--grey-300)', height: '20px', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ 
                width: `${valuation.documentationScore}%`, 
                height: '100%',
                background: valuation.documentationScore > 70 ? '#10b981' : 
                           valuation.documentationScore > 40 ? '#fbbf24' : 
                           '#ef4444',
                transition: 'width 0.3s ease'
              }} />
            </div>
            <div style={{ fontWeight: 'bold', minWidth: '45px', textAlign: 'right' }}>
              {valuation.documentationScore.toFixed(0)}%
            </div>
          </div>
          <div style={{ marginTop: '6px', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{valuation.imagesWithEvidence} of {valuation.totalImages} photos linked to value claims</span>
            {isOwner && (
              <button
                className="button button-primary button-small"
                onClick={() => setShowUploader(true)}
                style={{ 
                  fontSize: '7pt', 
                  padding: '3px 8px',
                  marginLeft: '8px'
                }}
              >
                + Add Receipt
              </button>
            )}
          </div>
        </div>

        {/* Smart Invoice Uploader Modal */}
        {showUploader && (
          <SmartInvoiceUploader
            vehicleId={vehicleId}
            onClose={() => setShowUploader(false)}
            onSaved={() => {
              setShowUploader(false);
              loadValuation();
            }}
          />
        )}
      </div>
      )}
    </div>
  );
};

