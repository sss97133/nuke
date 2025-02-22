
import { useEffect } from "react";
import { Routes, Route, useNavigate, useLocation, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { useToast } from "@/hooks/use-toast";
import { NotFound } from "./NotFound";
import { Settings } from "./Settings";
import Login from "./Login";
import { Import } from "@/components/import/Import";
import { Glossary } from "@/components/glossary/Glossary";
import { Sitemap } from "@/components/sitemap/Sitemap";
import { Home } from "./Home";
import { TokenManagement } from "@/components/tokens/TokenManagement";
import { DAOGovernance } from "@/components/dao/DAOGovernance";
import { StudioConfiguration } from "@/components/studio/StudioConfiguration";
import { ProfessionalDashboard } from "@/components/dashboard/ProfessionalDashboard";
import { MarketAnalysis } from "@/components/vehicles/MarketAnalysis";
import { VinCapture as VinScanner } from "@/components/vehicles/VinCapture";
import { TokenAnalytics } from "@/components/terminal/panels/TokenAnalyticsPanel";
import { AccessControl } from "@/components/auth/AccessControl";
import { VehicleTokens } from "@/components/tokens/VehicleTokens";
import { DAOProposals } from "@/components/dao/DAOProposals";
import { AuctionList as Auctions } from "@/components/auctions/AuctionList";
import { VideoAnalysis } from "./VideoAnalysis";

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { session, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

export const Index = () => {
  const { session, isLoading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (!isLoading && session && location.pathname === '/login') {
      navigate('/dashboard');
    }
  }, [session, isLoading, navigate, location]);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      
      <Route path="/dashboard" element={
        <ProtectedRoute>
          <DashboardLayout />
        </ProtectedRoute>
      }>
        <Route index element={<Home />} />
        <Route path="settings" element={<Settings />} />
        <Route path="import" element={<Import />} />
        <Route path="glossary" element={<Glossary />} />
        <Route path="sitemap" element={<Sitemap />} />
        <Route path="token-management" element={<TokenManagement />} />
        <Route path="dao-governance" element={<DAOGovernance />} />
        <Route path="studio-config" element={<StudioConfiguration />} />
        <Route path="professional" element={<ProfessionalDashboard />} />
        <Route path="market-analysis" element={
          <MarketAnalysis vehicleData={{ make: "Sample", model: "Vehicle", year: 2024 }} />
        } />
        <Route path="vin-scanner" element={
          <VinScanner onVinData={(data) => console.log('VIN data:', data)} />
        } />
        <Route path="token-analytics" element={<TokenAnalytics />} />
        <Route path="access-control" element={<AccessControl />} />
        <Route path="vehicle-tokens" element={<VehicleTokens />} />
        <Route path="dao-proposals" element={<DAOProposals />} />
        <Route path="auctions" element={<Auctions />} />
      </Route>

      <Route path="/video-analysis/:jobId" element={
        <ProtectedRoute>
          <VideoAnalysis />
        </ProtectedRoute>
      } />

      <Route path="/" element={
        <Navigate to="/dashboard" replace />
      } />

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

export default Index;
