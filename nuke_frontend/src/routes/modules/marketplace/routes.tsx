// src/routes/modules/marketplace/routes.tsx
import React from 'react';
import { Routes, Route } from 'react-router-dom';
import BrowseInvestments from '../../../pages/BrowseInvestments';
import InvestorDashboardPage from '../../../pages/InvestorDashboard';
import Portfolio from '../../../pages/Portfolio';
import CreditsSuccess from '../../../pages/CreditsSuccess';
import BuilderDashboard from '../../../pages/BuilderDashboard';
import MarketExchange from '../../../pages/MarketExchange';
import MarketFundDetail from '../../../pages/MarketFundDetail';
import MarketSegments from '../../../pages/MarketSegments';
import MarketSegmentDetail from '../../../pages/MarketSegmentDetail';
import DebugMarketSegment from '../../../pages/DebugMarketSegment';
import MarketMovement from '../../../pages/MarketMovement';
import MarketDashboard from '../../../pages/MarketDashboard';
import ContractStation from '../../../pages/ContractStation';

const MarketplaceModuleRoutes = () => {
  return (
    <Routes>
      <Route path="/" element={<MarketDashboard />} />
      <Route path="/dashboard" element={<MarketDashboard />} />
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
    </Routes>
  );
};

export default MarketplaceModuleRoutes;

