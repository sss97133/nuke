import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import '../design-system.css';

interface ScriptStatus {
  name: string;
  description: string;
  purpose: string;
  status: 'running' | 'stopped' | 'error' | 'unknown';
  progress: {
    current: number;
    total: number;
    percent: number;
  };
  metrics: {
    successRate: number;
    cost: number;
    rate: number; // items per minute
    eta: string;
  };
  lastRun?: string;
  errors: string[];
}

const SCRIPTS = [
  {
    id: 'angle-setter',
    name: 'Angle Detection',
    description: 'Sets angle for all images',
    table: 'vehicle_images',
    field: 'angle',
    metric: 'COUNT(*) FILTER (WHERE angle IS NOT NULL)',
    cost: 0.00008
  },
  {
    id: 'tier1-processor',
    name: 'Tier 1 Organization',
    description: 'Basic categorization (angle, category, components)',
    table: 'vehicle_images',
    field: 'ai_scan_metadata',
    metric: "COUNT(*) FILTER (WHERE ai_scan_metadata->'tier_1_analysis' IS NOT NULL)",
    cost: 0.0001
  },
  {
    id: 'tier2-processor',
    name: 'Tier 2 Parts',
    description: 'Specific part identification',
    table: 'vehicle_images',
    field: 'ai_scan_metadata',
    metric: "COUNT(*) FILTER (WHERE ai_scan_metadata->'tier_2_analysis' IS NOT NULL)",
    cost: 0.0005
  },
  {
    id: 'tier3-processor',
    name: 'Tier 3 Expert',
    description: 'Expert analysis with full context',
    table: 'vehicle_images',
    field: 'ai_scan_metadata',
    metric: "COUNT(*) FILTER (WHERE ai_scan_metadata->'tier_3_analysis' IS NOT NULL)",
    cost: 0.02
  },
  {
    id: 'gap-finder',
    name: 'Gap Identification',
    description: 'Find missing documentation',
    table: 'missing_context_reports',
    field: null,
    metric: 'COUNT(*)',
    cost: 0.02
  },
  {
    id: 'completeness-calculator',
    name: 'Profile Completeness',
    description: 'Calculate vehicle profile scores',
    table: 'vehicle_processing_summary',
    field: 'profile_completeness_score',
    metric: 'COUNT(*)',
    cost: 0
  }
];

