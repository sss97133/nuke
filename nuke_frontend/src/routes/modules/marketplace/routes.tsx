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

const MarketplaceModuleRoutes = () => {
  return (
    <Routes>
      <Route path="/" element={<BrowseInvestments />} />
      <Route path="/browse" element={<BrowseInvestments />} />
      <Route path="/exchange" element={<MarketExchange />} />
      <Route path="/exchange/:symbol" element={<MarketFundDetail />} />
      <Route path="/investor/dashboard" element={<InvestorDashboardPage />} />
      <Route path="/portfolio" element={<Portfolio />} />
      <Route path="/portfolio/success" element={<CreditsSuccess />} />
      <Route path="/builder" element={<BuilderDashboard />} />
    </Routes>
  );
};

export default MarketplaceModuleRoutes;

