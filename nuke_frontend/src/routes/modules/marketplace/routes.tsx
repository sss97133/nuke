// src/routes/modules/marketplace/routes.tsx
import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from '../../../components/auth/ProtectedRoute';

const Portfolio = React.lazy(() => import('../../../pages/Portfolio'));
const CreditsSuccess = React.lazy(() => import('../../../pages/CreditsSuccess'));
const BuilderDashboard = React.lazy(() => import('../../../pages/BuilderDashboard'));
const MarketFundDetail = React.lazy(() => import('../../../pages/MarketFundDetail'));
const MarketSegments = React.lazy(() => import('../../../pages/MarketSegments'));
const MarketSegmentDetail = React.lazy(() => import('../../../pages/MarketSegmentDetail'));
const MarketDashboard = React.lazy(() => import('../../../pages/MarketDashboard'));
const ContractStation = React.lazy(() => import('../../../pages/ContractStation'));
const MarketMap = React.lazy(() => import('../../../components/market/MarketMap'));

const LazyFallback = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh', color: 'var(--text-disabled)', fontSize: '12px' }}>
    loading...
  </div>
);

const MarketplaceModuleRoutes = () => {
  return (
    <Suspense fallback={<LazyFallback />}>
      <Routes>
        {/* Public: market data */}
        <Route path="/" element={<MarketDashboard />} />
        <Route path="/map" element={<MarketMap />} />
        <Route path="/exchange" element={<Navigate to="/market/segments" replace />} />
        <Route path="/exchange/:symbol" element={<MarketFundDetail />} />
        <Route path="/segments" element={<MarketSegments />} />
        <Route path="/segments/:slug" element={<MarketSegmentDetail />} />

        {/* Protected */}
        <Route element={<ProtectedRoute />}>
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/portfolio/success" element={<CreditsSuccess />} />
          <Route path="/builder" element={<BuilderDashboard />} />
          <Route path="/contracts" element={<ContractStation />} />
          <Route path="/contracts/:contractId" element={<ContractStation />} />
        </Route>
      </Routes>
    </Suspense>
  );
};

export default MarketplaceModuleRoutes;
