import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';

interface AnalysisStats {
  total: number;
  analyzed: number;
  pending: number;
  percent: number;
  rate: number; // images per minute
  elapsed: number; // minutes
  eta: number; // minutes remaining
  lastUpdate: number; // images processed since last check
}

export default function LiveImageAnalysisMonitor() {
  const [stats, setStats] = useState<AnalysisStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [startTime] = useState(Date.now());
  const lastCountRef = useRef(0);

  useEffect(() => {
    loadStats();
    
    if (autoRefresh) {
      const interval = setInterval(loadStats, 5000); // Refresh every 5 seconds
      return () => clearInterval(interval);
    }
  }, [autoRefresh, startTime]);

  async function loadStats() {
    try {
      // Get total images
      const { count: total } = await supabase
        .from('vehicle_images')
        .select('*', { count: 'exact', head: true });

      // Get analyzed images (have appraiser primary_label)
      const { count: analyzed } = await supabase
        .from('vehicle_images')
        .select('*', { count: 'exact', head: true })
        .not('ai_scan_metadata->appraiser->primary_label', 'is', null);

      // Get pending images
      const { count: pending } = await supabase
        .from('vehicle_images')
        .select('*', { count: 'exact', head: true })
        .is('ai_scan_metadata->appraiser->primary_label', null);

      if (total === null || analyzed === null || pending === null) return;

      const percent = Math.round((analyzed / total) * 100);
      const processed = analyzed - lastCountRef.current;
      const elapsed = (Date.now() - startTime) / 1000 / 60; // minutes
      const rate = elapsed > 0 ? analyzed / elapsed : 0; // images per minute
      const eta = rate > 0 ? pending / rate : 0; // minutes remaining

      setStats({
        total,
        analyzed,
        pending,
        percent,
        rate,
        elapsed,
        eta,
        lastUpdate: processed
      });

      lastCountRef.current = analyzed;
      setLoading(false);
    } catch (error) {
      console.error('Error loading analysis stats:', error);
      setLoading(false);
    }
  }

  if (loading || !stats) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '8pt' }}>
        Loading analysis progress...
      </div>
    );
  }

  // Progress bar
  const barWidth = 50;
  const filled = Math.round((stats.percent / 100) * barWidth);
  const empty = barWidth - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '12pt', fontWeight: 700, marginBottom: '4px' }}>
            LIVE IMAGE ANALYSIS PROGRESS
          </h1>
          <p style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
            Real-time monitoring of AI image analysis pipeline
          </p>
        </div>
        <button
          onClick={() => setAutoRefresh(!autoRefresh)}
          style={{
            padding: '8px 16px',
            fontSize: '8pt',
            border: `2px solid ${autoRefresh ? 'var(--success)' : 'var(--border-light)'}`,
            background: autoRefresh ? 'var(--success-light)' : 'var(--surface)',
            color: autoRefresh ? 'var(--success)' : 'var(--text-muted)',
            cursor: 'pointer',
            fontWeight: 600,
            transition: 'all 0.12s ease'
          }}
        >
          {autoRefresh ? 'AUTO-REFRESH ON' : 'AUTO-REFRESH PAUSED'}
        </button>
      </div>

      {/* Main Progress Card */}
      <div style={{ 
        border: '2px solid #000', 
        background: 'var(--surface)',
        marginBottom: '24px'
      }}>
        <div style={{
          background: '#000',
          color: '#fff',
          padding: '12px 16px',
          fontSize: '8pt',
          fontWeight: 700,
          letterSpacing: '0.5px'
        }}>
          ANALYSIS PROGRESS
        </div>
        <div style={{ padding: '24px' }}>
          {/* Progress Bar */}
          <div style={{ marginBottom: '24px' }}>
            <div style={{ 
              fontFamily: 'monospace', 
              fontSize: '10pt', 
              marginBottom: '8px',
              letterSpacing: '1px'
            }}>
              [{bar}] {stats.percent}%
            </div>
          </div>

          {/* Stats Grid */}
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(2, 1fr)', 
            gap: '20px',
            marginBottom: '20px'
          }}>
            <div style={{ border: '2px solid #000', padding: '16px', background: '#f8f8f8' }}>
              <div style={{ fontSize: '8pt', color: '#666', marginBottom: '8px', fontWeight: 600 }}>
                ANALYZED
              </div>
              <div style={{ fontSize: '20pt', fontWeight: 700, marginBottom: '4px' }}>
                {stats.analyzed.toLocaleString()}
              </div>
              <div style={{ fontSize: '8pt', color: '#666' }}>
                of {stats.total.toLocaleString()} total
              </div>
            </div>

            <div style={{ border: '2px solid #000', padding: '16px', background: '#fff3cd' }}>
              <div style={{ fontSize: '8pt', color: '#666', marginBottom: '8px', fontWeight: 600 }}>
                REMAINING
              </div>
              <div style={{ fontSize: '20pt', fontWeight: 700, marginBottom: '4px', color: '#856404' }}>
                {stats.pending.toLocaleString()}
              </div>
              <div style={{ fontSize: '8pt', color: '#666' }}>
                images pending analysis
              </div>
            </div>
          </div>

          {/* Performance Metrics */}
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(3, 1fr)', 
            gap: '16px',
            marginTop: '20px'
          }}>
            <div style={{ border: '2px solid #e5e5e5', padding: '12px', background: 'var(--surface)' }}>
              <div style={{ fontSize: '8pt', color: '#666', marginBottom: '4px', fontWeight: 600 }}>
                PROCESSING RATE
              </div>
              <div style={{ fontSize: '14pt', fontWeight: 700 }}>
                {stats.rate.toFixed(1)}
              </div>
              <div style={{ fontSize: '8pt', color: '#666' }}>
                images/minute
              </div>
            </div>

            <div style={{ border: '2px solid #e5e5e5', padding: '12px', background: 'var(--surface)' }}>
              <div style={{ fontSize: '8pt', color: '#666', marginBottom: '4px', fontWeight: 600 }}>
                ELAPSED TIME
              </div>
              <div style={{ fontSize: '14pt', fontWeight: 700 }}>
                {stats.elapsed.toFixed(1)}
              </div>
              <div style={{ fontSize: '8pt', color: '#666' }}>
                minutes
              </div>
            </div>

            <div style={{ border: '2px solid #e5e5e5', padding: '12px', background: 'var(--surface)' }}>
              <div style={{ fontSize: '8pt', color: '#666', marginBottom: '4px', fontWeight: 600 }}>
                ESTIMATED TIME REMAINING
              </div>
              <div style={{ fontSize: '14pt', fontWeight: 700, color: stats.eta < 60 ? '#10b981' : '#f59e0b' }}>
                {stats.eta < 60 ? `${stats.eta.toFixed(1)}m` : `${(stats.eta / 60).toFixed(1)}h`}
              </div>
              <div style={{ fontSize: '8pt', color: '#666' }}>
                {stats.eta > 0 ? 'at current rate' : 'calculating...'}
              </div>
            </div>
          </div>

          {/* Last Update */}
          {stats.lastUpdate > 0 && (
            <div style={{
              marginTop: '20px',
              padding: '12px',
              background: '#10b98110',
              border: '2px solid #10b981',
              fontSize: '8pt',
              fontWeight: 600,
              color: '#10b981'
            }}>
              ⚡ Last update: +{stats.lastUpdate} images processed
            </div>
          )}

          {/* Completion Status */}
          {stats.pending === 0 && (
            <div style={{
              marginTop: '20px',
              padding: '16px',
              background: '#10b981',
              color: '#fff',
              fontSize: '10pt',
              fontWeight: 700,
              textAlign: 'center',
              border: '2px solid #000'
            }}>
              ✅ ALL IMAGES COMPLETE!
            </div>
          )}
        </div>
      </div>

      {/* Info Footer */}
      <div style={{ 
        padding: '12px', 
        background: '#f8f8f8', 
        border: '2px solid #e5e5e5',
        fontSize: '8pt',
        color: '#666',
        textAlign: 'center'
      }}>
        Updates every 5 seconds • Press refresh to update manually
      </div>
    </div>
  );
}

