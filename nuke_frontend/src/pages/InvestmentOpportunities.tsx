import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';

interface Opportunity {
  id: string;
  organization_id: string;
  business_stage: string;
  trajectory: string;
  investment_score: number;
  investment_range: string;
  investor_pitch: string;
  growth_signals: string[];
  confidence_score: number;
  image_count: number;
  time_period_start: string;
  time_period_end: string;
}

const InvestmentOpportunities: React.FC = () => {
  const navigate = useNavigate();
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'high' | 'medium'>('all');

  useEffect(() => {
    loadOpportunities();
  }, [filter]);

  const loadOpportunities = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('public_investment_opportunities')
        .select('*')
        .order('investment_score', { ascending: false });

      if (filter === 'high') {
        query = query.gte('investment_score', 0.80);
      } else if (filter === 'medium') {
        query = query.gte('investment_score', 0.70).lt('investment_score', 0.80);
      }

      const { data, error } = await query;
      if (error) throw error;
      setOpportunities(data || []);
    } catch (err) {
      console.error('Error loading opportunities:', err);
    } finally {
      setLoading(false);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 0.80) return '#10b981'; // green
    if (score >= 0.70) return '#f59e0b'; // orange
    return '#6b7280'; // gray
  };

  const getScoreLabel = (score: number) => {
    if (score >= 0.80) return 'HIGH POTENTIAL';
    if (score >= 0.70) return 'GOOD FIT';
    return 'MODERATE';
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ fontSize: '11pt', color: 'var(--text-muted)' }}>
          Loading investment opportunities...
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '24pt', fontWeight: 700, marginBottom: '8px' }}>
          Investment Opportunities
        </h1>
        <p style={{ fontSize: '10pt', color: 'var(--text-muted)' }}>
          AI-analyzed automotive businesses with growth potential. Each opportunity has been evaluated using facility documentation, operational evidence, and market positioning.
        </p>
      </div>

      {/* Filters */}
      <div style={{ 
        display: 'flex', 
        gap: '12px', 
        marginBottom: '24px',
        flexWrap: 'wrap'
      }}>
        {[
          { key: 'all', label: 'All Opportunities' },
          { key: 'high', label: 'High Potential (≥80%)' },
          { key: 'medium', label: 'Good Fit (70-80%)' }
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key as any)}
            style={{
              padding: '10px 20px',
              fontSize: '9pt',
              fontWeight: 600,
              border: filter === f.key ? '2px solid var(--accent)' : '1px solid var(--border)',
              background: filter === f.key ? 'var(--accent-dim)' : 'white',
              color: filter === f.key ? 'var(--accent)' : 'var(--text-muted)',
              borderRadius: '6px',
              cursor: 'pointer',
              transition: 'all 0.12s ease'
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Opportunities */}
      {opportunities.length === 0 ? (
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: '12pt', fontWeight: 600, marginBottom: '8px' }}>
              No opportunities found
            </div>
            <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>
              Check back soon as new businesses are analyzed
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {opportunities.map(opp => (
            <div 
              key={opp.id} 
              className="card"
              style={{ 
                cursor: 'pointer',
                transition: 'all 0.12s ease',
                border: '2px solid var(--border-light)'
              }}
              onClick={() => navigate(`/organization/${opp.organization_id}`)}
              onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
              onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border-light)'}
            >
              <div className="card-header" style={{ 
                background: 'var(--bg-secondary)',
                borderBottom: '2px solid var(--border-medium)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{
                    padding: '6px 12px',
                    background: getScoreColor(opp.investment_score),
                    color: 'white',
                    fontSize: '8pt',
                    fontWeight: 700,
                    borderRadius: '4px'
                  }}>
                    {Math.round(opp.investment_score * 100)}% MATCH
                  </div>
                  <div style={{ fontSize: '7pt', color: 'var(--text-muted)', fontWeight: 600 }}>
                    {getScoreLabel(opp.investment_score)}
                  </div>
                </div>
                <div style={{ fontSize: '9pt', fontWeight: 600, color: 'var(--accent)' }}>
                  {opp.investment_range}
                </div>
              </div>

              <div className="card-body" style={{ padding: '20px' }}>
                {/* Business Stage & Trajectory */}
                <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
                  <div style={{
                    padding: '4px 12px',
                    background: 'var(--accent-dim)',
                    color: 'var(--accent)',
                    fontSize: '8pt',
                    fontWeight: 700,
                    borderRadius: '20px',
                    textTransform: 'uppercase'
                  }}>
                    {opp.business_stage}
                  </div>
                  <div style={{
                    padding: '4px 12px',
                    background: opp.trajectory === 'upward' ? '#ecfdf5' : '#fef3c7',
                    color: opp.trajectory === 'upward' ? '#059669' : '#d97706',
                    fontSize: '8pt',
                    fontWeight: 700,
                    borderRadius: '20px'
                  }}>
                    {opp.trajectory === 'upward' ? '⬆️ UPWARD' : opp.trajectory.toUpperCase()}
                  </div>
                </div>

                {/* Investor Pitch */}
                <div style={{ fontSize: '10pt', lineHeight: '1.6', marginBottom: '16px' }}>
                  {opp.investor_pitch}
                </div>

                {/* Growth Signals */}
                {opp.growth_signals && opp.growth_signals.length > 0 && (
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ fontSize: '8pt', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '8px' }}>
                      GROWTH SIGNALS:
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {opp.growth_signals.slice(0, 6).map((signal, idx) => (
                        <div key={idx} style={{
                          padding: '4px 10px',
                          background: 'var(--success-dim)',
                          color: 'var(--success)',
                          fontSize: '7pt',
                          fontWeight: 600,
                          borderRadius: '4px',
                          border: '1px solid var(--success)'
                        }}>
                          ✓ {signal.replace(/_/g, ' ').toUpperCase()}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Metadata */}
                <div style={{
                  display: 'flex',
                  gap: '20px',
                  paddingTop: '16px',
                  borderTop: '1px solid var(--border-light)',
                  fontSize: '8pt',
                  color: 'var(--text-muted)'
                }}>
                  <div>
                    <strong>{opp.image_count}</strong> facility images analyzed
                  </div>
                  <div>
                    Confidence: <strong>{Math.round(opp.confidence_score * 100)}%</strong>
                  </div>
                  <div>
                    Analysis period: <strong>{new Date(opp.time_period_start).toLocaleDateString()}</strong> - <strong>{new Date(opp.time_period_end).toLocaleDateString()}</strong>
                  </div>
                </div>

                {/* CTA */}
                <div style={{ marginTop: '16px' }}>
                  <button
                    className="button button-primary"
                    style={{ fontSize: '9pt', padding: '10px 20px' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/organization/${opp.organization_id}`);
                    }}
                  >
                    View Full Profile →
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div style={{
        marginTop: '40px',
        padding: '24px',
        background: 'var(--bg-secondary)',
        borderRadius: '8px',
        textAlign: 'center'
      }}>
        <div style={{ fontSize: '10pt', fontWeight: 600, marginBottom: '8px' }}>
          Interested in these opportunities?
        </div>
        <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '16px' }}>
          Sign up as an investor to receive personalized match notifications
        </div>
        <button
          className="button button-primary"
          onClick={() => navigate('/signup')}
          style={{ fontSize: '9pt' }}
        >
          Create Investor Profile
        </button>
      </div>
    </div>
  );
};

export default InvestmentOpportunities;

