import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

interface AnalysisResult {
  success: boolean;
  message?: string;
  total_images?: number;
  analyzed?: number;
  skipped?: number;
  failed?: number;
  failures?: Array<{ image_id: string; error: string }>;
  error?: string;
}

export default function BatchImageAnalysis() {
  const [searchParams] = useSearchParams();
  const [vehicleId, setVehicleId] = useState('');
  const [maxImages, setMaxImages] = useState<number | ''>('');
  const [forceReanalysis, setForceReanalysis] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);

  // Load vehicle ID from URL params
  useEffect(() => {
    const vehicleParam = searchParams.get('vehicle');
    if (vehicleParam) {
      setVehicleId(vehicleParam);
    }
  }, [searchParams]);

  const handleAnalyze = async () => {
    if (!vehicleId.trim()) {
      alert('Please enter a vehicle ID');
      return;
    }

    setAnalyzing(true);
    setProgress('Starting batch analysis...');
    setResult(null);

    try {
      const body: any = {
        vehicle_id: vehicleId.trim(),
        force_reanalysis: forceReanalysis
      };

      if (maxImages && maxImages > 0) {
        body.max_images = maxImages;
      }

      setProgress('Sending request to batch analyzer...');

      const { data, error } = await supabase.functions.invoke('batch-analyze-vehicle', {
        body
      });

      if (error) {
        throw new Error(error.message || 'Analysis failed');
      }

      setResult(data);
      setProgress('Analysis complete!');
    } catch (error) {
      setResult({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      setProgress('Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleQuickTest = () => {
    // Preset: Bronco with 10 images
    setVehicleId('79fe1a2b-9099-45b5-92c0-54e7f896089e');
    setMaxImages(10);
    setForceReanalysis(false);
  };

  const handleFullBronco = () => {
    // Preset: Full Bronco analysis
    setVehicleId('79fe1a2b-9099-45b5-92c0-54e7f896089e');
    setMaxImages('');
    setForceReanalysis(false);
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto', background: 'var(--surface)' }}>
      <div style={{ marginBottom: '24px' }}>
        <button
          onClick={() => window.location.href = '/admin'}
          className="cursor-button"
          style={{
            padding: '8px 16px',
            border: '2px solid var(--border)',
            borderRadius: '2px',
            background: 'var(--surface)',
            cursor: 'pointer',
            fontSize: '8pt',
            fontWeight: 600,
            transition: 'all 0.12s ease'
          }}
        >
          BACK TO ADMIN
        </button>
      </div>

      <h1 style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        Batch Image Analysis
      </h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '24px', fontSize: '8pt' }}>
        Analyze all images for a vehicle using AI (Rekognition + OpenAI Vision)
      </p>

      {/* Quick Presets */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-header" style={{ fontSize: '8pt', fontWeight: 700, letterSpacing: '0.5px' }}>
          QUICK PRESETS
        </div>
        <div className="card-body">
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={handleQuickTest}
              disabled={analyzing}
              className="cursor-button"
              style={{
                padding: '8px 16px',
                border: '2px solid var(--border)',
                borderRadius: '2px',
                background: 'var(--surface)',
                color: 'var(--text)',
                cursor: analyzing ? 'not-allowed' : 'pointer',
                opacity: analyzing ? 0.5 : 1,
                fontSize: '8pt',
                fontWeight: 600,
                transition: 'all 0.12s ease'
              }}
            >
              TEST: BRONCO (10 IMAGES)
            </button>
            <button
              onClick={handleFullBronco}
              disabled={analyzing}
              className="cursor-button"
              style={{
                padding: '8px 16px',
                border: '2px solid var(--accent)',
                borderRadius: '2px',
                background: 'var(--accent)',
                color: 'white',
                cursor: analyzing ? 'not-allowed' : 'pointer',
                opacity: analyzing ? 0.5 : 1,
                fontSize: '8pt',
                fontWeight: 600,
                transition: 'all 0.12s ease'
              }}
            >
              FULL: BRONCO (ALL 239 IMAGES)
            </button>
          </div>
        </div>
      </div>

      {/* Configuration Form */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-header" style={{ fontSize: '8pt', fontWeight: 700, letterSpacing: '0.5px' }}>
          CONFIGURATION
        </div>
        <div className="card-body">
          <div style={{ marginBottom: '16px' }}>
            <label className="form-label" style={{ fontSize: '8pt', fontWeight: 600 }}>
              VEHICLE ID *
            </label>
            <input
              type="text"
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              placeholder="79fe1a2b-9099-45b5-92c0-54e7f896089e"
              disabled={analyzing}
              className="form-input"
              style={{
                width: '100%',
                fontSize: '8pt',
                fontFamily: 'monospace'
              }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label className="form-label" style={{ fontSize: '8pt', fontWeight: 600 }}>
              MAX IMAGES (OPTIONAL)
            </label>
            <input
              type="number"
              value={maxImages}
              onChange={(e) => setMaxImages(e.target.value ? parseInt(e.target.value) : '')}
              placeholder="Leave empty for all images"
              disabled={analyzing}
              className="form-input"
              style={{
                width: '200px',
                fontSize: '8pt'
              }}
            />
            <p style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px' }}>
              Limit number of images to analyze (useful for testing)
            </p>
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: analyzing ? 'not-allowed' : 'pointer',
              fontSize: '8pt'
            }}>
              <input
                type="checkbox"
                checked={forceReanalysis}
                onChange={(e) => setForceReanalysis(e.target.checked)}
                disabled={analyzing}
              />
              <span>
                Force reanalysis (re-analyze even if already analyzed)
              </span>
            </label>
          </div>

          <button
            onClick={handleAnalyze}
            disabled={analyzing || !vehicleId.trim()}
            className="cursor-button"
            style={{
              padding: '12px 24px',
              border: '2px solid var(--accent)',
              borderRadius: '2px',
              background: analyzing || !vehicleId.trim() ? 'var(--border)' : 'var(--accent)',
              color: 'white',
              fontWeight: 600,
              cursor: analyzing || !vehicleId.trim() ? 'not-allowed' : 'pointer',
              fontSize: '8pt',
              transition: 'all 0.12s ease'
            }}
          >
            {analyzing ? 'ANALYZING...' : 'START ANALYSIS'}
          </button>

          {progress && (
            <div className="card" style={{
              marginTop: '16px',
              background: 'var(--bg)',
              fontSize: '8pt',
              fontWeight: 600
            }}>
              <div className="card-body">
                {progress}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      {result && (
        <div className="card" style={{
          background: result.success ? 'var(--surface)' : 'var(--surface)',
          border: `2px solid ${result.success ? 'var(--success)' : 'var(--error)'}`,
        }}>
          <div className="card-header" style={{
            fontSize: '8pt',
            fontWeight: 700,
            letterSpacing: '0.5px',
            color: result.success ? 'var(--success)' : 'var(--error)'
          }}>
            {result.success ? 'ANALYSIS COMPLETE' : 'ANALYSIS FAILED'}
          </div>
          <div className="card-body">

          {result.message && (
            <p style={{ marginBottom: '16px', fontSize: '8pt' }}>
              {result.message}
            </p>
          )}

          {result.success && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '16px' }}>
              <div className="card" style={{ border: '2px solid var(--border)' }}>
                <div className="card-body">
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600, letterSpacing: '0.5px' }}>
                    TOTAL IMAGES
                  </div>
                  <div style={{ fontSize: '14pt', fontWeight: 700 }}>
                    {result.total_images || 0}
                  </div>
                </div>
              </div>

              <div className="card" style={{ border: '2px solid var(--success)' }}>
                <div className="card-body">
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600, letterSpacing: '0.5px' }}>
                    ANALYZED
                  </div>
                  <div style={{ fontSize: '14pt', fontWeight: 700, color: 'var(--success)' }}>
                    {result.analyzed || 0}
                  </div>
                </div>
              </div>

              <div className="card" style={{ border: '2px solid var(--border)' }}>
                <div className="card-body">
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600, letterSpacing: '0.5px' }}>
                    SKIPPED
                  </div>
                  <div style={{ fontSize: '14pt', fontWeight: 700, color: 'var(--text-muted)' }}>
                    {result.skipped || 0}
                  </div>
                </div>
              </div>

              <div className="card" style={{ border: '2px solid var(--error)' }}>
                <div className="card-body">
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600, letterSpacing: '0.5px' }}>
                    FAILED
                  </div>
                  <div style={{ fontSize: '14pt', fontWeight: 700, color: 'var(--error)' }}>
                    {result.failed || 0}
                  </div>
                </div>
              </div>
            </div>
          )}

          {result.error && (
            <div className="card" style={{
              border: '2px solid var(--error)',
              background: 'var(--bg)',
              fontSize: '8pt',
              fontFamily: 'monospace'
            }}>
              <div className="card-body">
                {result.error}
              </div>
            </div>
          )}

          {result.failures && result.failures.length > 0 && (
            <div style={{ marginTop: '16px' }}>
              <h3 style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '8px', letterSpacing: '0.5px' }}>
                FAILURES
              </h3>
              <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                {result.failures.map((failure, idx) => (
                  <div key={idx} className="card" style={{
                    border: '2px solid var(--error)',
                    background: 'var(--bg)',
                    marginBottom: '8px',
                    fontSize: '8pt',
                    fontFamily: 'monospace'
                  }}>
                    <div className="card-body">
                      <div><strong>Image:</strong> {failure.image_id}</div>
                      <div><strong>Error:</strong> {failure.error}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.success && result.analyzed && result.analyzed > 0 && (
            <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '2px solid var(--success)' }}>
              <h3 style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '8px', letterSpacing: '0.5px' }}>
                NEXT STEPS
              </h3>
              <ol style={{ marginLeft: '20px', fontSize: '8pt', lineHeight: '1.6' }}>
                <li>Refresh the vehicle profile page to see updated valuation</li>
                <li>Check image tags: Look for AI-detected parts and systems</li>
                <li>Review profile insights: AI summary of build quality</li>
                <li>Verify valuation increased based on detected quality</li>
              </ol>
            </div>
          )}
          </div>
        </div>
      )}

      {/* Documentation */}
      <div className="card" style={{ marginTop: '32px' }}>
        <div className="card-header" style={{ fontSize: '8pt', fontWeight: 700, letterSpacing: '0.5px' }}>
          DOCUMENTATION
        </div>
        <div className="card-body" style={{ fontSize: '8pt', lineHeight: '1.6' }}>
          <h3 style={{ fontWeight: 700, marginBottom: '8px', fontSize: '8pt', letterSpacing: '0.5px' }}>WHAT THIS DOES</h3>
          <ul style={{ marginLeft: '20px', marginBottom: '12px' }}>
            <li>Analyzes all vehicle images using AI (AWS Rekognition + OpenAI Vision)</li>
            <li>Detects parts, systems, build quality, paint condition, modifications</li>
            <li>Creates image_tags, component_conditions, paint_assessments</li>
            <li>Generates profile_image_insights summary</li>
            <li>Valuation service automatically uses results to adjust estimates</li>
          </ul>

          <h3 style={{ fontWeight: 700, marginBottom: '8px', fontSize: '8pt', letterSpacing: '0.5px' }}>TIME AND COST</h3>
          <ul style={{ marginLeft: '20px' }}>
            <li><strong>Time:</strong> 2-5 seconds per image (239 images = 5-8 minutes)</li>
            <li><strong>Cost:</strong> $0.02 per image via OpenAI GPT-4o (239 images = $5)</li>
            <li><strong>Rate Limits:</strong> Processes 5 images at a time to avoid throttling</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

