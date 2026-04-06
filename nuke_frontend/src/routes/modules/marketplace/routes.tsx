// src/routes/modules/marketplace/routes.tsx
import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

const MarketSegments = React.lazy(() => import('../../../pages/MarketSegments'));
const MarketSegmentDetail = React.lazy(() => import('../../../pages/MarketSegmentDetail'));
const MarketDashboard = React.lazy(() => import('../../../pages/MarketDashboard'));
const MarketMap = React.lazy(() => import('../../../components/market/MarketMap'));
const AuctionTrendsDashboard = React.lazy(() => import('../../../components/admin/AuctionTrendsDashboard'));

const LazyFallback = () => (
  <div style={{ height: '100vh', background: 'var(--bg)' }} />
);

const MarketplaceModuleRoutes = () => {
  return (
    <Suspense fallback={<LazyFallback />}>
      <Routes>
        {/* Public: market data */}
        <Route path="/" element={<MarketDashboard />} />
        <Route path="/map" element={<MarketMap />} />
        <Route path="/exchange" element={<Navigate to="/market/segments" replace />} />
        <Route path="/segments" element={<MarketSegments />} />
        <Route path="/segments/:slug" element={<MarketSegmentDetail />} />
        <Route path="/trends" element={<AuctionTrendsDashboard />} />
      </Routes>
    </Suspense>
  );
};

export default MarketplaceModuleRoutes;
