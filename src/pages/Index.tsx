
import React from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
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
import { toast } from "sonner";
import { 
  handleFileMenuAction, 
  handleEditMenuAction, 
  handleViewMenuAction, 
  handleToolsMenuAction, 
  handleWindowMenuAction, 
  handleHelpMenuAction 
} from "@/components/dashboard/hooks/utils/navigationUtils";
import { ToastFunction } from "@/components/dashboard/hooks/utils/types";

const Index = () => {
  const navigate = useNavigate();

  // Create a wrapper for the toast function to match the expected type
  const toastWrapper: ToastFunction = (options) => {
    if (typeof options === 'string') {
      return toast(options);
    }
    return toast(options.description || '', {
      description: options.title,
    });
  };

  const handleMenuAction = (action: string) => {
    console.log('Menu action:', action);
    
    // Determine which category the action belongs to based on naming patterns
    if (action.startsWith('new_') || ['import', 'export', 'sitemap', 'glossary', 'exit'].includes(action)) {
      handleFileMenuAction(navigate, toastWrapper, action);
    } else if (['preferences', 'studio_config', 'workspace_settings'].includes(action)) {
      handleEditMenuAction(navigate, toastWrapper, action);
    } else if (action.startsWith('toggle_') || ['professional_dashboard', 'inventory_view', 'service_view', 'token_management', 'dao_governance', 'access_control'].includes(action)) {
      handleViewMenuAction(navigate, toastWrapper, action);
    } else if (['vin_scanner', 'market_analysis', 'skill_management', 'token_analytics'].includes(action)) {
      handleToolsMenuAction(navigate, toastWrapper, action);
    } else if (['studio_workspace', 'streaming_setup', 'achievements', 'reset_layout'].includes(action)) {
      handleWindowMenuAction(navigate, toastWrapper, action);
    } else if (['documentation', 'keyboard_shortcuts', 'about'].includes(action)) {
      handleHelpMenuAction(navigate, toastWrapper, action);
    } else {
      toast(action + " is not recognized", {
        description: `The action "${action}" is not recognized.`
      });
    }
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
