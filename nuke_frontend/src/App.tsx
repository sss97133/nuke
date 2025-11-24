import React, { useState, useEffect, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate } from 'react-router-dom';
import { supabase } from './lib/supabase';
// Design system imported via index.css
import { ThemeProvider } from './contexts/ThemeContext';
import { ToastProvider as OldToastProvider } from './hooks/useToast';
import { ToastProvider } from './components/ui/Toast';
import { UploadStatusProvider } from './contexts/UploadStatusContext';
import GlobalUploadStatus from './components/GlobalUploadStatus';
import { UploadProgressBar } from './components/UploadProgressBar';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { TestMode } from './lib/test-mode';

// Database components
import DatabaseAudit from './pages/DatabaseAudit';
import Vehicles from './pages/Vehicles';
import AddVehicle from './pages/add-vehicle/AddVehicle';
import EditVehicle from './pages/EditVehicle';
import VehicleForm from './components/vehicles/VehicleForm';
import VehicleProfile from './pages/VehicleProfile';
// import VehicleEditForm from './pages/VehicleEditForm';
// import VehicleDateImages from './pages/VehicleDateImages';
import Dashboard from './pages/Dashboard';
import ImageProcessingDashboard from './pages/ImageProcessingDashboard';
import ScriptControlCenter from './pages/ScriptControlCenter';
import VehicleMakeModelDemo from './pages/VehicleMakeModelDemo';
import VehicleDataNormalization from './pages/VehicleDataNormalization';
import Profile from './pages/Profile';
import GhostUserProfile from './pages/GhostUserProfile';
import Login from './components/auth/Login';
import OAuthCallback from './components/auth/OAuthCallback';
import DropboxImport from './pages/DropboxImport';
import DealerDropboxImport from './pages/DealerDropboxImport';
import DealerBulkEditor from './pages/DealerBulkEditor';
import DealerAIAssistant from './pages/DealerAIAssistant';
import DropboxCallback from './pages/DropboxCallback';
import DropboxAIProcess from './pages/DropboxAIProcess';
import VehicleApproval from './pages/VehicleApproval';
// import PublicVehicleProfile from './pages/PublicVehicleProfile';
import VehicleModerationDashboard from './pages/VehicleModerationDashboard';
import VehicleContributionForm from './pages/VehicleContributionForm';
// Lazy load VehicleVerification to avoid blocking app startup
const VehicleVerification = React.lazy(() => import('./pages/VehicleVerification'));
import AllVehicles from './pages/AllVehicles';
import CursorHomepage from './pages/CursorHomepage';
import ProjectManagement from './pages/ProjectManagement';
import SimpleProjectManager from './pages/SimpleProjectManager';
import VehicleTasks from './pages/VehicleTasks';
import DataDiagnostic from './pages/DataDiagnostic';
import AdminVerifications from './pages/AdminVerifications';
import TestContributions from './pages/TestContributions';
import LiveFeed from './pages/LiveFeed';
import Discovery from './pages/Discovery';
import CurationQueue from './pages/CurationQueue';
// Debug pages removed during cleanup
import BrowseProfessionals from './pages/BrowseProfessionals';
import PhotoLibraryCategorizer from './components/PhotoLibraryCategorizer';
import AppLayout from './components/layout/AppLayout';
import ViewerDashboard from './pages/ViewerDashboard';
import VehicleInteractionManager from './pages/VehicleInteractionManager';
import AdminDashboard from './pages/AdminDashboard';
import OwnershipVerificationDashboard from './components/admin/OwnershipVerificationDashboard';
import Shops from './pages/Shops';
import ShopOnboarding from './pages/ShopOnboarding';
import Organizations from './pages/Organizations';
import OrganizationProfile from './pages/OrganizationProfile';
import CreateOrganization from './pages/CreateOrganization';
import ErrorBoundary from './components/util/ErrorBoundary';
import AcceptInvite from './pages/AcceptInvite';
import Notifications from './pages/Notifications';
import Inbox from './pages/Inbox';
// import type { BusinessManagement } from './pages/BusinessManagement';
import BulkPriceEditor from './pages/admin/BulkPriceEditor';
import PriceCsvImport from './pages/admin/PriceCsvImport';
import BookService from './pages/BookService';
import OrderParts from './pages/OrderParts';
import CreditsSuccess from './pages/CreditsSuccess';
import Portfolio from './pages/Portfolio';
import BuilderDashboard from './pages/BuilderDashboard';
import BrowseInvestments from './pages/BrowseInvestments';
import Legal from './pages/Legal';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';
import DataDeletion from './pages/DataDeletion';
import SignDocument from './pages/SignDocument';
import ShippingSettings from './pages/admin/ShippingSettings';
import BatchImageAnalysis from './pages/admin/BatchImageAnalysis';
import InvestorDashboardPage from './pages/InvestorDashboard';
import MergeProposalsDashboard from './pages/MergeProposalsDashboard';
import Library from './pages/Library';
import ExtractionReview from './pages/ExtractionReview';
import InvestmentOpportunities from './pages/InvestmentOpportunities';
import AdminMissionControl from './pages/AdminMissionControl';
import { PersonalPhotoLibrary } from './pages/PersonalPhotoLibrary';

