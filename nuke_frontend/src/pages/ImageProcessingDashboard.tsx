import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import '../design-system.css';

interface ProcessingStats {
  // Progress
  total: number;
  tier1Complete: number;
  tier2Complete: number;
  tier3Complete: number;
  failed: number;
  
  // Performance
  imagesPerMinute: number;
  eta: string;
  startTime: Date;
  
  // Costs
  totalCost: number;
  projectedCost: number;
  avgCostPerImage: number;
  modelUsage: Record<string, { count: number; cost: number; avgConfidence: number }>;
  
  // Quality
  avgConfidence: number;
  validationRate: number;
  consensusRate: number;
  
  // Context
  contextScores: {
    rich: number;
    good: number;
    medium: number;
    poor: number;
  };
  
  // Tables populated
  tablesPopulated: Record<string, number>;
  
  // Recent activity
  recentActivity: Array<{
    imageId: string;
    vehicleId: string;
    tier: number;
    model: string;
    confidence: number;
    cost: number;
    contextScore: number;
    timestamp: string;
  }>;
  
  // Alerts
  alerts: Array<{
    severity: 'info' | 'warning' | 'error';
    message: string;
    action?: string;
  }>;
}

export default function ImageProcessingDashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<ProcessingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    loadStats();
    
    if (autoRefresh) {
      const interval = setInterval(loadStats, 5000); // Refresh every 5 seconds
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  async function loadStats() {
    try {
      // Get image processing stats
      const { data: images } = await supabase
        .from('vehicle_images')
        .select('id, vehicle_id, ai_scan_metadata, context_score, processing_models_used, total_processing_cost');

      // Get recent question answers
      const { data: recentAnswers } = await supabase
        .from('image_question_answers')
        .select('*')
        .order('answered_at', { ascending: false })
        .limit(10);

      if (!images) return;

      // Calculate stats
      const total = images.length;
      let tier1Complete = 0;
      let tier2Complete = 0;
      let tier3Complete = 0;
      let totalCost = 0;
      const modelUsage: Record<string, { count: number; cost: number }> = {};
      const contextScores = { rich: 0, good: 0, medium: 0, poor: 0 };

      images.forEach(img => {
        const metadata = img.ai_scan_metadata;
        
        if (metadata?.tier_1_analysis) tier1Complete++;
        if (metadata?.tier_2_analysis) tier2Complete++;
        if (metadata?.tier_3_analysis) tier3Complete++;
        
        totalCost += img.total_processing_cost || 0;
        
        // Track model usage
        img.processing_models_used?.forEach((model: string) => {
          if (!modelUsage[model]) {
            modelUsage[model] = { count: 0, cost: 0 };
          }
          modelUsage[model].count++;
        });
        
        // Context score distribution
        const score = img.context_score || 0;
        if (score >= 60) contextScores.rich++;
        else if (score >= 30) contextScores.good++;
        else if (score >= 10) contextScores.medium++;
        else contextScores.poor++;
      });

      const recentActivity = (recentAnswers || []).slice(0, 10).map(answer => ({
        imageId: answer.image_id,
        vehicleId: answer.vehicle_id,
        model: answer.model_used,
        confidence: answer.confidence,
        timestamp: answer.answered_at
      }));

      setStats({
        total,
        tier1Complete,
        tier2Complete,
        tier3Complete,
        totalCost,
        modelUsage,
        contextScores,
        recentActivity
      } as any);
      
      setLoading(false);
    } catch (error) {
      console.error('Error loading stats:', error);
      setLoading(false);
    }
  }

  if (loading || !stats) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading processing stats...
      </div>
    );
  }

  const tier1Percent = (stats.tier1Complete / stats.total) * 100;
  const tier2Percent = (stats.tier2Complete / stats.total) * 100;
  const tier3Percent = (stats.tier3Complete / stats.total) * 100;

  const estimatedTotal = stats.total * 0.02; // If all were GPT-4o
  const savings = estimatedTotal - stats.totalCost;
  const savingsPercent = (savings / estimatedTotal) * 100;

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
            Image Processing Dashboard
          </h1>
          <p style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
            Real-time AI analysis monitoring
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

      {/* Main Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
        
        {/* Total Images */}
        <div className="card" style={{ padding: '16px' }}>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
            TOTAL IMAGES
          </div>
          <div style={{ fontSize: '14pt', fontWeight: 700 }}>
            {stats.total.toLocaleString()}
          </div>
        </div>

        {/* Tier 1 Progress */}
        <div className="card" style={{ padding: '16px', border: '2px solid var(--accent)' }}>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
            ORGANIZATION (TIER 1)
          </div>
          <div style={{ fontSize: '14pt', fontWeight: 700, marginBottom: '8px' }}>
            {stats.tier1Complete.toLocaleString()}
          </div>
          <div style={{ height: '4px', background: 'var(--bg-secondary)', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{ width: `${tier1Percent}%`, height: '100%', background: 'var(--accent)' }} />
          </div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px' }}>
            {tier1Percent.toFixed(1)}% complete
          </div>
        </div>

        {/* Tier 2 Progress */}
        <div className="card" style={{ padding: '16px', border: '2px solid var(--success)' }}>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
            PARTS ID (TIER 2)
          </div>
          <div style={{ fontSize: '14pt', fontWeight: 700, marginBottom: '8px' }}>
            {stats.tier2Complete.toLocaleString()}
          </div>
          <div style={{ height: '4px', background: 'var(--bg-secondary)', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{ width: `${tier2Percent}%`, height: '100%', background: 'var(--success)' }} />
          </div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px' }}>
            {tier2Percent.toFixed(1)}% complete
          </div>
        </div>

        {/* Tier 3 Progress */}
        <div className="card" style={{ padding: '16px', border: '2px solid #8b5cf6' }}>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
            EXPERT ANALYSIS (TIER 3)
          </div>
          <div style={{ fontSize: '14pt', fontWeight: 700, marginBottom: '8px' }}>
            {stats.tier3Complete.toLocaleString()}
          </div>
          <div style={{ height: '4px', background: 'var(--bg-secondary)', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{ width: `${tier3Percent}%`, height: '100%', background: '#8b5cf6' }} />
          </div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px' }}>
            {tier3Percent.toFixed(1)}% complete
          </div>
        </div>
      </div>

      {/* Cost & Savings */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>
        <div className="card" style={{ padding: '16px' }}>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
            TOTAL COST
          </div>
          <div style={{ fontSize: '14pt', fontWeight: 700, color: 'var(--warning)' }}>
            ${stats.totalCost.toFixed(4)}
          </div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px' }}>
            ${(stats.totalCost / (stats.tier1Complete || 1)).toFixed(6)} per image
          </div>
        </div>

        <div className="card" style={{ padding: '16px' }}>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
            FULL PRICE (BASELINE)
          </div>
          <div style={{ fontSize: '14pt', fontWeight: 700 }}>
            ${estimatedTotal.toFixed(2)}
          </div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px' }}>
            If using GPT-4o for all
          </div>
        </div>

        <div className="card" style={{ padding: '16px', border: '2px solid var(--success)' }}>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
            SAVINGS
          </div>
          <div style={{ fontSize: '14pt', fontWeight: 700, color: 'var(--success)' }}>
            ${savings.toFixed(2)}
          </div>
          <div style={{ fontSize: '8pt', color: 'var(--success)', marginTop: '4px' }}>
            {savingsPercent.toFixed(1)}% cheaper
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }}>
        {/* Recent Activity Feed */}
        <div className="card">
          <div className="card-header" style={{ fontSize: '8pt', fontWeight: 700 }}>
            RECENT ACTIVITY
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {stats.recentActivity.map((activity, idx) => {
              const timeAgo = Math.floor((Date.now() - new Date(activity.timestamp).getTime()) / 1000);
              return (
                <div 
                  key={idx}
                  style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--border-light)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ fontSize: '8pt', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                      {activity.imageId.substring(0, 8)}
                    </div>
                    <div style={{ fontSize: '8pt', fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase' }}>
                      {activity.model}
                    </div>
                    <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                      {activity.confidence}% confidence
                    </div>
                  </div>
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                    {timeAgo < 60 ? `${timeAgo}s ago` : `${Math.floor(timeAgo / 60)}m ago`}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Context Quality */}
        <div className="card">
          <div className="card-header" style={{ fontSize: '8pt', fontWeight: 700 }}>
            CONTEXT QUALITY
          </div>
          <div className="card-body">
            <p style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Higher context = cheaper processing
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {[
                { label: 'Rich (60+)', count: stats.contextScores.rich, color: 'var(--success)', cost: '$0.00008' },
                { label: 'Good (30-60)', count: stats.contextScores.good, color: 'var(--accent)', cost: '$0.0004' },
                { label: 'Medium (10-30)', count: stats.contextScores.medium, color: 'var(--warning)', cost: '$0.005' },
                { label: 'Poor (<10)', count: stats.contextScores.poor, color: 'var(--error)', cost: '$0.015' }
              ].map(score => (
                <div key={score.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8pt', marginBottom: '4px' }}>
                    <span style={{ color: score.color, fontWeight: 600 }}>{score.label}</span>
                    <span>{score.count}</span>
                  </div>
                  <div style={{ height: '4px', background: 'var(--bg-secondary)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ width: `${(score.count / stats.total) * 100}%`, height: '100%', background: score.color }} />
                  </div>
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '2px', textAlign: 'right' }}>
                    {score.cost}/img
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div style={{ marginTop: '24px', display: 'flex', gap: '12px' }}>
        <button
          onClick={loadStats}
          className="button button-primary cursor-button"
          style={{ padding: '10px 20px', fontSize: '8pt' }}
        >
          REFRESH DATA
        </button>
        
        <button
          onClick={() => navigate('/admin/scripts')}
          className="button button-secondary cursor-button"
          style={{ padding: '10px 20px', fontSize: '8pt' }}
        >
          SCRIPT CONTROL
        </button>
      </div>
    </div>
  );
}