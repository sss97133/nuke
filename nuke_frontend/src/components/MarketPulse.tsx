import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface PulseMetric {
  label: string;
  value: number;
  unit?: string;
}

const MarketPulse: React.FC = () => {
  const [metrics, setMetrics] = useState<PulseMetric[]>([
    { label: 'Active Listings', value: 0 },
    { label: 'Avg Price', value: 0, unit: 'k' },
    { label: 'For Sale', value: 0 },
    { label: 'New Today', value: 0 }
  ]);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [isLive, setIsLive] = useState(true);

  useEffect(() => {
    loadMetrics();
    const interval = setInterval(() => {
      loadMetrics();
      setLastUpdate(new Date());
    }, 30000); // Update every 30 seconds

    return () => clearInterval(interval);
  }, []);

  const loadMetrics = async () => {
    try {
      // Get current metrics from real database
      const [vehicleCount, avgPrice, forSaleCount, todayAdds] = await Promise.all([
        supabase.from('vehicles').select('id', { count: 'exact' }).eq('is_public', true),
        supabase.from('vehicles').select('current_value').eq('is_public', true).not('current_value', 'is', null),
        supabase.from('vehicles').select('id', { count: 'exact' }).eq('is_for_sale', true).eq('is_public', true),
        supabase.from('vehicles').select('id', { count: 'exact' })
          .eq('is_public', true)
          .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) // Last 24 hours
      ]);

      const totalVehicles = vehicleCount.count || 0;
      const prices = avgPrice.data || [];
      const averagePrice = prices.length > 0 
        ? Math.round(prices.reduce((sum, v) => sum + (v.current_value || 0), 0) / prices.length / 1000)
        : 0;
      const forSale = forSaleCount.count || 0;
      const newToday = todayAdds.count || 0;
      
      setMetrics([
        { label: 'Active Listings', value: totalVehicles },
        { label: 'Avg Price', value: averagePrice, unit: 'k' },
        { label: 'For Sale', value: forSale },
        { label: 'New Today', value: newToday }
      ]);
    } catch (error) {
      console.error('Error loading pulse metrics:', error);
      setIsLive(false);
    }
  };


  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    });
  };

  return (
    <section className="section">
      <div className="card">
        <div className="card-header">
          <div className="flex justify-between items-center">
            <h3>Market Pulse</h3>
            <div className="flex items-center gap-2">
              <div className={`pulse-indicator ${isLive ? 'live' : 'offline'}`}></div>
              <span className="text-xs text-muted">
                {formatTime(lastUpdate)}
              </span>
            </div>
          </div>
        </div>
        <div className="card-body">
          <div className="pulse-grid">
            {metrics.map((metric, index) => (
              <div key={index} className="pulse-metric">
                <div className="metric-label">{metric.label}</div>
                <div className="metric-value">
                  {metric.value.toLocaleString()}{metric.unit || ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default MarketPulse;