// Financial & Accounting components
import InvoiceManager from './pages/InvoiceManager';
import ShopFinancials from './pages/ShopFinancials';
import SupplierDashboard from './pages/SupplierDashboard';
import ContractManager from './pages/ContractManager';
import KnowledgeBase from './pages/KnowledgeBase';

// Auction & Export components
import AuctionMarketplace from './pages/AuctionMarketplace';
import CreateAuctionListing from './components/auction/CreateAuctionListing';
import ListingPreparationWizard from './components/auction/ListingPreparationWizard';
import AuctionAnalyticsDashboard from './components/auction/AuctionAnalyticsDashboard';

// Auth components
import ResetPassword from './pages/ResetPassword';

function App() {
  const ENABLE_DEBUG = (import.meta as any).env?.VITE_ENABLE_DEBUG === 'true';
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
      if (session?.user) {
        ensureProfileExists(session.user.id, session.user.email || undefined);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        if (session?.user) {
          ensureProfileExists(session.user.id, session.user.email || undefined);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // Ensure a profile row exists for the authenticated user
  const ensureProfileExists = async (userId: string, email?: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .single();

      if (error && error.code !== 'PGRST116') {
        // ignore "No rows" code (varies by version); attempt upsert regardless
        console.warn('Profile lookup warning:', error.message);
      }

      if (!data) {
        const { error: upsertError } = await supabase
          .from('profiles')
          .upsert({ id: userId, email: email || null, updated_at: new Date().toISOString() }, { onConflict: 'id' });
        if (upsertError) {
          console.warn('Profile upsert failed:', upsertError.message);
        }
      }
    } catch (e: any) {
      console.warn('ensureProfileExists error:', e?.message || e);
    }
  };

  // Electron bridge: forward vehicle-detected events to backend ingestion
  useEffect(() => {
    const w = window as any;
    if (!session) return;

    const handler = async (vehicleRecord: any) => {
      try {
        // Behavior tracking removed during cleanup
        console.log('Vehicle detected:', vehicleRecord);
      } catch (e) {
        console.warn('Failed to process vehicle event:', e);
      }
    };

    if (w?.electron?.on) {
      w.electron.on('vehicle-detected', handler);
    }

    return () => {
      if (w?.electron?.removeListener) {
        w.electron.removeListener('vehicle-detected', handler);
      }
    };
  }, [session]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  if (loading) {
    return (
      <div className="layout">
        <div className="container">
          <div className="main">
            <div className="card">
              <div className="card-body">
                <div className="text-center">
                  <div className="text text-muted">Loading...</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Allow public access to Discovery and vehicle profile pages - vehicles should be viewable by all
  const isPublicRoute = window.location.pathname === '/' ||
                       window.location.pathname === '/discover' ||
                       window.location.pathname === '/auctions' ||
                       window.location.pathname.startsWith('/vehicle/') ||
                       window.location.pathname.startsWith('/invite/') ||
                       window.location.pathname === '/legal' ||
                       window.location.pathname === '/privacy' ||
                       window.location.pathname === '/terms' ||
                       window.location.pathname === '/data-deletion';

  // If not authenticated, show login for protected routes
  if (!session && !isPublicRoute) {
    return (
      <Router>
        <div className="layout">
          <main className="main">
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/auth/callback" element={<OAuthCallback />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/dropbox-callback" element={<DropboxCallback />} />
              <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
          </main>
        </div>
      </Router>
    );
  }

  return (
    <ThemeProvider>
      <OldToastProvider>
      <ToastProvider>
      <UploadStatusProvider>
        <Router>
        {/* Global Upload Status - Always visible at top */}
        <GlobalUploadStatus />

        <AppLayout>
          <Routes>
            {/* Home route - Landing Page */}
            <Route path="/" element={<CursorHomepage />} />

            {/* Main routes */}
            <Route path="/discover" element={<Discovery />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/vehicles" element={<Vehicles />} />
            <Route path="/all-vehicles" element={<AllVehicles />} />
            <Route path="/add-vehicle" element={<AddVehicle />} />
            <Route path="/make-model-demo" element={<VehicleMakeModelDemo />} />
            <Route path="/vehicle-data-normalization" element={<VehicleDataNormalization />} />
            <Route path="/viewer-dashboard" element={<ViewerDashboard />} />
            <Route path="/interaction-manager" element={<VehicleInteractionManager />} />
            
            {/* Professional Tools */}
            <Route path="/browse-professionals" element={<BrowseProfessionals />} />
            <Route path="/project-management" element={<ProjectManagement />} />
            <Route path="/simple-project-manager" element={<SimpleProjectManager />} />
            
            {/* Business Management - Temporarily disabled due to import issues */}
            {/* <Route path="/businesses" element={<BusinessManagement />} /> */}
            {/* <Route path="/business-management" element={<BusinessManagement />} /> */}
            
            {/* Media & Content Tools */}
            <Route path="/photos" element={<PersonalPhotoLibrary />} />
            <Route path="/photo-categorizer" element={<PhotoLibraryCategorizer />} />
            <Route path="/dropbox-import" element={<DropboxImport />} />
            <Route path="/dealer/:orgId/dropbox-import" element={<DealerDropboxImport />} />
          <Route path="/dealer/:orgId/bulk-editor" element={<DealerBulkEditor />} />
          <Route path="/dealer/:orgId/ai-assistant" element={<DealerAIAssistant />} />
            <Route path="/dropbox-callback" element={<DropboxCallback />} />
            <Route path="/dropbox-ai-process" element={<DropboxAIProcess />} />
            <Route path="/live-feed" element={<LiveFeed />} />
            <Route path="/book" element={<BookService />} />
            <Route path="/order-parts" element={<OrderParts />} />
            
            <Route path="/legal" element={<Legal />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/terms" element={<TermsOfService />} />
            <Route path="/data-deletion" element={<DataDeletion />} />
            
            {/* Portfolio & Trading - Legacy routes redirect to Market */}
            <Route path="/portfolio/success" element={<CreditsSuccess />} />
            <Route path="/portfolio" element={<Portfolio />} />
            {/* Legacy redirects */}
            <Route path="/credits/success" element={<CreditsSuccess />} />
            <Route path="/credits" element={<Portfolio />} />
            
            {/* Builder Dashboard - Legacy route, use Market instead */}
            <Route path="/builder" element={<BuilderDashboard />} />
            
            {/* Browse Investments - Legacy route, use Market instead */}
            <Route path="/browse-investments" element={<BrowseInvestments />} />
            <Route path="/investor/dashboard" element={<InvestorDashboardPage />} />
            
            {/* Auction Marketplace & Multi-Platform Export */}
            <Route path="/auctions" element={<AuctionMarketplace />} />
            <Route path="/auctions/create" element={<CreateAuctionListing />} />
            <Route path="/auctions/prepare" element={<ListingPreparationWizard />} />
            <Route path="/auctions/analytics" element={<AuctionAnalyticsDashboard />} />
            
            {/* Financial & Accounting Management */}
            <Route path="/invoices" element={<InvoiceManager />} />
            <Route path="/financials" element={<ShopFinancials />} />
            <Route path="/suppliers" element={<SupplierDashboard />} />
            <Route path="/contracts" element={<ContractManager />} />
            <Route path="/knowledge" element={<KnowledgeBase />} />
            
            {/* Vehicle Management */}
            <Route path="/vehicle/:vehicleId" element={<VehicleProfile />} />
            <Route path="/vehicle/:vehicleId/edit" element={<EditVehicle />} />
            {/* <Route path="/vehicle/:vehicleId/date-images" element={<VehicleDateImages />} /> */}
            <Route path="/vehicle-approval/:extractionId" element={<VehicleApproval />} />
            <Route path="/vehicle-verification/:vehicleId" element={
              <Suspense fallback={<div>Loading...</div>}>
                <VehicleVerification />
              </Suspense>
            } />
            
            {/* Secretary Mode - Rapid Curation */}
            <Route path="/curation/queue" element={<CurationQueue />} />
            <Route path="/review/ai-detections" element={<CurationQueue />} />
            
            {/* Admin & Development */}
            <Route path="/admin" element={<AdminMissionControl />} />
            <Route path="/admin/old" element={<AdminDashboard />} />
            <Route path="/admin/scripts" element={<ScriptControlCenter />} />
            <Route path="/admin/image-processing" element={<ImageProcessingDashboard />} />
            <Route path="/admin/batch-analysis" element={<BatchImageAnalysis />} />
            <Route path="/admin/verifications" element={<AdminVerifications />} />
            <Route path="/admin/ownership-verifications" element={<OwnershipVerificationDashboard />} />
            <Route path="/admin/merge-proposals" element={<MergeProposalsDashboard />} />
            <Route path="/admin/price-editor" element={<BulkPriceEditor />} />
            <Route path="/admin/price-import" element={<PriceCsvImport />} />
            <Route path="/admin/shipping-settings" element={<ShippingSettings />} />
            <Route path="/admin/extraction-review" element={<ExtractionReview />} />
            
            {/* Transaction & Signature Routes */}
            <Route path="/sign/:token" element={<SignDocument />} />
            <Route path="/shops" element={<Navigate to="/organizations" replace />} />
            <Route path="/shops/onboarding" element={<Navigate to="/org/create" replace />} />
            <Route path="/shops/new" element={<CreateOrganization />} />
            <Route path="/organizations" element={<Organizations />} />
            <Route path="/investment-opportunities" element={<InvestmentOpportunities />} />
            <Route path="/library" element={<Library />} />
            <Route path="/org/create" element={<CreateOrganization />} />
            <Route path="/org/:id" element={<ErrorBoundary><OrganizationProfile /></ErrorBoundary>} />
            <Route path="/invite/:token" element={<AcceptInvite />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/inbox" element={<Inbox />} />
            
            {/* Additional Vehicle routes */}
            <Route path="/vehicle/:vehicleId/moderate" element={<VehicleModerationDashboard />} />
            <Route path="/vehicle/:vehicleId/contribute" element={<VehicleContributionForm />} />
            <Route path="/vehicle-tasks/:vehicleId" element={<VehicleTasks />} />
            <Route path="/vehicles/:id" element={<VehicleProfile />} />
            {/* <Route path="/public/:slug" element={<PublicVehicleProfile />} /> */}
            
            {/* Legacy redirects */}
            <Route path="/local-vehicles" element={<Navigate to="/vehicles" replace />} />
            <Route path="/add-vehicles" element={<Navigate to="/add-vehicle" replace />} />
            <Route path="/vehicle-manilla-envelope" element={<Navigate to="/add-vehicle" replace />} />
            <Route path="/settings" element={<Navigate to="/dashboard" replace />} />
            
            {/* Debug/Admin routes - gated by env flag */}
            {ENABLE_DEBUG && (
              <>
                <Route path="/data-diagnostic" element={<DataDiagnostic />} />
                <Route path="/test-contributions" element={<TestContributions />} />
                {/* ImageDebugger route removed during cleanup */}
                <Route path="/database-audit" element={<DatabaseAudit />} />
              </>
            )}

            <Route path="/profile" element={<Profile />} />
            <Route path="/profile/:userId" element={<Profile />} />
            <Route path="/ghost-user/:ghostUserId" element={<GhostUserProfile />} />
            <Route path="/login" element={<Login />} />
            <Route path="/reset-password" element={<ResetPassword />} />

            {/* Fallback for unknown routes */}
            <Route path="*" element={
              <div className="container">
                <div className="main">
                  <div className="card">
                    <div className="card-body text-center">
                      <h1 className="text font-bold text-primary">Page Not Found</h1>
                      <p className="text text-muted mb-4">The page you're looking for doesn't exist.</p>
                      <Link to="/vehicles" className="button button-primary">
                        Go to Vehicles
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            } />
          </Routes>
        </AppLayout>
        {/* Global Upload Progress Bar - Persists across navigation */}
        <UploadProgressBar />
        </Router>
      </UploadStatusProvider>
      </ToastProvider>
      </OldToastProvider>
      <SpeedInsights />
    </ThemeProvider>
  );
}

export default App;
