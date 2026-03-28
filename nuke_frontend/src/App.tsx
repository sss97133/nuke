import React, { Suspense } from 'react';
import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from './contexts/ThemeContext';
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
const HomePage = React.lazy(() => import('./pages/HomePage'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5 * 60 * 1000, retry: 1 },
  },
});

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
        <AppLayout>
          <Routes>
            {/* Hub: tabbed homepage (Garage, Feed, Map, Market) */}
            <Route path="/" element={<Suspense fallback={<div style={{ height: '100vh', background: 'var(--bg)' }} />}><HomePage /></Suspense>} />
            {/* Domain modules + legacy shims */}
            <Route path="/*" element={<DomainRoutes />} />
          </Routes>
        </AppLayout>
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
    </ThemeProvider>
    </AuthProvider>
    </QueryClientProvider>
  );
}


