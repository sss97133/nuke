import React from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from './contexts/ThemeContext';
import { ToastProvider } from './components/ui/Toast';
import { ToastProvider as OldToastProvider } from './hooks/useToast';
import { UploadStatusProvider } from './contexts/UploadStatusContext';
import { UploadProgressBar } from './components/UploadProgressBar';
import GlobalUploadStatus from './components/GlobalUploadStatus';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { Toaster } from 'react-hot-toast';
import AppLayout from './components/layout/AppLayout';
import { DomainRoutes } from './routes/DomainRoutes';
import HomePage from './pages/HomePage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5 * 60 * 1000, retry: 1 },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <ToastProvider>
        <OldToastProvider>
          <UploadStatusProvider>
            <Router>
              <GlobalUploadStatus />

              <AppLayout>
                <Routes>
                  {/* Hub: tabbed homepage (Garage, Feed, Map, Market) */}
                  <Route path="/" element={<HomePage />} />
                  {/* Domain modules + legacy shims */}
                  <Route path="/*" element={<DomainRoutes />} />
                </Routes>
              </AppLayout>

              <UploadProgressBar />
            </Router>
          </UploadStatusProvider>

          <Toaster position="top-right" />
          <SpeedInsights />
        </OldToastProvider>
      </ToastProvider>
    </ThemeProvider>
    </QueryClientProvider>
  );
}


