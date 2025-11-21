import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface FinancialStats {
  totalRevenue: number;
  totalCogs: number;
  totalExpenses: number;
  grossProfit: number;
  netIncome: number;
  grossMargin: number;
  netMargin: number;
}

interface RevenueBreakdown {
  laborRevenue: number;
  partsRevenue: number;
  feesRevenue: number;
  socialRevenue: number;
}

const ShopFinancials: React.FC = () => {
  const [stats, setStats] = useState<FinancialStats | null>(null);
  const [revenue, setRevenue] = useState<RevenueBreakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<'week' | 'month' | 'quarter' | 'year'>('month');
  const [showExportOptions, setShowExportOptions] = useState(false);

  useEffect(() => {
    loadFinancialData();
  }, [dateRange]);

  const getDateRange = () => {
    const end = new Date();
    const start = new Date();
    
    switch (dateRange) {
      case 'week':
        start.setDate(start.getDate() - 7);
        break;
      case 'month':
        start.setMonth(start.getMonth() - 1);
        break;
      case 'quarter':
        start.setMonth(start.getMonth() - 3);
        break;
      case 'year':
        start.setFullYear(start.getFullYear() - 1);
        break;
    }
    
    return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
  };

  const loadFinancialData = async () => {
    setLoading(true);
    try {
      const { start, end } = getDateRange();
      
      // Get aggregated financial data from events
      const { data: events, error } = await supabase
        .from('complete_event_summary')
        .select('*')
        .gte('event_date', start)
        .lte('event_date', end);

      if (error) throw error;

      // Calculate totals
      const totals = (events || []).reduce((acc, event) => ({
        totalRevenue: acc.totalRevenue + parseFloat(event.customer_price || 0),
        laborRevenue: acc.laborRevenue + parseFloat(event.labor_cost || 0),
        partsRevenue: acc.partsRevenue + (parseFloat(event.customer_price || 0) - parseFloat(event.labor_cost || 0)),
        totalCogs: acc.totalCogs + parseFloat(event.tci_total || 0),
        socialRevenue: acc.socialRevenue + parseFloat(event.total_social_value || 0)
      }), {
        totalRevenue: 0,
        laborRevenue: 0,
        partsRevenue: 0,
        totalCogs: 0,
        socialRevenue: 0
      });

      const grossProfit = totals.totalRevenue - totals.totalCogs;
      const netIncome = grossProfit + totals.socialRevenue;
      
      setStats({
        totalRevenue: totals.totalRevenue,
        totalCogs: totals.totalCogs,
        totalExpenses: 0, // Would need to add overhead expenses
        grossProfit: grossProfit,
        netIncome: netIncome,
        grossMargin: totals.totalRevenue > 0 ? (grossProfit / totals.totalRevenue * 100) : 0,
        netMargin: totals.totalRevenue > 0 ? (netIncome / totals.totalRevenue * 100) : 0
      });

      setRevenue({
        laborRevenue: totals.laborRevenue,
        partsRevenue: totals.partsRevenue,
        feesRevenue: 0,
        socialRevenue: totals.socialRevenue
      });
    } catch (error) {
      console.error('Error loading financial data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const exportToCSV = async () => {
    try {
      const { start, end } = getDateRange();
      const { data, error } = await supabase
        .rpc('export_journal_entries_csv', {
          p_start_date: start,
          p_end_date: end,
          p_business_id: null
        });

      if (error) throw error;

      // Convert to CSV and download
      if (data && data.length > 0) {
        const headers = Object.keys(data[0]).join(',');
        const rows = data.map((row: any) => Object.values(row).join(',')).join('\n');
        const csv = headers + '\n' + rows;
        
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `journal_entries_${start}_to_${end}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        alert('No journal entries found for this period');
      }
    } catch (error) {
      console.error('Error exporting to CSV:', error);
      alert('Export failed');
    }
  };

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh', padding: 'var(--space-4)' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ 
          marginBottom: 'var(--space-4)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <h1 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', margin: 0 }}>
            Shop Financials
          </h1>
          
          {/* Date Range */}
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            {(['week', 'month', 'quarter', 'year'] as const).map(range => (
              <button
                key={range}
                onClick={() => setDateRange(range)}
                style={{
                  padding: '4px var(--space-2)',
                  border: '2px solid var(--border)',
                  background: dateRange === range ? 'var(--text)' : 'var(--surface)',
                  color: dateRange === range ? 'var(--surface)' : 'var(--text)',
                  fontSize: '9px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  borderRadius: 'var(--radius)',
                  textTransform: 'uppercase'
                }}
              >
                {range}
              </button>
            ))}
            <button
              onClick={() => setShowExportOptions(!showExportOptions)}
              style={{
                padding: '4px var(--space-3)',
                border: '2px solid var(--text)',
                background: 'var(--text)',
                color: 'var(--surface)',
                fontSize: '9px',
                fontWeight: 700,
                cursor: 'pointer',
                borderRadius: 'var(--radius)',
                marginLeft: 'var(--space-2)'
              }}
            >
              EXPORT
            </button>
          </div>
        </div>

        {/* Export Options */}
        {showExportOptions && (
          <div style={{
            background: 'var(--surface)',
            border: '2px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: 'var(--space-3)',
            marginBottom: 'var(--space-4)',
            display: 'flex',
            gap: 'var(--space-2)'
          }}>
            <button onClick={exportToCSV} style={{
              flex: 1,
              padding: '6px var(--space-2)',
              border: '2px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontSize: '9px',
              fontWeight: 700,
              cursor: 'pointer',
              borderRadius: 'var(--radius)'
            }}>
              CSV (Universal)
            </button>
            <button onClick={() => alert('QuickBooks integration coming soon')} style={{
              flex: 1,
              padding: '6px var(--space-2)',
              border: '2px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontSize: '9px',
              fontWeight: 700,
              cursor: 'pointer',
              borderRadius: 'var(--radius)'
            }}>
              QuickBooks
            </button>
            <button onClick={() => alert('Xero integration coming soon')} style={{
              flex: 1,
              padding: '6px var(--space-2)',
              border: '2px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontSize: '9px',
              fontWeight: 700,
              cursor: 'pointer',
              borderRadius: 'var(--radius)'
            }}>
              Xero
            </button>
            <button onClick={() => alert('PennyLane integration coming soon')} style={{
              flex: 1,
              padding: '6px var(--space-2)',
              border: '2px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontSize: '9px',
              fontWeight: 700,
              cursor: 'pointer',
              borderRadius: 'var(--radius)'
            }}>
              PennyLane
            </button>
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--text-secondary)', fontSize: '10px' }}>
            Loading financial data...
          </div>
        ) : stats ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'var(--space-3)' }}>
            {/* Revenue Card */}
            <div style={{
              background: 'var(--surface)',
              border: '2px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: 'var(--space-3)'
            }}>
              <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 'var(--space-2)' }}>
                TOTAL REVENUE
              </div>
              <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                {formatCurrency(stats.totalRevenue)}
              </div>
              {revenue && (
                <div style={{ marginTop: 'var(--space-2)', fontSize: '9px', color: 'var(--text-secondary)' }}>
                  <div>Labor: {formatCurrency(revenue.laborRevenue)}</div>
                  <div>Parts: {formatCurrency(revenue.partsRevenue)}</div>
                  <div>Social: {formatCurrency(revenue.socialRevenue)}</div>
                </div>
              )}
            </div>

            {/* COGS Card */}
            <div style={{
              background: 'var(--surface)',
              border: '2px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: 'var(--space-3)'
            }}>
              <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 'var(--space-2)' }}>
                COST OF GOODS SOLD
              </div>
              <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--error)' }}>
                {formatCurrency(stats.totalCogs)}
              </div>
              <div style={{ marginTop: 'var(--space-2)', fontSize: '9px', color: 'var(--text-secondary)' }}>
                Direct costs (labor, parts, tools)
              </div>
            </div>

            {/* Gross Profit Card */}
            <div style={{
              background: stats.grossProfit >= 0 ? 'var(--success-dim)' : 'var(--error-dim)',
              border: `2px solid ${stats.grossProfit >= 0 ? 'var(--success)' : 'var(--error)'}`,
              borderRadius: 'var(--radius)',
              padding: 'var(--space-3)'
            }}>
              <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 'var(--space-2)' }}>
                GROSS PROFIT
              </div>
              <div style={{ 
                fontSize: '20px', 
                fontWeight: 700, 
                fontFamily: 'var(--font-mono)', 
                color: stats.grossProfit >= 0 ? 'var(--success)' : 'var(--error)'
              }}>
                {formatCurrency(stats.grossProfit)}
              </div>
              <div style={{ marginTop: 'var(--space-2)', fontSize: '9px', color: 'var(--text-secondary)' }}>
                {stats.grossMargin.toFixed(1)}% margin
              </div>
            </div>

            {/* Net Income Card */}
            <div style={{
              background: stats.netIncome >= 0 ? 'var(--success-dim)' : 'var(--error-dim)',
              border: `2px solid ${stats.netIncome >= 0 ? 'var(--success)' : 'var(--error)'}`,
              borderRadius: 'var(--radius)',
              padding: 'var(--space-3)'
            }}>
              <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 'var(--space-2)' }}>
                NET INCOME
              </div>
              <div style={{ 
                fontSize: '20px', 
                fontWeight: 700, 
                fontFamily: 'var(--font-mono)', 
                color: stats.netIncome >= 0 ? 'var(--success)' : 'var(--error)'
              }}>
                {formatCurrency(stats.netIncome)}
              </div>
              <div style={{ marginTop: 'var(--space-2)', fontSize: '9px', color: 'var(--text-secondary)' }}>
                {stats.netMargin.toFixed(1)}% margin (includes social)
              </div>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--text-secondary)', fontSize: '10px' }}>
            No financial data available
          </div>
        )}

        {/* Quick Actions */}
        <div style={{ 
          marginTop: 'var(--space-4)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: 'var(--space-3)'
        }}>
          <button
            onClick={() => window.location.href = '/invoices'}
            style={{
              padding: 'var(--space-3)',
              border: '2px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontSize: '10px',
              fontWeight: 700,
              cursor: 'pointer',
              borderRadius: 'var(--radius)',
              transition: 'var(--transition)',
              textAlign: 'left'
            }}
          >
            <div>MANAGE INVOICES</div>
            <div style={{ fontSize: '8px', fontWeight: 400, marginTop: '4px', color: 'var(--text-secondary)' }}>
              View, send, and track customer invoices
            </div>
          </button>

          <button
            onClick={() => window.location.href = '/suppliers'}
            style={{
              padding: 'var(--space-3)',
              border: '2px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontSize: '10px',
              fontWeight: 700,
              cursor: 'pointer',
              borderRadius: 'var(--radius)',
              transition: 'var(--transition)',
              textAlign: 'left'
            }}
          >
            <div>SUPPLIER PERFORMANCE</div>
            <div style={{ fontSize: '8px', fontWeight: 400, marginTop: '4px', color: 'var(--text-secondary)' }}>
              View ratings, delivery times, quality scores
            </div>
          </button>

          <button
            onClick={() => window.location.href = '/contracts'}
            style={{
              padding: 'var(--space-3)',
              border: '2px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontSize: '10px',
              fontWeight: 700,
              cursor: 'pointer',
              borderRadius: 'var(--radius)',
              transition: 'var(--transition)',
              textAlign: 'left'
            }}
          >
            <div>MANAGE CONTRACTS</div>
            <div style={{ fontSize: '8px', fontWeight: 400, marginTop: '4px', color: 'var(--text-secondary)' }}>
              Client agreements, rates, payment terms
            </div>
          </button>

          <button
            onClick={() => window.location.href = '/knowledge'}
            style={{
              padding: 'var(--space-3)',
              border: '2px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontSize: '10px',
              fontWeight: 700,
              cursor: 'pointer',
              borderRadius: 'var(--radius)',
              transition: 'var(--transition)',
              textAlign: 'left'
            }}
          >
            <div>KNOWLEDGE BASE</div>
            <div style={{ fontSize: '8px', fontWeight: 400, marginTop: '4px', color: 'var(--text-secondary)' }}>
              Procedures, specs, torque values, common issues
            </div>
          </button>
        </div>

        {/* Accounting Integration Info */}
        <div style={{
          marginTop: 'var(--space-6)',
          background: 'var(--surface)',
          border: '2px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: 'var(--space-4)'
        }}>
          <h2 style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text)', marginBottom: 'var(--space-2)' }}>
            Accounting Integration
          </h2>
          <p style={{ fontSize: '9px', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)', lineHeight: '1.4' }}>
            Your financial data is tracked using industry-standard double-entry bookkeeping. 
            Export to your existing accounting software or download as CSV.
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              onClick={exportToCSV}
              style={{
                padding: '6px var(--space-3)',
                border: '2px solid var(--text)',
                background: 'var(--text)',
                color: 'var(--surface)',
                fontSize: '9px',
                fontWeight: 700,
                cursor: 'pointer',
                borderRadius: 'var(--radius)'
              }}
            >
              DOWNLOAD CSV
            </button>
            <button
              onClick={() => alert('QuickBooks OAuth integration coming soon')}
              style={{
                padding: '6px var(--space-3)',
                border: '2px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                fontSize: '9px',
                fontWeight: 700,
                cursor: 'pointer',
                borderRadius: 'var(--radius)'
              }}
            >
              CONNECT QUICKBOOKS
            </button>
            <button
              onClick={() => alert('Xero OAuth integration coming soon')}
              style={{
                padding: '6px var(--space-3)',
                border: '2px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                fontSize: '9px',
                fontWeight: 700,
                cursor: 'pointer',
                borderRadius: 'var(--radius)'
              }}
            >
              CONNECT XERO
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShopFinancials;

