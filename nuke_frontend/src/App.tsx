import React, { useState, useEffect, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate } from 'react-router-dom';
import { supabase } from './lib/supabase';
import './design-system.css';
import { ToastProvider } from './hooks/useToast';
import GlobalUploadStatus from './components/GlobalUploadStatus';
import { UploadProgressBar } from './components/UploadProgressBar';

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
import VehicleMakeModelDemo from './pages/VehicleMakeModelDemo';
import VehicleDataNormalization from './pages/VehicleDataNormalization';
import Profile from './pages/Profile';
import Login from './components/auth/Login';
import OAuthCallback from './components/auth/OAuthCallback';
import DropboxImport from './pages/DropboxImport';
import DropboxCallback from './pages/DropboxCallback';
import DropboxAIProcess from './pages/DropboxAIProcess';
import VehicleApproval from './pages/VehicleApproval';
// import PublicVehicleProfile from './pages/PublicVehicleProfile';
import VehicleModerationDashboard from './pages/VehicleModerationDashboard';
import VehicleContributionForm from './pages/VehicleContributionForm';
// Lazy load VehicleVerification to avoid blocking app startup
const VehicleVerification = React.lazy(() => import('./pages/VehicleVerification'));
import AllVehicles from './pages/AllVehicles';
import ProjectManagement from './pages/ProjectManagement';
import SimpleProjectManager from './pages/SimpleProjectManager';
import VehicleTasks from './pages/VehicleTasks';
import DataDiagnostic from './pages/DataDiagnostic';
import AdminVerifications from './pages/AdminVerifications';
import TestContributions from './pages/TestContributions';
import LiveFeed from './pages/LiveFeed';
import Discovery from './pages/Discovery';
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
// import OrganizationProfile from './pages/OrganizationProfile'; // Temporarily disabled due to build errors
import ErrorBoundary from './components/util/ErrorBoundary';
import AcceptInvite from './pages/AcceptInvite';
import Notifications from './pages/Notifications';
import Inbox from './pages/Inbox';
// import type { BusinessManagement } from './pages/BusinessManagement';
import BulkPriceEditor from './pages/admin/BulkPriceEditor';
import PriceCsvImport from './pages/admin/PriceCsvImport';
import BookService from './pages/BookService';
import OrderParts from './pages/OrderParts';


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
                       window.location.pathname.startsWith('/vehicle/') ||
                       window.location.pathname.startsWith('/invite/');

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
    <ToastProvider>
      <Router>
        {/* Global Upload Status - Always visible at top */}
        <GlobalUploadStatus />

        <ErrorBoundary>
          <AppLayout>
            <Routes>
            {/* Home route - Landing Page */}
            <Route path="/" element={<Discovery />} />

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
            <Route path="/photo-categorizer" element={<PhotoLibraryCategorizer />} />
            <Route path="/dropbox-import" element={<DropboxImport />} />
            <Route path="/dropbox-callback" element={<DropboxCallback />} />
            <Route path="/dropbox-ai-process" element={<DropboxAIProcess />} />
            <Route path="/live-feed" element={<LiveFeed />} />
            <Route path="/book" element={<BookService />} />
            <Route path="/order-parts" element={<OrderParts />} />
            
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
            
            {/* Admin & Development */}
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/verifications" element={<AdminVerifications />} />
            <Route path="/admin/ownership-verifications" element={<OwnershipVerificationDashboard />} />
            <Route path="/admin/price-editor" element={<BulkPriceEditor />} />
            <Route path="/admin/price-import" element={<PriceCsvImport />} />
            <Route path="/shops" element={<Shops />} />
            <Route path="/shops/onboarding" element={<ShopOnboarding />} />
            {/* <Route path="/org/:orgId" element={<ErrorBoundary><OrganizationProfile /></ErrorBoundary>} /> */}
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
        </ErrorBoundary>
        {/* Global Upload Progress Bar - Persists across navigation */}
        <UploadProgressBar />
      </Router>
    </ToastProvider>
  );
}

export default App;
