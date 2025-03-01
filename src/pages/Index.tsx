
import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { DashboardHeader } from "@/components/dashboard/header/DashboardHeader";
import Home from "./Home";
import Login from "./Login";
import PluginDownload from "./PluginDownload";
import NotFound from "./NotFound";
import Crypto from "./Crypto";
import Discover from "./Discover";
import Skills from "./Skills";
import Tokens from "./Tokens";
import Streaming from "./Streaming";
import TokenAnalytics from "./TokenAnalytics";
import MarketAnalysis from "./MarketAnalysis";
import Studio from "./Studio";
import VinScanner from "./VinScanner";
import ProfessionalDashboard from "./ProfessionalDashboard";
import Service from "./Service";
import Inventory from "./Inventory";
import Settings from "./Settings";
import Achievements from "./Achievements";
import ImportPage from "./ImportPage";

const Index = () => {
  const handleMenuAction = (action: string) => {
    console.log('Menu action:', action);
    // Menu actions can be implemented here
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <DashboardHeader handleMenuAction={handleMenuAction} />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/plugin" element={<PluginDownload />} />
          <Route path="/crypto" element={<Crypto />} />
          <Route path="/discover" element={<Discover />} />
          <Route path="/skills" element={<Skills />} />
          <Route path="/tokens" element={<Tokens />} />
          <Route path="/streaming" element={<Streaming />} />
          <Route path="/token-analytics" element={<TokenAnalytics />} />
          <Route path="/market-analysis" element={<MarketAnalysis />} />
          <Route path="/studio" element={<Studio />} />
          <Route path="/vin-scanner" element={<VinScanner />} />
          <Route path="/professional-dashboard" element={<ProfessionalDashboard />} />
          <Route path="/service" element={<Service />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/achievements" element={<Achievements />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/track" element={<MarketAnalysis />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
};

export default Index;
