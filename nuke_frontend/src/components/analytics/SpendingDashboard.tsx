import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import '../../design-system.css';

interface SpendingAnalytics {
  id: string;
  total_spent: number;
  parts_spent: number;
  tools_spent: number;
  labor_spent: number;
  consumables_spent: number;
  receipt_count: number;
  average_receipt_amount: number;
  largest_purchase: number;
  period_start: string;
  period_end: string;
  category_breakdown: any;
  vendor_breakdown: any;
}

interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
}

const SpendingDashboard = () => {
  const { user } = useAuth();
  const [analytics, setAnalytics] = useState<SpendingAnalytics | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<string>('all');
  const [timeRange, setTimeRange] = useState<string>('month');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadUserVehicles();
  }, []);

  useEffect(() => {
    if (user) {
      generateAnalytics();
    }
  }, [selectedVehicle, timeRange, user]);

  const loadUserVehicles = async () => {
    if (!user) return;

    const { data, error } = await supabase
      .from('vehicles')
      .select('id, make, model, year')
      .eq('owner_id', user.id)
      .order('year', { ascending: false });

    if (error) {
      console.error('Error loading vehicles:', error);
    } else {
      setVehicles(data || []);
    }
  };

  const generateAnalytics = async () => {
    if (!user) return;

    setLoading(true);

    const dateRanges = {
      week: { days: 7 },
      month: { days: 30 },
      quarter: { days: 90 },
      year: { days: 365 }
    };

    const range = dateRanges[timeRange as keyof typeof dateRanges];
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - range.days);

    try {
      const { error: functionError } = await supabase.rpc('generate_spending_analytics', {
        target_user_id: user.id,
        target_vehicle_id: selectedVehicle === 'all' ? null : selectedVehicle,
        start_date: startDate.toISOString(),
        end_date: new Date().toISOString()
      });

      if (functionError) {
        console.error('Analytics generation error:', functionError);
      }

      let query = supabase
        .from('spending_analytics')
        .select('*')
        .eq('user_id', user.id)
        .gte('period_start', startDate.toISOString())
        .order('period_start', { ascending: false })
        .limit(1);

      if (selectedVehicle !== 'all') {
        query = query.eq('vehicle_id', selectedVehicle);
      } else {
        query = query.is('vehicle_id', null);
      }

      const { data, error } = await query.single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error loading analytics:', error);
      } else {
        setAnalytics(data);
      }

    } catch (error) {
      console.error('Analytics error:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount || 0);
  };

  const getSpendingBreakdown = () => {
    if (!analytics) return [];

    return [
      { label: 'Parts', amount: analytics.parts_spent, color: '#3b82f6' },
      { label: 'Tools', amount: analytics.tools_spent, color: '#10b981' },
      { label: 'Labor', amount: analytics.labor_spent, color: '#f59e0b' },
      { label: 'Consumables', amount: analytics.consumables_spent, color: '#8b5cf6' }
    ].filter(item => item.amount > 0);
  };

  const getCategoryBreakdown = () => {
    if (!analytics?.category_breakdown) return [];

    return Object.entries(analytics.category_breakdown as Record<string, number>)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
  };

  const getVendorBreakdown = () => {
    if (!analytics?.vendor_breakdown) return [];

    return Object.entries(analytics.vendor_breakdown as Record<string, number>)
      .map(([vendor, amount]) => ({ vendor, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
  };

  return (
    <div style={{
      background: 'var(--bg)',
      border: '1px solid #bdbdbd',
      padding: '16px',
      margin: '16px',
      fontFamily: 'Arial, sans-serif'
    }}>
      <h3 style={{ fontSize: '8pt', fontWeight: 'bold', margin: '0 0 12px 0' }}>
        📊 Spending Analytics
      </h3>

      {/* Filters */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid #bdbdbd',
        padding: '8px',
        marginBottom: '12px',
        display: 'flex',
        gap: '12px',
        alignItems: 'center',
        flexWrap: 'wrap'
      }}>
        <div>
          <label style={{ fontSize: '8pt', marginRight: '4px' }}>Vehicle:</label>
          <select
            value={selectedVehicle}
            onChange={(e) => setSelectedVehicle(e.target.value)}
            style={{
              padding: '2px',
              border: '1px solid #bdbdbd',
              borderRadius: '0px',
              fontSize: '8pt'
            }}
          >
            <option value="all">All Vehicles</option>
            {vehicles.map(vehicle => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.year} {vehicle.make} {vehicle.model}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ fontSize: '8pt', marginRight: '4px' }}>Time Range:</label>
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            style={{
              padding: '2px',
              border: '1px solid #bdbdbd',
              borderRadius: '0px',
              fontSize: '8pt'
            }}
          >
            <option value="week">Last 7 Days</option>
            <option value="month">Last 30 Days</option>
            <option value="quarter">Last 3 Months</option>
            <option value="year">Last Year</option>
          </select>
        </div>

        <button
          onClick={generateAnalytics}
          disabled={loading}
          style={{
            padding: '4px 8px',
            fontSize: '8pt',
            border: '1px solid #bdbdbd',
            background: loading ? '#e0e0e0' : '#424242',
            color: loading ? '#9e9e9e' : 'white',
            borderRadius: '0px',
            cursor: loading ? 'not-allowed' : 'pointer'
          }}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {loading && (
        <div style={{
          background: '#e7f3ff',
          border: '1px solid #b8daff',
          padding: '12px',
          textAlign: 'center',
          fontSize: '8pt',
          marginBottom: '12px'
        }}>
          Analyzing spending patterns...
        </div>
      )}

      {analytics ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
          {/* Total Spending */}
          <div style={{
            background: 'var(--surface)',
            border: '1px solid #bdbdbd',
            padding: '12px'
          }}>
            <h4 style={{ fontSize: '8pt', fontWeight: 'bold', margin: '0 0 8px 0' }}>
              💰 Total Spending
            </h4>
            <div style={{ fontSize: '12pt', fontWeight: 'bold', marginBottom: '4px' }}>
              {formatCurrency(analytics.total_spent)}
            </div>
            <div style={{ fontSize: '7pt', color: '#6b7280' }}>
              {analytics.receipt_count} receipts
            </div>
          </div>

          {/* Average Receipt */}
          <div style={{
            background: 'var(--surface)',
            border: '1px solid #bdbdbd',
            padding: '12px'
          }}>
            <h4 style={{ fontSize: '8pt', fontWeight: 'bold', margin: '0 0 8px 0' }}>
              📋 Average Receipt
            </h4>
            <div style={{ fontSize: '12pt', fontWeight: 'bold', marginBottom: '4px' }}>
              {formatCurrency(analytics.average_receipt_amount)}
            </div>
            <div style={{ fontSize: '7pt', color: '#6b7280' }}>
              Largest: {formatCurrency(analytics.largest_purchase)}
            </div>
          </div>

          {/* Spending Breakdown */}
          <div style={{
            background: 'var(--surface)',
            border: '1px solid #bdbdbd',
            padding: '12px',
            gridColumn: 'span 2'
          }}>
            <h4 style={{ fontSize: '8pt', fontWeight: 'bold', margin: '0 0 8px 0' }}>
              🔧 Spending Breakdown
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px' }}>
              {getSpendingBreakdown().map(item => (
                <div key={item.label}>
                  <div style={{ fontSize: '7pt', color: '#6b7280', marginBottom: '2px' }}>
                    {item.label}
                  </div>
                  <div style={{
                    background: item.color,
                    color: 'white',
                    padding: '4px',
                    fontSize: '8pt',
                    fontWeight: 'bold'
                  }}>
                    {formatCurrency(item.amount)}
                  </div>
                  <div style={{ fontSize: '7pt', color: '#6b7280', marginTop: '2px' }}>
                    {Math.round((item.amount / analytics.total_spent) * 100)}%
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Top Categories */}
          <div style={{
            background: 'var(--surface)',
            border: '1px solid #bdbdbd',
            padding: '12px'
          }}>
            <h4 style={{ fontSize: '8pt', fontWeight: 'bold', margin: '0 0 8px 0' }}>
              📦 Top Categories
            </h4>
            <div style={{ maxHeight: '150px', overflowY: 'auto' }}>
              {getCategoryBreakdown().map(item => (
                <div
                  key={item.category}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '2px 0',
                    borderBottom: '1px solid #f0f0f0',
                    fontSize: '8pt'
                  }}
                >
                  <div>{item.category.replace('_', ' ')}</div>
                  <div style={{ fontWeight: 'bold' }}>{formatCurrency(item.amount)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Top Vendors */}
          <div style={{
            background: 'var(--surface)',
            border: '1px solid #bdbdbd',
            padding: '12px'
          }}>
            <h4 style={{ fontSize: '8pt', fontWeight: 'bold', margin: '0 0 8px 0' }}>
              🏪 Top Vendors
            </h4>
            <div style={{ maxHeight: '150px', overflowY: 'auto' }}>
              {getVendorBreakdown().map(item => (
                <div
                  key={item.vendor}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '2px 0',
                    borderBottom: '1px solid #f0f0f0',
                    fontSize: '8pt'
                  }}
                >
                  <div>{item.vendor}</div>
                  <div style={{ fontWeight: 'bold' }}>{formatCurrency(item.amount)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : !loading && (
        <div style={{
          background: 'var(--surface)',
          border: '1px solid #bdbdbd',
          padding: '24px',
          textAlign: 'center',
          fontSize: '8pt',
          color: '#757575'
        }}>
          No spending data available for the selected time range
        </div>
      )}
    </div>
  );
};

export default SpendingDashboard;