export default function ScriptControlCenter() {
  const navigate = useNavigate();
  const [scripts, setScripts] = useState<ScriptStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    loadScriptStatus();
    
    if (autoRefresh) {
      const interval = setInterval(loadScriptStatus, 5000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  async function loadScriptStatus() {
    try {
      const statusList: ScriptStatus[] = [];

      for (const script of SCRIPTS) {
        const status = await getScriptStatus(script);
        statusList.push(status);
      }

      setScripts(statusList);
      setLoading(false);
    } catch (error) {
      console.error('Error loading script status:', error);
      setLoading(false);
    }
  }

  async function getScriptStatus(script: any): Promise<ScriptStatus> {
    try {
      // Get total images
      const { count: total } = await supabase
        .from('vehicle_images')
        .select('*', { count: 'exact', head: true });

      // Get processed count using the metric
      let processed = 0;
      try {
        const { data, error } = await supabase.rpc('execute_sql', {
          query: `SELECT ${script.metric} as processed FROM ${script.table}`
        });
        
        if (error) {
          // Function or table doesn't exist, return 0
          if (error.code === 'PGRST301' || error.code === 'PGRST116' || error.code === '42P01' || error.code === '42883') {
            processed = 0;
          } else {
            console.warn(`Error executing SQL for ${script.name}:`, error);
            processed = 0;
          }
        } else {
          processed = data?.processed || (Array.isArray(data) && data[0]?.processed) || 0;
        }
      } catch (err) {
        console.warn(`Error in execute_sql for ${script.name}:`, err);
        processed = 0;
      }

      const percent = total && total > 0 ? (processed / total) * 100 : 0;

      // Check if actively processing (updated in last 2 minutes)
      const { data: recentActivity } = await supabase
        .from(script.table)
        .select('created_at')
        .gte('created_at', new Date(Date.now() - 120000).toISOString())
        .limit(1);

      const isRunning = recentActivity && recentActivity.length > 0;

      return {
        name: script.name,
        description: script.description,
        purpose: `Fills: ${script.table}.${script.field || 'rows'}`,
        status: isRunning ? 'running' : processed > 0 ? 'stopped' : 'unknown',
        progress: {
          current: processed,
          total: total || 2742,
          percent
        },
        metrics: {
          successRate: 100, // TODO: track failures
          cost: processed * script.cost,
          rate: 0, // TODO: calculate
          eta: '0m'
        },
        lastRun: recentActivity?.[0]?.created_at,
        errors: []
      };
    } catch (error: any) {
      return {
        name: script.name,
        description: script.description,
        purpose: `Error loading status`,
        status: 'error',
        progress: { current: 0, total: 0, percent: 0 },
        metrics: { successRate: 0, cost: 0, rate: 0, eta: 'N/A' },
        errors: [error.message]
      };
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading scripts...
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      
      {/* Header */}
      <div style={{ marginBottom: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <button
            onClick={() => navigate('/admin')}
            className="button button-secondary cursor-button"
            style={{ 
              marginBottom: '16px',
              fontSize: '8pt', 
              padding: '6px 12px',
              border: '2px solid var(--border-light)',
              transition: 'all 0.12s ease'
            }}
          >
            ← Back to Mission Control
          </button>
          <h1 style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Script Control Center
          </h1>
          <p style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
            Monitor and control all processing scripts
          </p>
        </div>
        <button
          onClick={() => setAutoRefresh(!autoRefresh)}
          className="button cursor-button"
          style={{
            padding: '8px 16px',
            fontSize: '8pt',
            border: `2px solid ${autoRefresh ? 'var(--success)' : 'var(--border-light)'}`,
            background: autoRefresh ? 'var(--success-light)' : 'var(--surface)',
            color: autoRefresh ? 'var(--success)' : 'var(--text-muted)',
            transition: 'all 0.12s ease'
          }}
        >
          {autoRefresh ? 'AUTO-REFRESH ON' : 'AUTO-REFRESH PAUSED'}
        </button>
      </div>

      {/* Scripts Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '16px', marginBottom: '32px' }}>
        {scripts.map((script) => {
          const statusColor = 
            script.status === 'running' ? 'var(--success)' :
            script.status === 'stopped' ? 'var(--border-medium)' :
            script.status === 'error' ? 'var(--error)' : 'var(--text-muted)';

          return (
            <div key={script.name} className="card" style={{ border: `2px solid ${statusColor}` }}>
              <div className="card-body">
                {/* Script Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                  <div>
                    <h3 style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '4px' }}>{script.name}</h3>
                    <p style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '2px' }}>{script.description}</p>
                    <p style={{ fontSize: '8pt', fontFamily: 'monospace', color: 'var(--text-muted)' }}>{script.purpose}</p>
                  </div>
                  <div style={{ 
                    fontSize: '8pt', 
                    fontWeight: 700, 
                    textTransform: 'uppercase', 
                    color: statusColor,
                    border: `1px solid ${statusColor}`,
                    padding: '2px 6px',
                    borderRadius: '4px'
                  }}>
                    {script.status}
                  </div>
                </div>

                {/* Progress Bar */}
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8pt', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>PROGRESS</span>
                    <span style={{ fontFamily: 'monospace' }}>
                      {script.progress.current.toLocaleString()} / {script.progress.total.toLocaleString()}
                    </span>
                  </div>
                  <div style={{ height: '6px', background: 'var(--bg-secondary)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div 
                      style={{ 
                        height: '100%', 
                        background: script.status === 'running' ? 'var(--success)' : 'var(--accent)',
                        width: `${script.progress.percent}%`,
                        transition: 'width 0.3s ease'
                      }}
                    />
                  </div>
                  <div style={{ fontSize: '8pt', textAlign: 'right', marginTop: '2px', color: 'var(--text-muted)' }}>
                    {script.progress.percent.toFixed(1)}%
                  </div>
                </div>

                {/* Metrics */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '16px' }}>
                  <div>
                    <div style={{ fontSize: '8pt', color: 'var(--text-muted)', fontWeight: 600 }}>COST</div>
                    <div style={{ fontSize: '10pt', fontWeight: 700, color: 'var(--warning)' }}>
                      ${script.metrics.cost.toFixed(4)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '8pt', color: 'var(--text-muted)', fontWeight: 600 }}>SUCCESS</div>
                    <div style={{ fontSize: '10pt', fontWeight: 700 }}>
                      {script.metrics.successRate.toFixed(0)}%
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '8pt', color: 'var(--text-muted)', fontWeight: 600 }}>ETA</div>
                    <div style={{ fontSize: '10pt', fontWeight: 700 }}>
                      {script.metrics.eta}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    className="button button-primary cursor-button"
                    style={{ flex: 1, fontSize: '8pt', padding: '8px' }}
                    onClick={() => alert('Start script: ' + script.name)}
                  >
                    Start
                  </button>
                  <button
                    className="button button-secondary cursor-button"
                    style={{ flex: 1, fontSize: '8pt', padding: '8px', color: 'var(--error)', borderColor: 'var(--error)' }}
                    onClick={() => alert('Stop script: ' + script.name)}
                  >
                    Stop
                  </button>
                  <button
                    className="button button-secondary cursor-button"
                    style={{ fontSize: '8pt', padding: '8px' }}
                    onClick={() => alert('View details: ' + script.name)}
                  >
                    Details
                  </button>
                </div>

                {/* Last Run */}
                {script.lastRun && (
                  <div style={{ marginTop: '12px', fontSize: '8pt', color: 'var(--text-muted)', textAlign: 'center' }}>
                    Last activity: {new Date(script.lastRun).toLocaleString()}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Global Actions */}
      <div style={{ marginBottom: '32px', display: 'flex', gap: '12px' }}>
        <button
          onClick={loadScriptStatus}
          className="button button-primary cursor-button"
          style={{ padding: '10px 20px', fontSize: '8pt' }}
        >
          REFRESH ALL
        </button>
        <button
          onClick={() => navigate('/admin/image-processing')}
          className="button button-secondary cursor-button"
          style={{ padding: '10px 20px', fontSize: '8pt' }}
        >
          LEGACY DASHBOARD
        </button>
      </div>

      {/* Summary Stats */}
      <div className="card" style={{ border: '2px solid var(--border-light)' }}>
        <div className="card-header" style={{ fontSize: '8pt', fontWeight: 700 }}>
          OVERALL PROGRESS
        </div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
            <div>
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)', fontWeight: 600 }}>TOTAL IMAGES</div>
              <div style={{ fontSize: '12pt', fontWeight: 700 }}>2,742</div>
            </div>
            <div>
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)', fontWeight: 600 }}>ANGLES SET</div>
              <div style={{ fontSize: '12pt', fontWeight: 700 }}>
                {scripts.find(s => s.name === 'Angle Detection')?.progress.current || 0}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)', fontWeight: 600 }}>TOTAL COST</div>
              <div style={{ fontSize: '12pt', fontWeight: 700, color: 'var(--warning)' }}>
                ${scripts.reduce((sum, s) => sum + s.metrics.cost, 0).toFixed(4)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)', fontWeight: 600 }}>ACTIVE SCRIPTS</div>
              <div style={{ fontSize: '12pt', fontWeight: 700, color: 'var(--success)' }}>
                {scripts.filter(s => s.status === 'running').length}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}