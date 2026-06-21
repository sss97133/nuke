import React, { Suspense } from 'react';
import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from './contexts/ThemeContext';
import { BrandingProvider } from './branding/BrandingContext';
import ModeAutoController from './branding/ModeAutoController';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './components/ui/Toast';
import { ToastProvider as OldToastProvider } from './hooks/useToast';
import { UploadStatusProvider } from './contexts/UploadStatusContext';
import { UploadProgressBar } from './components/UploadProgressBar';
import { PopupStackProvider } from './components/popups';
import GlobalUploadStatus from './components/GlobalUploadStatus';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { Toaster } from 'react-hot-toast';
import AppLayout from './components/layout/AppLayout';
import { DomainRoutes } from './routes/DomainRoutes';
import ErrorBoundary from './components/ErrorBoundary';
import { AuthErrorBoundary } from './components/auth/AuthErrorBoundary';
import { useAuth } from './hooks/useAuth';
const HomePage = React.lazy(() => import('./pages/HomePage'));
const LandingPage = React.lazy(() => import('./pages/landing/LandingPage'));
const IntakePage = React.lazy(() => import('./pages/intake/IntakePage'));
const ProductPage = React.lazy(() => import('./pages/landing/ProductPage'));
const PublicMap = React.lazy(() => import('./components/map/PublicMap'));
const NukeMap = React.lazy(() => import('./components/map/NukeMap'));
const VehicleShowcase = React.lazy(() => import('./pages/showcase/VehicleShowcase'));
const DeckPage = React.lazy(() => import('./pages/DeckPage'));
const ShareWiring = React.lazy(() => import('./pages/ShareWiring'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5 * 60 * 1000, retry: 1 },
  },
});

const LazyFallback = <div style={{ height: '100vh', background: 'var(--bg)' }} />;

/**
 * Home route gate — IntakePage (Janitor drain, F6) for logged-out visitors,
 * HomePage (in AppLayout) for logged-in users.
 *
 * Pre-F6 this rendered LandingPage; the canon (the-three-users-and-the-finder.md)
 * says the front door is the dump prompt, not a hero/search splash. LandingPage
 * is preserved (still imported below) as a fallback for ?legacy_landing=1 if we
 * need to A/B compare; otherwise unused.
 */
function HomeGate() {
  const { user, loading } = useAuth();
  if (loading) return LazyFallback;
  if (!user) {
    const params = new URLSearchParams(window.location.search);
    if (params.get('legacy_landing') === '1') {
      return <Suspense fallback={LazyFallback}><LandingPage /></Suspense>;
    }
    // /explore (or any treemap deep-link) routes here with ?force_treemap=1.
    // Hand off to HomePage so it can render TreemapHomePage.
    if (params.get('force_treemap') === '1') {
      return (
        <AppLayout>
          <Suspense fallback={LazyFallback}><HomePage /></Suspense>
        </AppLayout>
      );
    }
    return (
      <AppLayout>
        <Suspense fallback={LazyFallback}><IntakePage variant="homepage" /></Suspense>
      </AppLayout>
    );
  }
  return (
    <AppLayout>
      <Suspense fallback={LazyFallback}><HomePage /></Suspense>
    </AppLayout>
  );
}

/**
 * RoutedApp — lives inside <Router> so it can use useLocation().
 * Passes location.key to ErrorBoundary so it resets on every navigation,
 * preventing stale error screens when the URL changes.
 */
function RoutedApp() {
  const location = useLocation();

  return (
    <>
      <PopupStackProvider>
      <GlobalUploadStatus />

      <ErrorBoundary resetKeys={[location.pathname]}>
        <AuthErrorBoundary>
        <Routes>
          {/* ── Standalone pages (no AppLayout chrome) ── */}
          <Route path="/" element={<HomeGate />} />
          <Route path="/products/:slug" element={<Suspense fallback={LazyFallback}><ProductPage /></Suspense>} />
          <Route path="/map" element={<Suspense fallback={LazyFallback}><PublicMap /></Suspense>} />
          <Route path="/atlas" element={<Suspense fallback={LazyFallback}><div style={{ position: 'fixed', inset: 0 }}><NukeMap /></div></Suspense>} />
          <Route path="/showcase" element={<Suspense fallback={LazyFallback}><VehicleShowcase /></Suspense>} />
          <Route path="/showcase/:vehicleId" element={<Suspense fallback={LazyFallback}><VehicleShowcase /></Suspense>} />
          <Route path="/deck/:deckId" element={<Suspense fallback={LazyFallback}><DeckPage /></Suspense>} />
          {/* Builder share view — zero-chrome public print package (receipt 2026-06-11_builder-share-view.md) */}
          <Route path="/share/wiring/:vehicleId" element={<Suspense fallback={LazyFallback}><ShareWiring /></Suspense>} />

          {/* ── App shell routes (with AppLayout) ── */}
          <Route path="/*" element={
            <AppLayout>
              <DomainRoutes />
            </AppLayout>
          } />
        </Routes>
        </AuthErrorBoundary>
      </ErrorBoundary>

      <UploadProgressBar />
      </PopupStackProvider>
    </>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
    {/* AuthProvider is outermost so every hook and page reads from the same
        single cached session — no per-component getSession() calls needed. */}
    <AuthProvider>
    <ThemeProvider>
      <BrandingProvider>
      <ModeAutoController />
      <ToastProvider>
        <OldToastProvider>
          <UploadStatusProvider>
            <Router>
              <RoutedApp />
            </Router>
          </UploadStatusProvider>

          <Toaster position="top-right" />
          <SpeedInsights />
        </OldToastProvider>
      </ToastProvider>
      </BrandingProvider>
    </ThemeProvider>
    </AuthProvider>
    </QueryClientProvider>
  );
}


