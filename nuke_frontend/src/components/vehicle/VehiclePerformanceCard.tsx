/**
 * VehiclePerformanceCard
 *
 * Video-game-style performance stats visualisation.
 * Radar chart + stat bars + real numbers. All fact-based.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import ScoreDetailModal from './ScoreDetailModal';

interface PerformanceData {
  // Raw specs
  horsepower: number | null;
  torque: number | null;
  weight_lbs: number | null;
  zero_to_sixty: number | null;
  quarter_mile: number | null;
  quarter_mile_speed: number | null;
  top_speed_mph: number | null;
  braking_60_0_ft: number | null;
  lateral_g: number | null;
  redline_rpm: number | null;
  power_to_weight: number | null;
  engine_type: string | null;
  engine_liters: number | null;
  drivetrain: string | null;
  transmission_type: string | null;

  // Composite scores (0-100)
  perf_power_score: number | null;
  perf_acceleration_score: number | null;
  perf_braking_score: number | null;
  perf_handling_score: number | null;
  perf_comfort_score: number | null;
  social_positioning_score: number | null;
  investment_quality_score: number | null;
  provenance_score: number | null;
  overall_desirability_score: number | null;

  // Social breakdown
  social_positioning_breakdown: {
    enthusiast_appeal: number;
    luxury_collector: number;
    investment_grade: number;
    weekend_cruiser: number;
    show_circuit: number;
    youth_appeal: number;
    heritage_prestige: number;
    overall: number;
  } | null;

  // Running gear
  suspension_front: string | null;
  suspension_rear: string | null;
  brake_type_front: string | null;
  brake_type_rear: string | null;
  tire_spec_front: string | null;
  tire_spec_rear: string | null;
  wheel_diameter_front: number | null;
  wheel_diameter_rear: number | null;
  tire_condition_score: number | null;
  brake_condition_score: number | null;
  suspension_condition_score: number | null;

  condition_rating: number | null;
}

interface Props {
  vehicleId: string;
  compact?: boolean;
}

// Radar chart drawing
function drawRadar(
  canvas: HTMLCanvasElement,
  labels: string[],
  values: (number | null)[],
  maxVal = 100,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const size = canvas.clientWidth;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  ctx.scale(dpr, dpr);

  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.38;
  const n = labels.length;
  const angleStep = (2 * Math.PI) / n;
  const startAngle = -Math.PI / 2;

  ctx.clearRect(0, 0, size, size);

  // Grid rings
  for (let ring = 1; ring <= 4; ring++) {
    const r = (radius * ring) / 4;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = startAngle + i * angleStep;
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Axis lines
  for (let i = 0; i < n; i++) {
    const a = startAngle + i * angleStep;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + radius * Math.cos(a), cy + radius * Math.sin(a));
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Data polygon
  const validValues = values.map((v) => (v != null ? Math.min(v, maxVal) : 0));
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const idx = i % n;
    const a = startAngle + idx * angleStep;
    const r = (validValues[idx] / maxVal) * radius;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.06)';
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Data points
  for (let i = 0; i < n; i++) {
    const a = startAngle + i * angleStep;
    const r = (validValues[i] / maxVal) * radius;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, 2 * Math.PI);
    ctx.fillStyle = values[i] != null ? '#000' : '#ccc';
    ctx.fill();
  }

  // Labels
  ctx.font = '600 8px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < n; i++) {
    const a = startAngle + i * angleStep;
    const lr = radius + 18;
    const x = cx + lr * Math.cos(a);
    const y = cy + lr * Math.sin(a);
    ctx.fillText(labels[i], x, y);
  }
}

// Stat bar component
function StatBar({ label, value, max, unit, precision, invert }: {
  label: string;
  value: number | null;
  max: number;
  unit?: string;
  precision?: number;
  invert?: boolean;
}) {
  if (value == null) {
    return (
      <div style={{ marginBottom: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '7pt', fontWeight: 600 }}>
          <span>{label}</span>
          <span style={{ color: '#999' }}>--</span>
        </div>
        <div style={{ height: '4px', background: '#f0f0f0', marginTop: '2px' }} />
      </div>
    );
  }

  const pct = invert
    ? Math.max(0, Math.min(100, ((max - value) / max) * 100))
    : Math.max(0, Math.min(100, (value / max) * 100));

  const displayVal = precision != null ? value.toFixed(precision) : Math.round(value);

  return (
    <div style={{ marginBottom: '6px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '7pt', fontWeight: 600 }}>
        <span>{label}</span>
        <span>{displayVal}{unit || ''}</span>
      </div>
      <div style={{ height: '4px', background: '#f0f0f0', marginTop: '2px', position: 'relative' }}>
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: pct > 80 ? '#000' : pct > 50 ? '#333' : '#666',
            transition: 'width 0.6s ease',
          }}
        />
      </div>
    </div>
  );
}

// Score badge (clickable)
function ScoreBadge({ score, label, size = 'md', onClick }: { score: number | null; label: string; size?: 'sm' | 'md' | 'lg'; onClick?: () => void }) {
  const dim = size === 'lg' ? 64 : size === 'md' ? 48 : 36;
  const fontSize = size === 'lg' ? '18pt' : size === 'md' ? '14pt' : '10pt';
  const labelSize = size === 'lg' ? '8pt' : '7pt';

  const bg = score == null
    ? '#f0f0f0'
    : score >= 80
      ? '#000'
      : score >= 60
        ? '#333'
        : score >= 40
          ? '#666'
          : '#999';

  const color = score == null ? '#999' : '#fff';

  return (
    <div style={{ textAlign: 'center', cursor: onClick ? 'pointer' : 'default' }} onClick={onClick}>
      <div
        style={{
          width: dim,
          height: dim,
          borderRadius: '50%',
          background: bg,
          color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize,
          fontWeight: 800,
          margin: '0 auto 4px',
          border: '2px solid #000',
          transition: 'transform 0.15s ease',
        }}
        onMouseEnter={(e) => onClick && ((e.target as HTMLElement).style.transform = 'scale(1.1)')}
        onMouseLeave={(e) => onClick && ((e.target as HTMLElement).style.transform = 'scale(1)')}
      >
        {score != null ? score : '--'}
      </div>
      <div style={{ fontSize: labelSize, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </div>
    </div>
  );
}

// Social bar
function SocialBar({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
      <span style={{ fontSize: '7pt', fontWeight: 600, width: '90px', textAlign: 'right' }}>{label}</span>
      <div style={{ flex: 1, height: '6px', background: '#f0f0f0', position: 'relative' }}>
        <div
          style={{
            height: '100%',
            width: `${value}%`,
            background: value > 70 ? '#000' : value > 50 ? '#444' : '#888',
            transition: 'width 0.6s ease',
          }}
        />
      </div>
      <span style={{ fontSize: '7pt', fontWeight: 700, width: '24px' }}>{value}</span>
    </div>
  );
}

export default function VehiclePerformanceCard({ vehicleId, compact = false }: Props) {
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSocial, setShowSocial] = useState(false);
  const [showRunningGear, setShowRunningGear] = useState(false);
  const [detailScoreKey, setDetailScoreKey] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    loadData();
  }, [vehicleId]);

  const loadData = async () => {
    try {
      const { data: v, error } = await supabase
        .from('vehicles')
        .select(`
          horsepower, torque, weight_lbs, zero_to_sixty, quarter_mile,
          quarter_mile_speed, top_speed_mph, braking_60_0_ft, lateral_g,
          redline_rpm, power_to_weight, engine_type, engine_liters,
          drivetrain, transmission_type,
          perf_power_score, perf_acceleration_score, perf_braking_score,
          perf_handling_score, perf_comfort_score, social_positioning_score,
          investment_quality_score, provenance_score, overall_desirability_score,
          social_positioning_breakdown,
          suspension_front, suspension_rear, brake_type_front, brake_type_rear,
          tire_spec_front, tire_spec_rear, wheel_diameter_front, wheel_diameter_rear,
          tire_condition_score, brake_condition_score, suspension_condition_score,
          condition_rating
        `)
        .eq('id', vehicleId)
        .single();

      if (!error && v) setData(v as PerformanceData);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  // Draw radar when data changes
  const drawChart = useCallback(() => {
    if (!canvasRef.current || !data) return;
    drawRadar(
      canvasRef.current,
      ['POWER', 'ACCEL', 'BRAKING', 'HANDLING', 'COMFORT', 'SOCIAL', 'INVEST', 'PROVEN.'],
      [
        data.perf_power_score,
        data.perf_acceleration_score,
        data.perf_braking_score,
        data.perf_handling_score,
        data.perf_comfort_score,
        data.social_positioning_score,
        data.investment_quality_score,
        data.provenance_score,
      ],
    );
  }, [data]);

  useEffect(() => {
    drawChart();
    window.addEventListener('resize', drawChart);
    return () => window.removeEventListener('resize', drawChart);
  }, [drawChart]);

  if (loading) {
    return (
      <div style={{ padding: '16px', border: '2px solid #000', background: '#fff' }}>
        <div style={{ fontSize: '8pt', color: '#999' }}>Loading performance data...</div>
      </div>
    );
  }

  if (!data) return null;

  const hasAnyScore = [
    data.perf_power_score, data.perf_acceleration_score, data.perf_braking_score,
    data.perf_handling_score, data.social_positioning_score,
  ].some((s) => s != null);

  if (!hasAnyScore && compact) return null;

  const social = data.social_positioning_breakdown;

  return (
    <div style={{ border: '2px solid #000', background: '#fff' }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '2px solid #000',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div>
          <div style={{ fontSize: '9pt', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px' }}>
            Performance Profile
          </div>
          <div style={{ fontSize: '7pt', color: '#666', marginTop: '2px' }}>
            {data.engine_liters ? `${data.engine_liters}L` : ''}{' '}
            {data.engine_type || ''}{' '}
            {data.drivetrain ? `· ${data.drivetrain}` : ''}{' '}
            {data.transmission_type ? `· ${data.transmission_type}` : ''}
          </div>
        </div>
        <ScoreBadge score={data.overall_desirability_score} label="Overall" size="md" onClick={() => setDetailScoreKey('overall')} />
      </div>

      {/* Main content */}
      <div style={{ padding: '14px' }}>
        {/* Score badges row */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '8px',
          marginBottom: '16px',
        }}>
          <ScoreBadge score={data.perf_power_score} label="Power" size="sm" onClick={() => setDetailScoreKey('power')} />
          <ScoreBadge score={data.perf_acceleration_score} label="Accel" size="sm" onClick={() => setDetailScoreKey('acceleration')} />
          <ScoreBadge score={data.perf_handling_score} label="Handling" size="sm" onClick={() => setDetailScoreKey('handling')} />
          <ScoreBadge score={data.investment_quality_score} label="Invest" size="sm" onClick={() => setDetailScoreKey('investment')} />
        </div>

        {/* Radar chart */}
        {!compact && (
          <div style={{ marginBottom: '16px' }}>
            <canvas
              ref={canvasRef}
              style={{ width: '100%', maxWidth: '280px', aspectRatio: '1', margin: '0 auto', display: 'block' }}
            />
          </div>
        )}

        {/* Raw specs */}
        <div style={{
          padding: '10px 12px',
          background: '#fafafa',
          border: '1px solid #e5e5e5',
          marginBottom: '12px',
        }}>
          <div style={{ fontSize: '8pt', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
            Raw Specs
          </div>
          <StatBar label="Horsepower" value={data.horsepower} max={800} unit=" hp" />
          <StatBar label="Torque" value={data.torque} max={700} unit=" lb-ft" />
          <StatBar label="Weight" value={data.weight_lbs} max={6000} unit=" lbs" invert />
          <StatBar label="Power-to-Weight" value={data.power_to_weight} max={50} unit=" lb/hp" invert />
          <StatBar label="0-60 mph" value={data.zero_to_sixty} max={20} unit="s" precision={1} invert />
          <StatBar label="Quarter Mile" value={data.quarter_mile} max={20} unit="s" precision={1} invert />
          <StatBar label="Top Speed" value={data.top_speed_mph} max={250} unit=" mph" />
          <StatBar label="60-0 Braking" value={data.braking_60_0_ft} max={200} unit=" ft" invert />
          <StatBar label="Lateral G" value={data.lateral_g} max={1.3} precision={2} unit="g" />
          {data.redline_rpm && (
            <StatBar label="Redline" value={data.redline_rpm} max={9000} unit=" rpm" />
          )}
        </div>

        {/* Condition scores */}
        {(data.tire_condition_score != null || data.brake_condition_score != null || data.suspension_condition_score != null) && (
          <div style={{
            padding: '10px 12px',
            background: '#fafafa',
            border: '1px solid #e5e5e5',
            marginBottom: '12px',
          }}>
            <div style={{ fontSize: '8pt', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
              Component Condition
            </div>
            <StatBar label="Tires" value={data.tire_condition_score} max={100} unit="/100" />
            <StatBar label="Brakes" value={data.brake_condition_score} max={100} unit="/100" />
            <StatBar label="Suspension" value={data.suspension_condition_score} max={100} unit="/100" />
          </div>
        )}

        {/* Social positioning (collapsible) */}
        {social && (
          <div style={{
            border: '1px solid #e5e5e5',
            marginBottom: '12px',
          }}>
            <button
              onClick={() => setShowSocial(!showSocial)}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: '#fafafa',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '8pt',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              <span>Social Positioning</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span
                  style={{ fontWeight: 800, fontSize: '9pt', cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={(e) => { e.stopPropagation(); setDetailScoreKey('social'); }}
                >
                  {social.overall}
                </span>
                <span style={{ fontSize: '10pt' }}>{showSocial ? '\u25B2' : '\u25BC'}</span>
              </span>
            </button>
            {showSocial && (
              <div style={{ padding: '10px 12px' }}>
                <SocialBar label="Enthusiast" value={social.enthusiast_appeal} />
                <SocialBar label="Luxury" value={social.luxury_collector} />
                <SocialBar label="Investment" value={social.investment_grade} />
                <SocialBar label="Cruiser" value={social.weekend_cruiser} />
                <SocialBar label="Show Circuit" value={social.show_circuit} />
                <SocialBar label="Youth" value={social.youth_appeal} />
                <SocialBar label="Heritage" value={social.heritage_prestige} />
              </div>
            )}
          </div>
        )}

        {/* Running gear (collapsible) */}
        {(data.suspension_front || data.brake_type_front || data.tire_spec_front) && (
          <div style={{ border: '1px solid #e5e5e5' }}>
            <button
              onClick={() => setShowRunningGear(!showRunningGear)}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: '#fafafa',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '8pt',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              <span>Running Gear</span>
              <span style={{ fontSize: '10pt' }}>{showRunningGear ? '\u25B2' : '\u25BC'}</span>
            </button>
            {showRunningGear && (
              <div style={{ padding: '10px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '7pt' }}>
                {data.suspension_front && (
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: '2px' }}>Suspension (F)</div>
                    <div style={{ color: '#666' }}>{data.suspension_front}</div>
                  </div>
                )}
                {data.suspension_rear && (
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: '2px' }}>Suspension (R)</div>
                    <div style={{ color: '#666' }}>{data.suspension_rear}</div>
                  </div>
                )}
                {data.brake_type_front && (
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: '2px' }}>Brakes (F)</div>
                    <div style={{ color: '#666' }}>{data.brake_type_front}</div>
                  </div>
                )}
                {data.brake_type_rear && (
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: '2px' }}>Brakes (R)</div>
                    <div style={{ color: '#666' }}>{data.brake_type_rear}</div>
                  </div>
                )}
                {data.tire_spec_front && (
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: '2px' }}>Tires (F)</div>
                    <div style={{ color: '#666' }}>{data.tire_spec_front}</div>
                  </div>
                )}
                {data.tire_spec_rear && (
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: '2px' }}>Tires (R)</div>
                    <div style={{ color: '#666' }}>{data.tire_spec_rear}</div>
                  </div>
                )}
                {data.wheel_diameter_front && (
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: '2px' }}>Wheels (F)</div>
                    <div style={{ color: '#666' }}>{data.wheel_diameter_front}"</div>
                  </div>
                )}
                {data.wheel_diameter_rear && (
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: '2px' }}>Wheels (R)</div>
                    <div style={{ color: '#666' }}>{data.wheel_diameter_rear}"</div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Missing data CTA */}
        {!hasAnyScore && (
          <div style={{
            padding: '12px',
            background: '#fafafa',
            border: '1px solid #e5e5e5',
            textAlign: 'center',
            marginTop: '12px',
          }}>
            <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '4px' }}>
              Performance data needed
            </div>
            <div style={{ fontSize: '7pt', color: '#666' }}>
              Add horsepower, torque, weight, and 0-60 time to unlock full performance scoring.
            </div>
          </div>
        )}
      </div>

      {/* Score detail modal */}
      {detailScoreKey && (
        <ScoreDetailModal
          vehicleId={vehicleId}
          scoreKey={detailScoreKey}
          onClose={() => setDetailScoreKey(null)}
        />
      )}
    </div>
  );
}
