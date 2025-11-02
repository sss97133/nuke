/**
 * Vehicle Market Metrics
 * Pump.fun-style trading metrics for vehicles
 * Treats each vehicle as a tradeable asset with share price and volatility
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { BuyCreditsButton } from '../credits/BuyCreditsButton';

interface VehicleMarketMetricsProps {
  vehicle: any;
  stats: any;
}

export const VehicleMarketMetrics: React.FC<VehicleMarketMetricsProps> = ({ vehicle, stats }) => {
  const [marketData, setMarketData] = useState<any>(null);

  useEffect(() => {
    calculateMarketMetrics();
  }, [vehicle, stats]);

  const calculateMarketMetrics = async () => {
    // Base value from vehicle record or estimate
    const baseValue = vehicle.current_value || vehicle.purchase_price || 25000;
    
    // Standardized share calculation (1000 shares per vehicle)
    const totalShares = 1000;
    const sharePrice = baseValue / totalShares;
    
    // Get recent events to calculate volatility and day change
    const { data: recentEvents } = await supabase
      .from('timeline_events')
      .select('event_date, cost_amount, value_impact_amount, created_at')
      .eq('vehicle_id', vehicle.id)
      .order('event_date', { ascending: false })
      .limit(30);
    
    // Calculate day change (last 24h)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentChange = recentEvents
      ?.filter(e => new Date(e.created_at) > oneDayAgo)
      .reduce((sum, e) => sum + (e.value_impact_amount || 0), 0) || 0;
    
    const dayChangePercent = baseValue > 0 ? (recentChange / baseValue) * 100 : 0;
    
    // Calculate volatility (std dev of value impacts over 90 days)
    const valueImpacts = recentEvents
      ?.filter(e => e.value_impact_amount)
      .map(e => e.value_impact_amount) || [];
    
    const volatility = calculateVolatility(valueImpacts);
    const volatilityLevel = 
      volatility > 0.3 ? 'High' :
      volatility > 0.15 ? 'Medium' :
      'Low';
    
    // Trading status based on recent activity
    const lastEventDate = recentEvents?.[0]?.event_date;
    const daysSinceLastEvent = lastEventDate 
      ? Math.floor((Date.now() - new Date(lastEventDate).getTime()) / (1000 * 60 * 60 * 24))
      : 999;
    
    const tradingStatus = daysSinceLastEvent < 7 ? 'Active' : 'Dormant';
    
    // Last event impact
    const lastImpact = recentEvents?.[0]?.value_impact_amount || 0;
    
    setMarketData({
      sharePrice,
      marketCap: baseValue,
      dayChange: recentChange,
      dayChangePercent,
      volatility,
      volatilityLevel,
      tradingStatus,
      lastImpact
    });
  };

  const calculateVolatility = (values: number[]): number => {
    if (values.length < 2) return 0;
    
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    return mean !== 0 ? Math.abs(stdDev / mean) : 0;
  };

  if (!marketData) return null;

  const { sharePrice, marketCap, dayChange, dayChangePercent, volatility, volatilityLevel, tradingStatus, lastImpact } = marketData;

  return (
    <div style={styles.container}>
      {/* Main Metric Card - Pump.fun style */}
      <div style={styles.mainCard}>
        <div style={styles.row}>
          <div style={styles.label}>Share Price</div>
          <div style={styles.mainValue}>
            ${sharePrice.toFixed(2)}
            <span style={{
              ...styles.change,
              color: dayChange >= 0 ? '#00ff00' : '#ff0000'
            }}>
              {dayChange >= 0 ? ' ↑ ' : ' ↓ '}
              {Math.abs(dayChangePercent).toFixed(1)}%
            </span>
          </div>
        </div>
        
        <div style={styles.divider} />
        
        <div style={styles.metricsGrid}>
          <div style={styles.metric}>
            <div style={styles.metricLabel}>Market Cap</div>
            <div style={styles.metricValue}>${marketCap.toLocaleString()}</div>
          </div>
          
          <div style={styles.metric}>
            <div style={styles.metricLabel}>Volatility</div>
            <div style={styles.metricValue}>
              {volatilityLevel}
              <div style={styles.volatilityDots}>
                {['○', '○', '○', '○', '○'].map((dot, idx) => (
                  <span 
                    key={idx}
                    style={{
                      color: idx < (volatilityLevel === 'High' ? 4 : volatilityLevel === 'Medium' ? 2 : 1) 
                        ? '#000080' 
                        : '#d0d0d0'
                    }}
                  >
                    {dot}
                  </span>
                ))}
              </div>
            </div>
          </div>
          
          <div style={styles.metric}>
            <div style={styles.metricLabel}>Trading</div>
            <div style={styles.metricValue}>
              <span style={{color: tradingStatus === 'Active' ? '#00ff00' : '#808080'}}>
                {tradingStatus}
              </span>
            </div>
          </div>
        </div>
        
        {lastImpact !== 0 && (
          <>
            <div style={styles.divider} />
            <div style={styles.row}>
              <div style={styles.label}>Last Event Impact</div>
              <div style={{
                ...styles.metricValue,
                color: lastImpact >= 0 ? '#008000' : '#ff0000',
                fontWeight: 'bold'
              }}>
                {lastImpact >= 0 ? '+' : ''}${Math.abs(lastImpact).toLocaleString()}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Trading hint */}
      <div style={styles.hint}>
        💡 Share = Vehicle Value ÷ 1,000 shares
      </div>

      {/* Payments: Buy Credits CTA */}
      <div style={styles.buySection}>
        <BuyCreditsButton presetAmounts={[3, 10, 25]} />
      </div>
    </div>
  );
};

const styles = {
  container: {
    marginBottom: '16px'
  },
  mainCard: {
    background: '#ffffff',
    border: '2px solid #000080',
    borderRadius: '8px',
    padding: '16px',
    marginTop: '16px'
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px'
  },
  label: {
    fontSize: '12px',
    color: '#000080',
    fontWeight: 'bold' as const,
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  mainValue: {
    fontSize: '24px',
    fontWeight: 'bold' as const,
    color: '#000000',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  change: {
    fontSize: '14px',
    marginLeft: '8px'
  },
  divider: {
    height: '1px',
    background: '#808080',
    margin: '12px 0'
  },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '12px'
  },
  metric: {
    textAlign: 'center' as const
  },
  metricLabel: {
    fontSize: '10px',
    color: '#808080',
    marginBottom: '4px',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  metricValue: {
    fontSize: '13px',
    fontWeight: 'bold' as const,
    color: '#000000',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  volatilityDots: {
    fontSize: '8px',
    marginTop: '2px',
    letterSpacing: '2px'
  },
  hint: {
    fontSize: '10px',
    color: '#808080',
    textAlign: 'center' as const,
    marginTop: '8px',
    fontStyle: 'italic' as const
  },
  buySection: {
    marginTop: '12px',
    display: 'flex',
    justifyContent: 'center' as const
  }
};

