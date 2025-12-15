import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import VehicleCritiqueManager from '../components/management/VehicleCritiqueManager';
import '../design-system.css';

interface BusinessMetrics {
  totalVehicles: number;
  pendingCritiques: number;
  highPriorityCritiques: number;
  avgResolutionDays: number;
  businessImpactBreakdown: {
    financial_negative: number;
    time_high: number;
    space_utilized: number;
  };
}

export default function BusinessIntelligence() {
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState<BusinessMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'critiques' | 'analytics'>('overview');
  const [session, setSession] = useState<any>(null);

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (session) {
      loadMetrics();
    }
  }, [session]);

  const checkAuth = async () => {
    const { data: { session: currentSession } } = await supabase.auth.getSession();

    if (!currentSession) {
      navigate('/login');
      return;
    }

    // Check if user has business-level access
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, organization_id')
      .eq('id', currentSession.user.id)
      .single();

    const hasAccess = profile?.role === 'admin' ||
                     profile?.role === 'manager' ||
                     profile?.role === 'business_owner';

    if (!hasAccess) {
      navigate('/');
      return;
    }

    setSession(currentSession);
  };

  const loadMetrics = async () => {
    try {
      setLoading(true);

      // Load various business metrics in parallel
      const [vehiclesResult, critiquesResult, analyticsResult] = await Promise.all([
        // Total vehicles count
        supabase
          .from('vehicles')
          .select('id', { count: 'exact', head: true }),

        // Critique metrics
        supabase
          .from('vehicle_critiques')
          .select('status, priority, business_impact, created_at, resolved_at'),

        // Business impact analytics
        supabase
          .from('vehicle_critique_analytics')
          .select('business_impact, resolution_days')
          .not('business_impact', 'is', null)
      ]);

      const totalVehicles = vehiclesResult.count || 0;
      const critiques = critiquesResult.data || [];

      // Calculate critique metrics
      const pendingCritiques = critiques.filter(c => c.status === 'pending').length;
      const highPriorityCritiques = critiques.filter(c =>
        c.status === 'pending' && (c.priority === 'high' || c.priority === 'urgent')
      ).length;

      // Calculate average resolution time
      const resolvedCritiques = critiques.filter(c => c.resolved_at);
      const avgResolutionDays = resolvedCritiques.length > 0
        ? resolvedCritiques.reduce((sum, c) => {
            const created = new Date(c.created_at);
            const resolved = new Date(c.resolved_at);
            return sum + ((resolved.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
          }, 0) / resolvedCritiques.length
        : 0;

      // Business impact breakdown
      const businessImpactBreakdown = {
        financial_negative: 0,
        time_high: 0,
        space_utilized: 0
      };

      critiques.forEach(c => {
        if (c.business_impact) {
          if (c.business_impact.financialImpact === 'negative') {
            businessImpactBreakdown.financial_negative++;
          }
          if (c.business_impact.timeImpact === 'high') {
            businessImpactBreakdown.time_high++;
          }
          if (c.business_impact.spaceImpact && c.business_impact.spaceImpact !== 'none') {
            businessImpactBreakdown.space_utilized++;
          }
        }
      });

      setMetrics({
        totalVehicles,
        pendingCritiques,
        highPriorityCritiques,
        avgResolutionDays: Math.round(avgResolutionDays * 10) / 10,
        businessImpactBreakdown
      });

    } catch (error) {
      console.error('Error loading business metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading business intelligence...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px' }}>
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '16px', marginBottom: '8px' }}>Business Intelligence Dashboard</h1>
        <p style={{ fontSize: '10pt', color: '#666', margin: 0 }}>
          Vehicle critique analysis and business impact assessment
        </p>
      </div>

      {/* Tab Navigation */}
      <div style={{
        borderBottom: '2px solid var(--border)',
        marginBottom: '16px',
        display: 'flex',
        gap: '0'
      }}>
        {(['overview', 'critiques', 'analytics'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="button-win95"
            style={{
              padding: '6px 12px',
              fontSize: '9pt',
              borderBottom: activeTab === tab ? '2px solid #0066cc' : 'none',
              background: activeTab === tab ? '#e8f4f8' : 'var(--white)',
              borderRadius: '0'
            }}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && metrics && (
        <div style={{ display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))' }}>
          {/* Key Metrics Cards */}
          <div className="card">
            <div className="card-header">Total Vehicles</div>
            <div className="card-body" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#0066cc' }}>
                {metrics.totalVehicles.toLocaleString()}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">Pending Critiques</div>
            <div className="card-body" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#ffc107' }}>
                {metrics.pendingCritiques}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">High Priority Issues</div>
            <div className="card-body" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#dc3545' }}>
                {metrics.highPriorityCritiques}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">Avg Resolution Time</div>
            <div className="card-body" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#28a745' }}>
                {metrics.avgResolutionDays}
                <span style={{ fontSize: '12px', fontWeight: 'normal' }}> days</span>
              </div>
            </div>
          </div>

          {/* Business Impact Summary */}
          <div className="card" style={{ gridColumn: 'span 2' }}>
            <div className="card-header">Business Impact Summary</div>
            <div className="card-body">
              <div style={{ display: 'grid', gap: '8px', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                <div style={{ padding: '8px', background: '#fee', border: '1px solid #fcc' }}>
                  <strong>Financial Impact</strong>
                  <div style={{ fontSize: '18px', color: '#c00' }}>
                    {metrics.businessImpactBreakdown.financial_negative} vehicles
                  </div>
                  <div style={{ fontSize: '8pt', color: '#666' }}>with negative financial impact</div>
                </div>

                <div style={{ padding: '8px', background: '#fff3cd', border: '1px solid #ffeaa7' }}>
                  <strong>Time Impact</strong>
                  <div style={{ fontSize: '18px', color: '#856404' }}>
                    {metrics.businessImpactBreakdown.time_high} vehicles
                  </div>
                  <div style={{ fontSize: '8pt', color: '#666' }}>with high time consumption</div>
                </div>

                <div style={{ padding: '8px', background: '#e2e3e5', border: '1px solid #d6d8db' }}>
                  <strong>Space Utilization</strong>
                  <div style={{ fontSize: '18px', color: '#6c757d' }}>
                    {metrics.businessImpactBreakdown.space_utilized} vehicles
                  </div>
                  <div style={{ fontSize: '8pt', color: '#666' }}>utilizing warehouse/lot space</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'critiques' && (
        <VehicleCritiqueManager />
      )}

      {activeTab === 'analytics' && (
        <div className="card">
          <div className="card-header">Advanced Analytics</div>
          <div className="card-body" style={{ padding: '40px', textAlign: 'center', color: '#666' }}>
            <div style={{ fontSize: '14px', marginBottom: '8px' }}>Advanced Analytics</div>
            <div style={{ fontSize: '10pt' }}>
              Detailed trend analysis, predictive insights, and custom reporting coming soon.
            </div>
            <div style={{ fontSize: '8pt', marginTop: '8px', color: '#999' }}>
              This will include critique trend analysis, resolution time forecasting, and business impact projections.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}