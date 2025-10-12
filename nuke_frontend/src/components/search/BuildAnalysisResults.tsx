import { useState } from 'react';
import '../../design-system.css';

interface BuildAnalysisResult {
  vehicle_id: string;
  year: number;
  make: string;
  model: string;
  last_activity?: string;
  days_since_activity?: number;
  total_events: number;
  stagnation_risk: number;
  build_health_score: number;
  detected_issues: string[];
  events_last_30_days?: number;
  activity_trend?: string;
  current_build_stage?: string;
  photos_uploaded?: number;
  receipts_uploaded?: number;
  money_spent_documented?: number;
}

interface BuildAnalysisResultsProps {
  results: BuildAnalysisResult[];
  query: string;
  analysis: string;
  loading?: boolean;
}

const BuildAnalysisResults = ({ results, query, analysis, loading = false }: BuildAnalysisResultsProps) => {
  const [sortBy, setSortBy] = useState<'health' | 'stagnation' | 'activity' | 'spending'>('stagnation');
  const [viewMode, setViewMode] = useState<'detailed' | 'summary'>('detailed');

  const getHealthColor = (score: number) => {
    if (score >= 80) return '#10b981'; // Green
    if (score >= 60) return '#f59e0b'; // Yellow
    if (score >= 40) return '#f97316'; // Orange
    return '#ef4444'; // Red
  };

  const getStagnationColor = (risk: number) => {
    if (risk >= 0.8) return '#ef4444'; // High risk - Red
    if (risk >= 0.6) return '#f97316'; // Medium-high risk - Orange
    if (risk >= 0.4) return '#f59e0b'; // Medium risk - Yellow
    return '#10b981'; // Low risk - Green
  };

  const getActivityStatusIcon = (result: BuildAnalysisResult) => {
    if (result.stagnation_risk > 0.7) return '💀';
    if (result.events_last_30_days === 0) return '😴';
    if (result.events_last_30_days > 10) return '🔥';
    if (result.events_last_30_days > 5) return '⚡';
    return '📝';
  };

  const formatDaysAgo = (dateString?: string) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return '1 day ago';
    if (diffDays < 30) return `${diffDays} days ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
  };

  const sortedResults = [...results].sort((a, b) => {
    switch (sortBy) {
      case 'health':
        return b.build_health_score - a.build_health_score;
      case 'stagnation':
        return b.stagnation_risk - a.stagnation_risk;
      case 'activity':
        return (b.events_last_30_days || 0) - (a.events_last_30_days || 0);
      case 'spending':
        return (b.money_spent_documented || 0) - (a.money_spent_documented || 0);
      default:
        return 0;
    }
  });

  const calculateSummaryStats = () => {
    const total = results.length;
    const highRisk = results.filter(r => r.stagnation_risk > 0.7).length;
    const abandoned = results.filter(r => r.stagnation_risk > 0.9).length;
    const active = results.filter(r => (r.events_last_30_days || 0) > 5).length;
    const wellDocumented = results.filter(r => (r.photos_uploaded || 0) > 10).length;
    const totalSpent = results.reduce((sum, r) => sum + (r.money_spent_documented || 0), 0);
    const avgHealth = results.reduce((sum, r) => sum + r.build_health_score, 0) / total;

    return { total, highRisk, abandoned, active, wellDocumented, totalSpent, avgHealth };
  };

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '60px',
        flexDirection: 'column',
        gap: '16px'
      }}>
        <div className="spinner" style={{ width: '40px', height: '40px' }}></div>
        <p className="text text-muted">Analyzing build patterns and user activity data...</p>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div style={{
        textAlign: 'center',
        padding: '60px',
        background: '#f8fafc',
        borderRadius: '12px',
        border: '2px dashed #d1d5db'
      }}>
        <span style={{ fontSize: '48px', display: 'block', marginBottom: '16px' }}>📊</span>
        <h3 className="heading-3">No Build Data Found</h3>
        <p className="text text-muted">
          No builds match the specified activity criteria. Try adjusting the timeframe or model filter.
        </p>
      </div>
    );
  }

  const stats = calculateSummaryStats();

  return (
    <div className="build-analysis-results">
      {/* Analysis Summary */}
      <div style={{
        background: '#f0f9ff',
        border: '1px solid #0ea5e9',
        borderRadius: '12px',
        padding: '16px',
        marginBottom: '20px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span style={{ fontSize: '20px' }}>📊</span>
          <h3 className="heading-3" style={{ margin: 0 }}>Build Intelligence Analysis</h3>
        </div>

        <p className="text" style={{ margin: '0 0 12px 0', color: '#0369a1' }}>
          <strong>Query:</strong> "{query}"
        </p>

        <p className="text" style={{ margin: '0 0 16px 0', color: '#374151' }}>
          {analysis}
        </p>

        {/* Quick Stats */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
          gap: '12px',
          marginTop: '16px'
        }}>
          <div style={{ textAlign: 'center', background: 'white', padding: '8px', borderRadius: '6px' }}>
            <div className="text text-bold" style={{ fontSize: '18px', color: '#0369a1' }}>{stats.total}</div>
            <div className="text text-muted" style={{ fontSize: '12px' }}>Total Builds</div>
          </div>

          <div style={{ textAlign: 'center', background: 'white', padding: '8px', borderRadius: '6px' }}>
            <div className="text text-bold" style={{ fontSize: '18px', color: '#ef4444' }}>{stats.highRisk}</div>
            <div className="text text-muted" style={{ fontSize: '12px' }}>High Risk</div>
          </div>

          <div style={{ textAlign: 'center', background: 'white', padding: '8px', borderRadius: '6px' }}>
            <div className="text text-bold" style={{ fontSize: '18px', color: '#10b981' }}>{stats.active}</div>
            <div className="text text-muted" style={{ fontSize: '12px' }}>Active</div>
          </div>

          <div style={{ textAlign: 'center', background: 'white', padding: '8px', borderRadius: '6px' }}>
            <div className="text text-bold" style={{ fontSize: '18px', color: '#3b82f6' }}>{Math.round(stats.avgHealth)}%</div>
            <div className="text text-muted" style={{ fontSize: '12px' }}>Avg Health</div>
          </div>

          {stats.totalSpent > 0 && (
            <div style={{ textAlign: 'center', background: 'white', padding: '8px', borderRadius: '6px' }}>
              <div className="text text-bold" style={{ fontSize: '18px', color: '#8b5cf6' }}>
                ${stats.totalSpent.toLocaleString()}
              </div>
              <div className="text text-muted" style={{ fontSize: '12px' }}>Documented Spend</div>
            </div>
          )}
        </div>
      </div>

      {/* Controls */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px',
        flexWrap: 'wrap',
        gap: '12px'
      }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span className="text text-bold" style={{ fontSize: '12px' }}>Sort by:</span>
          {(['stagnation', 'health', 'activity', 'spending'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setSortBy(mode)}
              className={`button ${sortBy === mode ? 'button-primary' : 'button-secondary'}`}
              style={{
                padding: '4px 8px',
                fontSize: '12px',
                textTransform: 'capitalize'
              }}
            >
              {mode}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span className="text text-bold" style={{ fontSize: '12px' }}>View:</span>
          {(['detailed', 'summary'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`button ${viewMode === mode ? 'button-primary' : 'button-secondary'}`}
              style={{
                padding: '4px 8px',
                fontSize: '12px',
                textTransform: 'capitalize'
              }}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      {viewMode === 'detailed' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {sortedResults.map((result) => (
            <div
              key={result.vehicle_id}
              style={{
                background: 'white',
                border: `2px solid ${getStagnationColor(result.stagnation_risk)}`,
                borderRadius: '12px',
                padding: '16px',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.transform = 'translateX(4px)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'translateX(0)'}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                <div>
                  <h4 className="heading-4" style={{ margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>{getActivityStatusIcon(result)}</span>
                    {result.year} {result.make} {result.model}
                  </h4>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{
                      background: getHealthColor(result.build_health_score),
                      color: 'white',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontSize: '12px',
                      fontWeight: 'bold'
                    }}>
                      {result.build_health_score}% Health
                    </span>
                    <span style={{
                      background: getStagnationColor(result.stagnation_risk),
                      color: 'white',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontSize: '12px',
                      fontWeight: 'bold'
                    }}>
                      {Math.round(result.stagnation_risk * 100)}% Risk
                    </span>
                    {result.current_build_stage && (
                      <span style={{
                        background: '#6b7280',
                        color: 'white',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '12px'
                      }}>
                        {result.current_build_stage}
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div className="text text-bold" style={{ fontSize: '14px' }}>
                    {result.events_last_30_days || 0} events (30d)
                  </div>
                  <div className="text text-muted" style={{ fontSize: '12px' }}>
                    Last: {formatDaysAgo(result.last_activity)}
                  </div>
                </div>
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                gap: '12px',
                marginBottom: '12px'
              }}>
                <div>
                  <div className="text text-bold" style={{ fontSize: '16px' }}>{result.total_events}</div>
                  <div className="text text-muted" style={{ fontSize: '11px' }}>Total Events</div>
                </div>

                <div>
                  <div className="text text-bold" style={{ fontSize: '16px' }}>{result.photos_uploaded || 0}</div>
                  <div className="text text-muted" style={{ fontSize: '11px' }}>Photos</div>
                </div>

                <div>
                  <div className="text text-bold" style={{ fontSize: '16px' }}>{result.receipts_uploaded || 0}</div>
                  <div className="text text-muted" style={{ fontSize: '11px' }}>Receipts</div>
                </div>

                {result.money_spent_documented > 0 && (
                  <div>
                    <div className="text text-bold" style={{ fontSize: '16px' }}>
                      ${result.money_spent_documented.toLocaleString()}
                    </div>
                    <div className="text text-muted" style={{ fontSize: '11px' }}>Documented</div>
                  </div>
                )}
              </div>

              {result.detected_issues.length > 0 && (
                <div style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '6px',
                  padding: '8px',
                  marginTop: '8px'
                }}>
                  <div className="text text-bold" style={{ fontSize: '12px', color: '#dc2626', marginBottom: '4px' }}>
                    Detected Issues:
                  </div>
                  <div style={{ fontSize: '11px', color: '#7f1d1d' }}>
                    {result.detected_issues.join(', ')}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div style={{
          background: 'white',
          border: '1px solid #e5e7eb',
          borderRadius: '12px',
          overflow: 'hidden'
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr',
            background: '#f8fafc',
            padding: '12px 16px',
            fontSize: '12px',
            fontWeight: 'bold',
            borderBottom: '1px solid #e5e7eb'
          }}>
            <div>Vehicle</div>
            <div>Health</div>
            <div>Risk</div>
            <div>Events</div>
            <div>Last Activity</div>
            <div>Status</div>
          </div>

          {sortedResults.map((result, index) => (
            <div
              key={result.vehicle_id}
              style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr',
                padding: '12px 16px',
                borderBottom: index < sortedResults.length - 1 ? '1px solid #f3f4f6' : 'none',
                fontSize: '14px',
                alignItems: 'center'
              }}
            >
              <div>
                <div className="text text-bold">
                  {result.year} {result.make} {result.model}
                </div>
                <div style={{ fontSize: '12px', color: '#6b7280' }}>
                  {result.current_build_stage || 'Unknown stage'}
                </div>
              </div>

              <div style={{ color: getHealthColor(result.build_health_score), fontWeight: 'bold' }}>
                {result.build_health_score}%
              </div>

              <div style={{ color: getStagnationColor(result.stagnation_risk), fontWeight: 'bold' }}>
                {Math.round(result.stagnation_risk * 100)}%
              </div>

              <div>{result.total_events} ({result.events_last_30_days || 0})</div>

              <div style={{ fontSize: '12px' }}>
                {formatDaysAgo(result.last_activity)}
              </div>

              <div style={{ fontSize: '18px' }}>
                {getActivityStatusIcon(result)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default BuildAnalysisResults;