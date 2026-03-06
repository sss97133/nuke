import React, { useEffect, useMemo, useState, Suspense, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { HarnessDesign, HarnessTemplate } from '../components/wiring/harnessTypes';

const HarnessBuilder = React.lazy(() =>
  import('../components/wiring/HarnessBuilder').then(m => ({ default: m.HarnessBuilder }))
);

type WiringResult = {
  success?: boolean;
  error?: string;
  query?: string;
  vehicle?: any;
  system_description?: string;
  recommendations?: any[];
  products_found?: number;
  quote?: any;
  next_steps?: any[] | string;
};

type ViewMode = 'builder' | 'ai_assistant';

export default function WiringPlan() {
  const navigate = useNavigate();
  const { vehicleId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialQuery = useMemo(() => searchParams.get('q') || '', [searchParams]);

  const [vehicleInfo, setVehicleInfo] = useState<{ year?: number; make?: string; model?: string } | null>(null);
  const [designId, setDesignId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<HarnessTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('builder');

  // AI Assistant state
  const [input, setInput] = useState(initialQuery);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WiringResult | null>(null);

  // Load vehicle info + check for existing design
  useEffect(() => {
    async function init() {
      if (!vehicleId) return;
      setLoading(true);
      try {
        const [vehicleRes, designRes, templateRes] = await Promise.all([
          supabase.from('vehicles').select('year, make, model').eq('id', vehicleId).maybeSingle(),
          supabase.from('harness_designs').select('id, name, status, total_endpoints').eq('vehicle_id', vehicleId).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
          supabase.from('harness_templates').select('*').eq('is_public', true).order('name'),
        ]);

        if (vehicleRes.data) {
          setVehicleInfo({ year: vehicleRes.data.year, make: vehicleRes.data.make, model: vehicleRes.data.model });
        }
        if (designRes.data) {
          setDesignId(designRes.data.id);
        }
        if (templateRes.data) {
          setTemplates(templateRes.data);
        }
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [vehicleId]);

  // If we have an AI query, switch to AI mode
  useEffect(() => {
    if (initialQuery.trim()) setViewMode('ai_assistant');
  }, [initialQuery]);

  const vehicleLabel = vehicleInfo?.year || vehicleInfo?.make || vehicleInfo?.model
    ? `${vehicleInfo?.year || ''} ${vehicleInfo?.make || ''} ${vehicleInfo?.model || ''}`.trim()
    : (vehicleId ? `Vehicle ${vehicleId}` : 'Vehicle');

  // Determine vehicle type heuristic
  const vehicleType = useMemo(() => {
    const model = (vehicleInfo?.model || '').toLowerCase();
    if (/roadster|coupe|sedan|gt|sports/i.test(model)) return 'hot_rod';
    if (/k5|k10|k20|k30|c10|c20|c30|f-?\d|silverado|blazer|bronco|truck|pickup/i.test(model)) return 'truck';
    return 'car';
  }, [vehicleInfo]);

  // Create blank design
  const handleCreateDesign = useCallback(async (templateId?: string) => {
    if (!vehicleId) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;

    const template = templateId ? templates.find(t => t.id === templateId) : null;

    const { data: design, error: err } = await supabase.from('harness_designs').insert({
      vehicle_id: vehicleId,
      user_id: session.user.id,
      name: template ? `${vehicleLabel} — ${template.name}` : `${vehicleLabel} Harness`,
      vehicle_type: vehicleType,
      ecu_platform: template?.ecu_platform || null,
      template_id: templateId || null,
      status: 'draft',
    }).select('id').single();

    if (err || !design) {
      setError('Failed to create design: ' + (err?.message || 'Unknown error'));
      return;
    }

    // If from template, populate sections and endpoints
    if (template?.template_data) {
      const td = template.template_data;
      const sectionMap = new Map<string, string>();

      // Create sections
      if (td.sections) {
        for (const sec of td.sections) {
          const { data: sData } = await supabase.from('harness_sections').insert({
            design_id: design.id,
            name: sec.name,
            section_type: sec.section_type,
            color: sec.color,
            sort_order: sec.sort_order,
          }).select('id').single();
          if (sData) sectionMap.set(sec.section_type, sData.id);
        }
      }

      // Create endpoints with staggered positions
      if (td.endpoints) {
        const sectionPositions = new Map<string, { x: number; y: number }>();
        const sectionColumns: Record<string, number> = { engine: 0, transmission: 1, chassis: 2, interior: 3 };

        for (let i = 0; i < td.endpoints.length; i++) {
          const ep = td.endpoints[i];
          const sectionId = sectionMap.get(ep.section) || null;
          const col = sectionColumns[ep.section] ?? Math.floor(i / 10);
          const pos = sectionPositions.get(ep.section) || { x: col * 200 + 20, y: 20 };

          await supabase.from('harness_endpoints').insert({
            design_id: design.id,
            section_id: sectionId,
            name: ep.name,
            endpoint_type: ep.endpoint_type,
            system_category: ep.system_category,
            amperage_draw: ep.amperage_draw || null,
            peak_amperage: ep.peak_amperage || null,
            voltage: ep.voltage || 12,
            connector_type: ep.connector_type || null,
            pin_count: ep.pin_count || null,
            location_zone: ep.location_zone || null,
            part_number: ep.part_number || null,
            canvas_x: pos.x,
            canvas_y: pos.y,
          });

          pos.y += 85;
          sectionPositions.set(ep.section, pos);
        }
      }
    }

    setDesignId(design.id);
  }, [vehicleId, vehicleLabel, vehicleType, templates]);

  // AI assistant handler
  const handleGenerate = async () => {
    if (!vehicleId || !input.trim() || isProcessing) return;
    setIsProcessing(true);
    setError(null);
    setResult(null);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('q', input.trim());
      return next;
    });
    try {
      const { data, error: fnError } = await supabase.functions.invoke('query-wiring-needs', {
        body: {
          query: input.trim(),
          vehicle_id: vehicleId,
          vehicle_year: vehicleInfo?.year,
          vehicle_make: vehicleInfo?.make,
          vehicle_model: vehicleInfo?.model,
        },
      });
      if (fnError) throw new Error(fnError.message || 'Failed to generate wiring plan');
      if (data?.error) throw new Error(data.error);
      setResult(data as WiringResult);
    } catch (err: any) {
      setError(err?.message || 'Failed to generate wiring plan');
    } finally {
      setIsProcessing(false);
    }
  };

  // Auto-run AI if navigated with ?q=
  useEffect(() => {
    if (!initialQuery.trim()) return;
    if (result?.query === initialQuery) return;
    handleGenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery, vehicleId]);

  const recommendations = Array.isArray(result?.recommendations) ? result?.recommendations : [];

  if (loading) {
    return <div style={{ padding: '20px', color: 'var(--text-muted)' }}>Loading...</div>;
  }

  return (
    <div style={{ padding: '8px 16px', maxWidth: designId && viewMode === 'builder' ? undefined : '1000px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
        <div>
          <div style={{ fontWeight: 'bold', fontSize: '14px' }}>Wiring Harness</div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{vehicleLabel}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {designId && (
            <>
              <button
                className="button-win95"
                onClick={() => setViewMode('builder')}
                style={{ fontWeight: viewMode === 'builder' ? 700 : 400 }}
              >
                BUILDER
              </button>
              <button
                className="button-win95"
                onClick={() => setViewMode('ai_assistant')}
                style={{ fontWeight: viewMode === 'ai_assistant' ? 700 : 400 }}
              >
                AI ASSIST
              </button>
            </>
          )}
          <button className="button-win95" onClick={() => navigate(`/vehicle/${vehicleId}`)}>
            BACK
          </button>
        </div>
      </div>

      {/* No design yet — show creation UI */}
      {!designId && (
        <div style={{ display: 'grid', gap: '12px' }}>
          <div className="card" style={{ padding: '16px' }}>
            <div style={{ fontWeight: 'bold', fontSize: '12px', marginBottom: '8px' }}>Start a Harness Design</div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '12px', lineHeight: 1.4 }}>
              Create a visual wiring harness layout for this vehicle. Place endpoints, draw wires, and the system calculates gauges, loads, and generates a BOM.
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button className="button-win95" onClick={() => handleCreateDesign()} style={{ fontWeight: 700 }}>
                BLANK CANVAS
              </button>
              {templates.map(t => (
                <button key={t.id} className="button-win95" onClick={() => handleCreateDesign(t.id)}>
                  {t.name.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div style={{ padding: '8px', background: 'var(--error-dim)', border: '2px solid var(--error)', fontSize: '10px', color: 'var(--error)' }}>
              {error}
            </div>
          )}
        </div>
      )}

      {/* Builder view */}
      {designId && viewMode === 'builder' && (
        <Suspense fallback={<div style={{ padding: '20px', color: 'var(--text-muted)' }}>Loading harness builder...</div>}>
          <HarnessBuilder designId={designId} vehicleId={vehicleId!} vehicleType={vehicleType} />
        </Suspense>
      )}

      {/* AI Assistant view */}
      {viewMode === 'ai_assistant' && (
        <div style={{ display: 'grid', gap: '12px' }}>
          <div className="card" style={{ padding: '12px' }}>
            <div style={{ fontWeight: 'bold', fontSize: '11px', marginBottom: '6px' }}>AI Wiring Assistant</div>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Example: Full Motec ECU + harness, bulkhead connector plan, service loops..."
              style={{
                width: '100%',
                minHeight: '64px',
                fontSize: '10px',
                fontFamily: 'Arial, sans-serif',
                padding: '6px',
                border: '2px solid var(--border)',
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
              disabled={isProcessing}
            />
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '6px' }}>
              <button className="button-win95" onClick={handleGenerate} disabled={isProcessing || !input.trim()}>
                {isProcessing ? 'GENERATING...' : 'GENERATE'}
              </button>
            </div>
          </div>

          {error && (
            <div style={{ padding: '8px', background: 'var(--error-dim)', border: '2px solid var(--error)', fontSize: '10px', color: 'var(--error)' }}>
              {error}
            </div>
          )}

          {result && (
            <div style={{ display: 'grid', gap: '10px' }}>
              {result.system_description && (
                <div className="card" style={{ padding: '10px' }}>
                  <div style={{ fontWeight: 'bold', fontSize: '10px', marginBottom: '4px' }}>Overview</div>
                  <div style={{ fontSize: '10px', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>{result.system_description}</div>
                </div>
              )}

              {recommendations.length > 0 && (
                <div className="card" style={{ padding: '10px' }}>
                  <div style={{ fontWeight: 'bold', fontSize: '10px', marginBottom: '4px' }}>Parts</div>
                  <ul style={{ margin: 0, paddingLeft: '16px', lineHeight: 1.3, fontSize: '10px' }}>
                    {recommendations.slice(0, 25).map((rec: any, idx: number) => {
                      const isObj = rec && typeof rec === 'object';
                      const label = isObj ? (rec.name || rec.part_number) : String(rec);
                      return (
                        <li key={idx} style={{ marginBottom: '3px' }}>
                          <strong>{label}</strong>
                          {isObj && rec.reason && <span style={{ color: 'var(--text-muted)', fontSize: '9px' }}> — {rec.reason}</span>}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {result.quote && (
                <div className="card" style={{ padding: '10px' }}>
                  <div style={{ fontWeight: 'bold', fontSize: '10px', marginBottom: '4px' }}>Quote</div>
                  <div style={{ fontSize: '10px', fontFamily: '"Courier New", monospace' }}>
                    <div>Parts: ${result.quote?.pricing?.parts_subtotal?.toFixed?.(2) ?? '0.00'}</div>
                    <div>Labor: ${result.quote?.pricing?.labor_total?.toFixed?.(2) ?? '0.00'}</div>
                    <div style={{ fontWeight: 'bold', marginTop: '2px' }}>
                      Total: ${result.quote?.pricing?.grand_total?.toFixed?.(2) ?? '0.00'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
