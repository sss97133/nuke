import React, { useEffect, useMemo, useState, Suspense } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';

// Lazy load the 3D model annotator (2.7MB with Three.js) - only loads when user visits this page
const ModelHarnessAnnotator = React.lazy(() =>
  import('../components/wiring/ModelHarnessAnnotator').then(m => ({ default: m.ModelHarnessAnnotator }))
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

export default function WiringPlan() {
  const navigate = useNavigate();
  const { vehicleId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialQuery = useMemo(() => searchParams.get('q') || '', [searchParams]);

  const [vehicleInfo, setVehicleInfo] = useState<{ year?: number; make?: string; model?: string } | null>(null);
  const [input, setInput] = useState(initialQuery);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WiringResult | null>(null);

  useEffect(() => {
    const loadVehicle = async () => {
      if (!vehicleId) return;
      try {
        const { data, error: e } = await supabase
          .from('vehicles')
          .select('year, make, model')
          .eq('id', vehicleId)
          .maybeSingle();
        if (!e && data) setVehicleInfo({ year: data.year, make: data.make, model: data.model });
      } catch {
        // ignore
      }
    };
    loadVehicle();
  }, [vehicleId]);


  const handleGenerate = async () => {
    if (!vehicleId || !input.trim() || isProcessing) return;

    setIsProcessing(true);
    setError(null);
    setResult(null);

    // keep URL in sync for shareability
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

  // Auto-run if user navigated here with ?q=...
  useEffect(() => {
    if (!initialQuery.trim()) return;
    // avoid re-running if we already have a result for the current query
    if (result?.query === initialQuery) return;
    // run once on entry
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    handleGenerate();
    // intentionally omit handleGenerate from deps to prevent loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery, vehicleId]);

  const vehicleLabel = vehicleInfo?.year || vehicleInfo?.make || vehicleInfo?.model
    ? `${vehicleInfo?.year || ''} ${vehicleInfo?.make || ''} ${vehicleInfo?.model || ''}`.trim()
    : (vehicleId ? `Vehicle ${vehicleId}` : 'Vehicle');

  const recommendations = Array.isArray(result?.recommendations) ? result?.recommendations : [];
  const nextSteps = result?.next_steps;

  return (
    <div style={{ padding: '16px', maxWidth: '1000px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '12px' }}>
        <div>
          <div style={{ fontWeight: 'bold', fontSize: '12pt' }}>Wiring Plan</div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>{vehicleLabel}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="button-win95"
            onClick={() => navigate(`/vehicle/${vehicleId}`)}
          >
            Back to Vehicle
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: '12px' }}>
        <div style={{ fontWeight: 'bold', fontSize: '9pt', marginBottom: '6px' }}>Describe what you’re building</div>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Example: Full Motec ECU + harness, bulkhead connector plan, service loops, labeling, and a parts list for a '77 K5 with EFI..."
          style={{
            width: '100%',
            minHeight: '84px',
            fontSize: '8pt',
            fontFamily: '"MS Sans Serif", sans-serif',
            padding: '8px',
            border: '2px solid var(--border)',
            borderRadius: '2px',
            resize: 'vertical',
          }}
          disabled={isProcessing}
        />
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px' }}>
          <button
            type="button"
            className="button-win95"
            onClick={handleGenerate}
            disabled={isProcessing || !input.trim()}
            title="Generate a structured wiring plan"
          >
            {isProcessing ? 'Generating…' : 'Generate Plan'}
          </button>
          <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
            Tip: use the top chat bar to upload receipts/manuals and answer missing questions—this page is for long-form output.
          </div>
        </div>
      </div>

      {vehicleId && (
        <div style={{ marginTop: '12px' }}>
          <Suspense fallback={<div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading 3D viewer...</div>}>
            <ModelHarnessAnnotator vehicleId={vehicleId} />
          </Suspense>
        </div>
      )}

      {error && (
        <div style={{ marginTop: '12px', padding: '8px', background: '#ffebee', border: '1px solid #f44336', borderRadius: '2px', fontSize: '8pt', color: '#c62828' }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: '12px', display: 'grid', gap: '12px' }}>
          <div className="card" style={{ padding: '12px' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>Overview</div>
            <div style={{ fontSize: '8pt', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>
              {result.system_description || 'No system description returned.'}
            </div>
          </div>

          <div className="card" style={{ padding: '12px' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>Parts (starter list)</div>
            {recommendations.length === 0 ? (
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>No recommendations returned.</div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: '18px', listStyleType: 'disc', lineHeight: 1.35 }}>
                {recommendations.slice(0, 25).map((rec: any, idx: number) => {
                  const isObj = rec && typeof rec === 'object';
                  const part = isObj ? (rec.part_number || rec.partNumber) : null;
                  const name = isObj ? rec.name : null;
                  const required = isObj ? rec.required : null;
                  const reason = isObj ? rec.reason : null;
                  const label = isObj ? (name || part) : String(rec);

                  return (
                    <li key={idx} style={{ marginBottom: '4px', display: 'list-item' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600 }}>{label}</span>
                        {part && name && <span style={{ color: 'var(--text-muted)' }}>({part})</span>}
                        {required !== null && (
                          <span style={{ fontSize: '7pt', color: required ? '#0b7a0b' : 'var(--text-muted)' }}>
                            {required ? 'Required' : 'Optional'}
                          </span>
                        )}
                      </div>
                      {reason && (
                        <div style={{ marginTop: '2px', fontSize: '7pt', color: 'var(--text-muted)' }}>
                          {reason}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="card" style={{ padding: '12px' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>Next steps</div>
            {Array.isArray(nextSteps) ? (
              <ol style={{ margin: 0, paddingLeft: '18px', listStyleType: 'decimal', lineHeight: 1.35, fontSize: '8pt' }}>
                {nextSteps.slice(0, 20).map((step: any, idx: number) => (
                  <li key={idx} style={{ marginBottom: '4px', display: 'list-item' }}>{String(step)}</li>
                ))}
              </ol>
            ) : (
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>
                {nextSteps ? String(nextSteps) : 'No next steps returned.'}
              </div>
            )}
          </div>

          {result.quote && (
            <div className="card" style={{ padding: '12px' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>Quote (rough)</div>
              <div style={{ fontSize: '8pt', lineHeight: 1.35 }}>
                <div>Parts: ${result.quote?.pricing?.parts_subtotal?.toFixed?.(2) ?? '0.00'}</div>
                <div>Labor: ${result.quote?.pricing?.labor_total?.toFixed?.(2) ?? '0.00'}</div>
                <div style={{ fontWeight: 'bold', marginTop: '4px' }}>
                  Total: ${result.quote?.pricing?.grand_total?.toFixed?.(2) ?? '0.00'}
                </div>
              </div>
            </div>
          )}

          <div className="card" style={{ padding: '12px' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>Coming next</div>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', lineHeight: 1.35 }}>
              Blueprints/diagrams, pinouts, labeling plan, harness segmentation, and export (PDF) belong here. We’ll evolve the edge function output into a multi-page “wiring package” once the UI home is correct.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


