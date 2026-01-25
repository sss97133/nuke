/**
 * Market Depth Chart
 *
 * Visualizes cumulative bid/ask depth as an area chart.
 * Shows supply and demand at each price level.
 */

import { useMemo } from 'react';
import { useTradingWebSocket } from '../../hooks/useTradingWebSocket';
import '../../design-system.css';

interface MarketDepthProps {
  offeringId: string;
  height?: number;
  priceRange?: number;  // % range around mid price
}

const MarketDepth: React.FC<MarketDepthProps> = ({
  offeringId,
  height = 200,
  priceRange = 10,
}) => {
  const { orderBook, nbbo } = useTradingWebSocket(offeringId, {
    orderBookDepth: 50,  // Get more depth for the chart
  });

  // Build cumulative depth data
  const { bidCurve, askCurve, priceMin, priceMax, maxDepth } = useMemo(() => {
    // Calculate cumulative bids (highest price first)
    const bidCurve: Array<{ price: number; cumulative: number }> = [];
    let bidCumulative = 0;
    for (const level of orderBook.bids) {
      bidCumulative += level.shares;
      bidCurve.push({ price: level.price, cumulative: bidCumulative });
    }

    // Calculate cumulative asks (lowest price first)
    const askCurve: Array<{ price: number; cumulative: number }> = [];
    let askCumulative = 0;
    for (const level of orderBook.asks) {
      askCumulative += level.shares;
      askCurve.push({ price: level.price, cumulative: askCumulative });
    }

    // Determine price range
    const allPrices = [
      ...bidCurve.map(b => b.price),
      ...askCurve.map(a => a.price),
    ];
    const midPrice = nbbo.midPrice || (allPrices.length > 0
      ? (Math.min(...allPrices) + Math.max(...allPrices)) / 2
      : 100);

    const rangeAmount = midPrice * (priceRange / 100);
    const priceMin = midPrice - rangeAmount;
    const priceMax = midPrice + rangeAmount;

    const maxDepth = Math.max(
      bidCurve[bidCurve.length - 1]?.cumulative || 0,
      askCurve[askCurve.length - 1]?.cumulative || 0,
      1
    );

    return { bidCurve, askCurve, priceMin, priceMax, maxDepth };
  }, [orderBook, nbbo.midPrice, priceRange]);

  // Convert data point to SVG coordinates
  const toSVGCoords = (price: number, depth: number, chartWidth: number, chartHeight: number) => {
    const x = ((price - priceMin) / (priceMax - priceMin)) * chartWidth;
    const y = chartHeight - (depth / maxDepth) * chartHeight;
    return { x, y };
  };

  // Build SVG path for bid curve (area under curve)
  const buildBidPath = (chartWidth: number, chartHeight: number): string => {
    if (bidCurve.length === 0) return '';

    // Start at bottom left of the bid side
    let path = `M ${chartWidth / 2} ${chartHeight}`;

    // Add points from highest bid (near mid) to lowest bid
    bidCurve.forEach((point) => {
      const { x, y } = toSVGCoords(point.price, point.cumulative, chartWidth, chartHeight);
      path += ` L ${x} ${y}`;
    });

    // Close path back to bottom
    if (bidCurve.length > 0) {
      const lastBid = bidCurve[bidCurve.length - 1];
      const { x } = toSVGCoords(lastBid.price, 0, chartWidth, chartHeight);
      path += ` L ${x} ${chartHeight}`;
    }

    path += ' Z';
    return path;
  };

  // Build SVG path for ask curve (area under curve)
  const buildAskPath = (chartWidth: number, chartHeight: number): string => {
    if (askCurve.length === 0) return '';

    // Start at bottom at mid price
    let path = `M ${chartWidth / 2} ${chartHeight}`;

    // Add points from lowest ask (near mid) to highest ask
    askCurve.forEach((point) => {
      const { x, y } = toSVGCoords(point.price, point.cumulative, chartWidth, chartHeight);
      path += ` L ${x} ${y}`;
    });

    // Close path back to bottom
    if (askCurve.length > 0) {
      const lastAsk = askCurve[askCurve.length - 1];
      const { x } = toSVGCoords(lastAsk.price, 0, chartWidth, chartHeight);
      path += ` L ${x} ${chartHeight}`;
    }

    path += ' Z';
    return path;
  };

  const chartWidth = 400;
  const chartHeight = height - 60;  // Account for header and labels

  const hasData = bidCurve.length > 0 || askCurve.length > 0;

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '2px solid #bdbdbd',
        borderRadius: '4px',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 12px',
          borderBottom: '1px solid #e5e7eb',
          background: '#f9fafb',
        }}
      >
        <h3 style={{ margin: 0, fontSize: '10pt', fontWeight: 'bold' }}>Market Depth</h3>
        <div style={{ display: 'flex', gap: '12px', fontSize: '9pt' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{ width: 12, height: 12, background: 'rgba(16, 185, 129, 0.5)', borderRadius: 2 }} />
            <span style={{ color: '#10b981' }}>Bids</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{ width: 12, height: 12, background: 'rgba(220, 38, 38, 0.5)', borderRadius: 2 }} />
            <span style={{ color: '#dc2626' }}>Asks</span>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div style={{ padding: '12px' }}>
        {!hasData ? (
          <div
            style={{
              height: chartHeight,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#6b7280',
            }}
          >
            No depth data available
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            style={{ width: '100%', height: chartHeight }}
            preserveAspectRatio="xMidYMid meet"
          >
            {/* Grid lines */}
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#f0f0f0" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />

            {/* Mid price line */}
            <line
              x1={chartWidth / 2}
              y1={0}
              x2={chartWidth / 2}
              y2={chartHeight}
              stroke="#9ca3af"
              strokeWidth="1"
              strokeDasharray="4 4"
            />

            {/* Bid area (green) */}
            <path
              d={buildBidPath(chartWidth, chartHeight)}
              fill="rgba(16, 185, 129, 0.3)"
              stroke="#10b981"
              strokeWidth="2"
            />

            {/* Ask area (red) */}
            <path
              d={buildAskPath(chartWidth, chartHeight)}
              fill="rgba(220, 38, 38, 0.3)"
              stroke="#dc2626"
              strokeWidth="2"
            />

            {/* Mid price label */}
            {nbbo.midPrice && (
              <text
                x={chartWidth / 2}
                y={12}
                textAnchor="middle"
                fontSize="10"
                fill="#6b7280"
              >
                Mid: ${nbbo.midPrice.toFixed(2)}
              </text>
            )}
          </svg>
        )}

        {/* Price axis labels */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '9pt',
            color: '#6b7280',
            marginTop: '4px',
            fontFamily: 'var(--font-mono, monospace)',
          }}
        >
          <span>${priceMin.toFixed(2)}</span>
          {nbbo.midPrice && <span>${nbbo.midPrice.toFixed(2)}</span>}
          <span>${priceMax.toFixed(2)}</span>
        </div>
      </div>

      {/* Summary stats */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '12px',
          padding: '8px 12px',
          borderTop: '1px solid #e5e7eb',
          fontSize: '9pt',
        }}
      >
        <div>
          <div style={{ color: '#6b7280', marginBottom: '2px' }}>Total Bid Depth</div>
          <div style={{ fontWeight: 600, color: '#10b981', fontFamily: 'var(--font-mono, monospace)' }}>
            {bidCurve[bidCurve.length - 1]?.cumulative.toLocaleString() || 0} shares
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: '#6b7280', marginBottom: '2px' }}>Total Ask Depth</div>
          <div style={{ fontWeight: 600, color: '#dc2626', fontFamily: 'var(--font-mono, monospace)' }}>
            {askCurve[askCurve.length - 1]?.cumulative.toLocaleString() || 0} shares
          </div>
        </div>
      </div>
    </div>
  );
};

export default MarketDepth;
