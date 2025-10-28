import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { CashBalanceService } from '../services/cashBalanceService';
import '../design-system.css';

interface ActionItem {
  id: string;
  type: 'portfolio_alert' | 'documentation_gap' | 'deal_match' | 'work_reminder';
  title: string;
  description: string;
  action_text: string;
  action_url: string;
  priority: 'high' | 'medium' | 'low';
  icon: string;
}

interface PortfolioHolding {
  id: string;
  name: string;
  type: 'vehicle' | 'organization';
  current_value: number;
  invested: number;
  gain_loss: number;
  gain_loss_pct: number;
  change_24h: number;
}

export default function Dashboard() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [portfolioHoldings, setPortfolioHoldings] = useState<PortfolioHolding[]>([]);
  const [dealMatches, setDealMatches] = useState<any[]>([]);
  const [portfolioValue, setPortfolioValue] = useState(0);
  const [portfolioChange, setPortfolioChange] = useState(0);
  const [cashBalance, setCashBalance] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    loadDashboard();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
  }, []);

  const loadDashboard = async () => {
    try {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      // Load cash balance
      const balance = await CashBalanceService.getUserBalance(session.user.id);
      setCashBalance(balance?.available_cents || 0);

      // Load user's vehicles
      const { data: vehicles } = await supabase
        .from('vehicles')
        .select('*')
        .eq('uploaded_by', session.user.id)
        .order('created_at', { ascending: false });

      // Build action items
      const actions: ActionItem[] = [];

      // Check for portfolio alerts
      (vehicles || []).forEach(vehicle => {
        const value = vehicle.current_value || 0;
        const purchase = vehicle.purchase_price || 0;

        if (purchase > 0 && value > 0) {
          const gainPct = ((value - purchase) / purchase) * 100;

          if (gainPct > 20) {
            actions.push({
              id: `alert-${vehicle.id}`,
          type: 'portfolio_alert',
          title: `${vehicle.year} ${vehicle.make} ${vehicle.model} up ${gainPct.toFixed(0)}%`,
          description: `Consider selling? Market value increased significantly.`,
          action_text: 'View Vehicle',
          action_url: `/vehicle/${vehicle.id}`,
          priority: 'high',
          icon: '+'
            });
          }

          if (gainPct < -10) {
            actions.push({
            id: `alert-loss-${vehicle.id}`,
            type: 'portfolio_alert',
            title: `${vehicle.year} ${vehicle.make} ${vehicle.model} down ${Math.abs(gainPct).toFixed(0)}%`,
            description: `Value dropped below purchase price. Review market conditions.`,
            action_text: 'View Vehicle',
            action_url: `/vehicle/${vehicle.id}`,
            priority: 'medium',
            icon: '-'
            });
          }
        }

        // Check for documentation gaps
        const hasImages = (vehicle.image_count || 0) > 0;
        const hasValue = vehicle.current_value && vehicle.current_value > 0;
        const hasPurchase = vehicle.purchase_price && vehicle.purchase_price > 0;

        if (!hasImages) {
          actions.push({
            id: `doc-images-${vehicle.id}`,
            type: 'documentation_gap',
            title: `${vehicle.year} ${vehicle.make} ${vehicle.model} needs photos`,
            description: 'Upload images to increase value and interest',
            action_text: 'Add Photos',
            action_url: `/vehicle/${vehicle.id}`,
            priority: 'medium',
            icon: 'IMG'
          });
        }

        if (!hasPurchase) {
          actions.push({
            id: `doc-purchase-${vehicle.id}`,
            type: 'documentation_gap',
            title: `Add purchase price for ${vehicle.year} ${vehicle.make} ${vehicle.model}`,
            description: 'Track ROI by documenting what you paid',
            action_text: 'Add Price',
            action_url: `/vehicle/${vehicle.id}`,
            priority: 'low',
            icon: '$'
          });
        }

        if (!hasValue) {
          actions.push({
            id: `doc-value-${vehicle.id}`,
            type: 'documentation_gap',
            title: `Estimate value for ${vehicle.year} ${vehicle.make} ${vehicle.model}`,
            description: 'Add current market value to track performance',
            action_text: 'Add Value',
            action_url: `/vehicle/${vehicle.id}`,
            priority: 'low',
            icon: 'VAL'
          });
        }
      });

      // Load deal matches based on user preferences (simple: YMM from existing vehicles)
      if (vehicles && vehicles.length > 0) {
        const makes = [...new Set(vehicles.map(v => v.make).filter(Boolean))];
        
        if (makes.length > 0) {
          const { data: matches } = await supabase
            .from('vehicles')
            .select('*')
            .in('make', makes)
            .neq('uploaded_by', session.user.id)
            .eq('is_for_sale', true)
            .eq('is_public', true)
            .limit(3);

          setDealMatches(matches || []);

          (matches || []).slice(0, 2).forEach(match => {
            actions.push({
              id: `deal-${match.id}`,
              type: 'deal_match',
              title: `New ${match.year} ${match.make} ${match.model} for sale`,
              description: match.asking_price 
                ? `Listed at $${match.asking_price.toLocaleString()}`
                : 'Price available',
              action_text: 'View Listing',
              action_url: `/vehicle/${match.id}`,
              priority: 'medium',
              icon: 'NEW'
            });
          });
        }
      }

      // Calculate portfolio
      const holdings: PortfolioHolding[] = (vehicles || []).map(v => {
        const value = v.current_value || 0;
        const invested = v.purchase_price || 0;
        const gain = value - invested;
        const gainPct = invested > 0 ? (gain / invested) * 100 : 0;

        return {
          id: v.id,
          name: `${v.year} ${v.make} ${v.model}`,
          type: 'vehicle',
          current_value: value,
          invested,
          gain_loss: gain,
          gain_loss_pct: gainPct,
          change_24h: 0 // TODO: Track daily changes
        };
      });

      setPortfolioHoldings(holdings);
      
      const totalValue = holdings.reduce((sum, h) => sum + h.current_value, 0);
      const totalGain = holdings.reduce((sum, h) => sum + h.gain_loss, 0);
      setPortfolioValue(totalValue);
      setPortfolioChange(totalGain);

      // Sort actions by priority
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
      setActionItems(actions);

    } catch (error) {
      console.error('Error loading dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0
    }).format(value);
  };

  if (loading) {
    return (
      <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
        <div className="text">Loading your dashboard...</div>
      </div>
    );
  }

  if (!session?.user) {
    return (
      <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
        <div className="text">Please log in to view your dashboard</div>
      </div>
    );
  }

  return (
    <div style={{ background: '#f5f5f5', minHeight: '100vh', padding: 'var(--space-4)' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <h1 style={{ fontSize: '18pt', fontWeight: 'bold', marginBottom: 'var(--space-1)' }}>
            Dashboard
          </h1>
          <p style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>
            What needs your attention today
          </p>
        </div>

        {/* Portfolio Summary */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-4)'
        }}>
          <div style={{
            background: 'var(--white)',
            border: '2px solid var(--border)',
            padding: 'var(--space-3)'
          }}>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>
              Portfolio Value
            </div>
            <div style={{ fontSize: '18pt', fontWeight: 'bold' }}>
              {formatCurrency(portfolioValue)}
            </div>
            <div style={{
              fontSize: '9pt',
              color: portfolioChange >= 0 ? '#008000' : '#800000',
              marginTop: '4px'
            }}>
              {portfolioChange >= 0 ? '↑' : '↓'} {formatCurrency(Math.abs(portfolioChange))} total gain
            </div>
          </div>

          <div style={{
            background: 'var(--white)',
            border: '2px solid var(--border)',
            padding: 'var(--space-3)'
          }}>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>
              Buying Power
            </div>
            <div style={{ fontSize: '18pt', fontWeight: 'bold' }}>
              {formatCurrency(cashBalance / 100)}
            </div>
            <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '4px' }}>
              Available to invest
            </div>
          </div>

          <div style={{
            background: 'var(--white)',
            border: '2px solid var(--border)',
            padding: 'var(--space-3)'
          }}>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>
              Holdings
            </div>
            <div style={{ fontSize: '18pt', fontWeight: 'bold' }}>
              {portfolioHoldings.length}
            </div>
            <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '4px' }}>
              {portfolioHoldings.filter(h => h.gain_loss > 0).length} profitable
            </div>
          </div>

          <div style={{
            background: 'var(--white)',
            border: '2px solid var(--border)',
            padding: 'var(--space-3)'
          }}>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>
              Action Items
            </div>
            <div style={{ fontSize: '18pt', fontWeight: 'bold' }}>
              {actionItems.length}
            </div>
            <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '4px' }}>
              {actionItems.filter(a => a.priority === 'high').length} high priority
            </div>
          </div>
        </div>

        {/* Main Content Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-4)' }}>
          {/* Left Column: Action Items */}
        <div>
          <h2 style={{ fontSize: '12pt', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>
            What To Do Next
          </h2>

            {actionItems.length === 0 ? (
              <div style={{
                background: 'var(--white)',
                border: '2px solid var(--border)',
                padding: 'var(--space-8)',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: '32pt', marginBottom: '16px' }}>✅</div>
                <div style={{ fontSize: '10pt', fontWeight: 'bold', marginBottom: '8px' }}>
                  All caught up!
                </div>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>
                  No action items at this time
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {actionItems.map(item => (
                  <div
                    key={item.id}
                    onClick={() => navigate(item.action_url)}
                    style={{
                      background: 'var(--white)',
                      border: `2px solid ${item.priority === 'high' ? '#ff0000' : 'var(--border)'}`,
                      padding: 'var(--space-3)',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateX(4px)';
                      e.currentTarget.style.borderColor = 'var(--text)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateX(0)';
                      e.currentTarget.style.borderColor = item.priority === 'high' ? '#ff0000' : 'var(--border)';
                    }}
                  >
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                      <div style={{ fontSize: '20pt' }}>{item.icon}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '10pt', fontWeight: 'bold', marginBottom: '4px' }}>
                          {item.title}
                        </div>
                        <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '8px' }}>
                          {item.description}
                        </div>
                        <div style={{
                          display: 'inline-block',
                          background: 'var(--grey-100)',
                          border: '1px outset var(--border)',
                          padding: '4px 8px',
                          fontSize: '8pt',
                          fontWeight: 'bold'
                        }}>
                          {item.action_text} →
                        </div>
                      </div>
                      {item.priority === 'high' && (
                        <div style={{
                          background: '#ff0000',
                          color: '#ffffff',
                          padding: '2px 6px',
                          fontSize: '7pt',
                          fontWeight: 'bold',
                          border: '1px solid #ffffff'
                        }}>
                          URGENT
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right Column: Portfolio Performance */}
          <div>
            <h2 style={{ fontSize: '12pt', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>
              Your Holdings
            </h2>

            <div style={{
              background: 'var(--white)',
              border: '2px solid var(--border)',
              padding: 'var(--space-3)'
            }}>
              {portfolioHoldings.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 'var(--space-4)', color: 'var(--text-muted)' }}>
                  <div style={{ fontSize: '9pt' }}>No vehicles yet</div>
                  <button
                    onClick={() => navigate('/add-vehicle')}
                    style={{
                      marginTop: '12px',
                      background: 'var(--text)',
                      color: 'var(--white)',
                      border: '2px outset var(--border)',
                      padding: '8px 16px',
                      fontSize: '9pt',
                      cursor: 'pointer',
                      fontFamily: '"MS Sans Serif", sans-serif'
                    }}
                  >
                    Add Vehicle
                  </button>
                </div>
              ) : (
                <>
                  {portfolioHoldings.map(holding => (
                    <div
                      key={holding.id}
                      onClick={() => navigate(`/vehicle/${holding.id}`)}
                      style={{
                        padding: '12px',
                        borderBottom: '1px solid var(--border-light)',
                        cursor: 'pointer',
                        fontSize: '9pt'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--grey-100)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                        {holding.name}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8pt' }}>
                        <span style={{ color: 'var(--text-muted)' }}>
                          Invested: {formatCurrency(holding.invested)}
                        </span>
                        <span style={{
                          fontWeight: 'bold',
                          color: holding.gain_loss >= 0 ? '#008000' : '#800000'
                        }}>
                          {holding.gain_loss >= 0 ? '+' : ''}{formatCurrency(holding.gain_loss)} ({holding.gain_loss_pct.toFixed(1)}%)
                        </span>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>

            {/* Deal Matches */}
            {dealMatches.length > 0 && (
              <div style={{ marginTop: 'var(--space-3)' }}>
                <h2 style={{ fontSize: '12pt', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>
                  Deals For You
                </h2>
                <div style={{
                  background: 'var(--white)',
                  border: '2px solid var(--border)',
                  padding: 'var(--space-3)'
                }}>
                  {dealMatches.map(deal => (
                    <div
                      key={deal.id}
                      onClick={() => navigate(`/vehicle/${deal.id}`)}
                      style={{
                        padding: '12px',
                        borderBottom: '1px solid var(--border-light)',
                        cursor: 'pointer',
                        fontSize: '9pt'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--grey-100)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                        {deal.year} {deal.make} {deal.model}
                      </div>
                      <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                        {deal.asking_price ? formatCurrency(deal.asking_price) : 'Price TBD'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
