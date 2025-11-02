/**
 * Investor Dashboard (for Laura and other investors)
 * Track investments, returns, ROI across all vehicles and organizations
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface InvestorStats {
  total_invested: number;
  total_returned: number;
  net_return: number;
  vehicles_funded: number;
  roi_percentage: number;
}

interface InvestmentTransaction {
  id: string;
  transaction_type: string;
  amount: number;
  percentage?: number;
  transaction_date: string;
  description?: string;
  vehicle: {
    id: string;
    year: number;
    make: string;
    model: string;
  } | null;
  organization: {
    id: string;
    business_name: string;
  } | null;
}

export default function InvestorDashboard() {
  const [stats, setStats] = useState<InvestorStats | null>(null);
  const [transactions, setTransactions] = useState<InvestmentTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'investments' | 'returns'>('all');

  useEffect(() => {
    loadInvestorData();
  }, []);

  const loadInvestorData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Load portfolio stats
      const { data: portfolio } = await supabase
        .from('investor_portfolio')
        .select('*')
        .eq('investor_user_id', user.id)
        .single();

      if (portfolio) {
        const roi = portfolio.total_invested > 0
          ? ((portfolio.net_return / portfolio.total_invested) * 100)
          : 0;

        setStats({
          total_invested: portfolio.total_invested,
          total_returned: portfolio.total_returned,
          net_return: portfolio.net_return,
          vehicles_funded: portfolio.vehicles_funded,
          roi_percentage: roi,
        });
      }

      // Load transaction history
      const { data: txns } = await supabase
        .from('investor_transactions')
        .select(`
          *,
          vehicle:vehicle_id (id, year, make, model),
          organization:organization_id (id, business_name)
        `)
        .eq('investor_user_id', user.id)
        .order('transaction_date', { ascending: false });

      setTransactions(txns || []);
    } catch (error: any) {
      console.error('Error loading investor data:', error);
      alert(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const filteredTransactions = transactions.filter(txn => {
    if (filter === 'investments') return txn.transaction_type === 'investment';
    if (filter === 'returns') return ['return', 'distribution'].includes(txn.transaction_type);
    return true;
  });

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  if (loading) {
    return (
      <div className="container" style={{ padding: '24px' }}>
        <div className="card">
          <div className="card-body">Loading investor dashboard...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ padding: '24px' }}>
      <h1 className="heading-1" style={{ marginBottom: '24px' }}>
        Investor Dashboard
      </h1>

      {/* Stats Grid */}
      {stats && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px',
          marginBottom: '32px'
        }}>
          <div className="card">
            <div className="card-body" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '8px' }}>
                Total Invested
              </div>
              <div style={{ fontSize: '16pt', fontWeight: 700, color: 'var(--color-danger)' }}>
                {formatCurrency(stats.total_invested)}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-body" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '8px' }}>
                Total Returned
              </div>
              <div style={{ fontSize: '16pt', fontWeight: 700, color: 'var(--color-success)' }}>
                {formatCurrency(stats.total_returned)}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-body" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '8px' }}>
                Net Return
              </div>
              <div style={{
                fontSize: '16pt',
                fontWeight: 700,
                color: stats.net_return >= 0 ? 'var(--color-success)' : 'var(--color-danger)'
              }}>
                {formatCurrency(stats.net_return)}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-body" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '8px' }}>
                ROI
              </div>
              <div style={{
                fontSize: '16pt',
                fontWeight: 700,
                color: stats.roi_percentage >= 0 ? 'var(--color-success)' : 'var(--color-danger)'
              }}>
                {stats.roi_percentage.toFixed(2)}%
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-body" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '8px' }}>
                Vehicles Funded
              </div>
              <div style={{ fontSize: '16pt', fontWeight: 700 }}>
                {stats.vehicles_funded}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Transaction History */}
      <div className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 className="heading-3">Transaction History</h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setFilter('all')}
              className={`button button-small ${filter === 'all' ? 'button-primary' : 'button-secondary'}`}
              style={{ fontSize: '8pt' }}
            >
              All
            </button>
            <button
              onClick={() => setFilter('investments')}
              className={`button button-small ${filter === 'investments' ? 'button-primary' : 'button-secondary'}`}
              style={{ fontSize: '8pt' }}
            >
              Investments
            </button>
            <button
              onClick={() => setFilter('returns')}
              className={`button button-small ${filter === 'returns' ? 'button-primary' : 'button-secondary'}`}
              style={{ fontSize: '8pt' }}
            >
              Returns
            </button>
          </div>
        </div>
        <div className="card-body">
          {filteredTransactions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)', fontSize: '9pt' }}>
              No transactions found
            </div>
          ) : (
            <div style={{ overflow: 'auto' }}>
              <table style={{ width: '100%', fontSize: '9pt' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)' }}>
                    <th style={{ padding: '8px', textAlign: 'left' }}>Date</th>
                    <th style={{ padding: '8px', textAlign: 'left' }}>Type</th>
                    <th style={{ padding: '8px', textAlign: 'left' }}>Vehicle/Org</th>
                    <th style={{ padding: '8px', textAlign: 'left' }}>Description</th>
                    <th style={{ padding: '8px', textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTransactions.map(txn => (
                    <tr key={txn.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px' }}>
                        {new Date(txn.transaction_date).toLocaleDateString()}
                      </td>
                      <td style={{ padding: '8px' }}>
                        <span
                          className="badge"
                          style={{
                            background: txn.transaction_type === 'investment'
                              ? 'var(--color-danger-light)'
                              : 'var(--color-success-light)',
                            color: txn.transaction_type === 'investment'
                              ? 'var(--color-danger)'
                              : 'var(--color-success)',
                          }}
                        >
                          {txn.transaction_type.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: '8px' }}>
                        {txn.vehicle ? (
                          <a href={`/vehicle/${txn.vehicle.id}`} style={{ color: 'var(--accent)' }}>
                            {txn.vehicle.year} {txn.vehicle.make} {txn.vehicle.model}
                          </a>
                        ) : txn.organization ? (
                          <a href={`/org/${txn.organization.id}`} style={{ color: 'var(--accent)' }}>
                            {txn.organization.business_name}
                          </a>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>General</span>
                        )}
                      </td>
                      <td style={{ padding: '8px', color: 'var(--text-muted)' }}>
                        {txn.description || '—'}
                        {txn.percentage && ` (${txn.percentage}%)`}
                      </td>
                      <td style={{
                        padding: '8px',
                        textAlign: 'right',
                        fontWeight: 600,
                        color: txn.transaction_type === 'investment'
                          ? 'var(--color-danger)'
                          : 'var(--color-success)'
                      }}>
                        {txn.transaction_type === 'investment' ? '-' : '+'}
                        {formatCurrency(Math.abs(txn.amount))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

