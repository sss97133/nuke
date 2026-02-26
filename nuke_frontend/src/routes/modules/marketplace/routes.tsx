// src/routes/modules/marketplace/routes.tsx
import React, { Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';

const BrowseInvestments = React.lazy(() => import('../../../pages/BrowseInvestments'));
const InvestorDashboardPage = React.lazy(() => import('../../../pages/InvestorDashboard'));
const Portfolio = React.lazy(() => import('../../../pages/Portfolio'));
const CreditsSuccess = React.lazy(() => import('../../../pages/CreditsSuccess'));
const BuilderDashboard = React.lazy(() => import('../../../pages/BuilderDashboard'));
const MarketExchange = React.lazy(() => import('../../../pages/MarketExchange'));
const MarketFundDetail = React.lazy(() => import('../../../pages/MarketFundDetail'));
const MarketSegments = React.lazy(() => import('../../../pages/MarketSegments'));
const MarketSegmentDetail = React.lazy(() => import('../../../pages/MarketSegmentDetail'));
const DebugMarketSegment = React.lazy(() => import('../../../pages/DebugMarketSegment'));
const MarketMovement = React.lazy(() => import('../../../pages/MarketMovement'));
const MarketDashboard = React.lazy(() => import('../../../pages/MarketDashboard'));
const ContractStation = React.lazy(() => import('../../../pages/ContractStation'));
const MarketMap = React.lazy(() => import('../../../components/market/MarketMap'));
const BidMarketDashboard = React.lazy(() => import('../../../pages/BidMarketDashboard'));
const MarketCompetitors = React.lazy(() => import('../../../pages/MarketCompetitors'));

const LazyFallback = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh', color: '#888', fontSize: '9pt' }}>
    loading...
  </div>
);

const MarketplaceModuleRoutes = () => {
  return (
    <Suspense fallback={<LazyFallback />}>
      <Routes>
        <Route path="/" element={<MarketDashboard />} />
        <Route path="/dashboard" element={<MarketDashboard />} />
        <Route path="/map" element={<MarketMap />} />
        <Route path="/browse" element={<BrowseInvestments />} />
        <Route path="/exchange" element={<MarketExchange />} />
        <Route path="/exchange/:symbol" element={<MarketFundDetail />} />
        <Route path="/segments" element={<MarketSegments />} />
        <Route path="/segments/:slug" element={<DebugMarketSegment />} />
        <Route path="/movement" element={<MarketMovement />} />
        <Route path="/investor/dashboard" element={<InvestorDashboardPage />} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/portfolio/success" element={<CreditsSuccess />} />
        <Route path="/builder" element={<BuilderDashboard />} />
        <Route path="/contracts" element={<ContractStation />} />
        <Route path="/contracts/:contractId" element={<ContractStation />} />
        <Route path="/bids" element={<BidMarketDashboard />} />
        <Route path="/competitors" element={<MarketCompetitors />} />
      </Routes>
    </Suspense>
  );
};

export default MarketplaceModuleRoutes;
