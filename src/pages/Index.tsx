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

  console.log("[ProtectedRoute] Status - Loading:", isLoading, "Session:", !!session);

  if (isLoading) {
    console.log("[ProtectedRoute] Still loading auth state...");
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
    console.log("[ProtectedRoute] No session found, redirecting to login");
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  console.log("[ProtectedRoute] Auth check passed, rendering content");
  return <>{children}</>;
};

export const Index = () => {
  const { session, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!isLoading) {
      console.log("[Index] Auth state resolved - Session:", !!session, "Path:", location.pathname);
      
      if (session && location.pathname === '/login') {
        console.log("[Index] Redirecting authenticated user from login to dashboard");
        navigate('/dashboard');
      }

      if (location.pathname === '/settings') {
        console.log("[Index] Redirecting /settings to /dashboard/settings");
        navigate('/dashboard/settings', { replace: true });
      }

      if (location.pathname === '/sitemap') {
        console.log("[Index] Redirecting /sitemap to /dashboard/sitemap");
        navigate('/dashboard/sitemap', { replace: true });
      }
    }
  }, [session, isLoading, navigate, location.pathname]);

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

      <Route path="/import" element={
        <Navigate to="/dashboard/import" replace />
      } />

      <Route path="/glossary" element={
        <Navigate to="/dashboard/glossary" replace />
      } />

      <Route path="/sitemap" element={
        <Navigate to="/dashboard/sitemap" replace />
      } />

      <Route path="/video-analysis/:jobId" element={
        <ProtectedRoute>
          <VideoAnalysis />
        </ProtectedRoute>
      } />

      <Route path="/" element={
        <Navigate to="/dashboard" replace />
      } />

      <Route path="/settings" element={
        <Navigate to="/dashboard/settings" replace />
      } />

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

export default Index;
