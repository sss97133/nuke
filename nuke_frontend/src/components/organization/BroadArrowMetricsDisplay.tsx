/**
 * Broad Arrow Metrics Display Component
 * Shows volume, revenue, and performance metrics for Broad Arrow Auctions
 */

import React, { useMemo } from 'react';
import { calculateBroadArrowMetrics, formatBroadArrowMetrics } from '../../services/broadArrowMetricsService';

interface Vehicle {
  sale_price?: number | null;
  listing_status?: string | null;
  origin_metadata?: {
    contributor?: any;
    auction_name?: string;
    auction_location?: string;
    price_currency?: string;
  };
}

interface BroadArrowMetricsDisplayProps {
  vehicles: Vehicle[];
  showDetailed?: boolean;
}

export const BroadArrowMetricsDisplay: React.FC<BroadArrowMetricsDisplayProps> = ({
  vehicles,
  showDetailed = false,
}) => {
  const metrics = useMemo(() => calculateBroadArrowMetrics(vehicles), [vehicles]);
  const formatted = useMemo(() => formatBroadArrowMetrics(metrics), [metrics]);

  if (vehicles.length === 0) {
    return (
      <div className="card">
        <div className="card-body" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
          No vehicle data available for metrics calculation.
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header" style={{ fontSize: '11pt', fontWeight: 700 }}>
        Auction Performance Metrics
      </div>
      <div className="card-body">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
          {/* Volume Metrics */}
          <div style={{ padding: '12px', background: 'var(--grey-50)', borderRadius: '4px' }}>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>Total Vehicles</div>
            <div style={{ fontSize: '16pt', fontWeight: 700, color: 'var(--text)' }}>{formatted.volume.total}</div>
          </div>

          <div style={{ padding: '12px', background: '#dcfce7', borderRadius: '4px' }}>
            <div style={{ fontSize: '8pt', color: '#166534', marginBottom: '4px' }}>Vehicles Sold</div>
            <div style={{ fontSize: '16pt', fontWeight: 700, color: '#166534' }}>{formatted.volume.sold}</div>
          </div>

          <div style={{ padding: '12px', background: '#fee2e2', borderRadius: '4px' }}>
            <div style={{ fontSize: '8pt', color: '#991b1b', marginBottom: '4px' }}>Vehicles Unsold</div>
            <div style={{ fontSize: '16pt', fontWeight: 700, color: '#991b1b' }}>{formatted.volume.unsold}</div>
          </div>

          <div style={{ padding: '12px', background: 'var(--grey-50)', borderRadius: '4px' }}>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>Sell-Through Rate</div>
            <div style={{ fontSize: '16pt', fontWeight: 700, color: 'var(--text)' }}>{formatted.volume.sellThroughRate}</div>
          </div>

          {/* Revenue Metrics */}
          <div style={{ padding: '12px', background: '#dbeafe', borderRadius: '4px' }}>
            <div style={{ fontSize: '8pt', color: '#1e40af', marginBottom: '4px' }}>Total Revenue</div>
            <div style={{ fontSize: '16pt', fontWeight: 700, color: '#1e40af' }}>{formatted.revenue.total}</div>
            <div style={{ fontSize: '7pt', color: '#1e40af', marginTop: '2px' }}>(Buyer's Premium)</div>
          </div>

          <div style={{ padding: '12px', background: '#dbeafe', borderRadius: '4px' }}>
            <div style={{ fontSize: '8pt', color: '#1e40af', marginBottom: '4px' }}>Avg Premium/Sale</div>
            <div style={{ fontSize: '16pt', fontWeight: 700, color: '#1e40af' }}>{formatted.revenue.averagePerSale}</div>
          </div>

          {/* Sales Metrics */}
          {showDetailed && (
            <>
              <div style={{ padding: '12px', background: 'var(--grey-50)', borderRadius: '4px' }}>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>Total Hammer Price</div>
                <div style={{ fontSize: '16pt', fontWeight: 700, color: 'var(--text)' }}>{formatted.sales.totalHammerPrice}</div>
              </div>

              <div style={{ padding: '12px', background: 'var(--grey-50)', borderRadius: '4px' }}>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>Avg Sale Price</div>
                <div style={{ fontSize: '16pt', fontWeight: 700, color: 'var(--text)' }}>{formatted.sales.averageSalePrice}</div>
              </div>
            </>
          )}
        </div>

        {/* Additional Details */}
        {showDetailed && (
          <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
              <strong>Revenue Calculation:</strong> Buyer's premium is Broad Arrow's revenue. Motor cars: 12% on first $250k, 10% above. Non-motor car lots: 20%.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BroadArrowMetricsDisplay;

