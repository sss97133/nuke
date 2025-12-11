import React from 'react';
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
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

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <OldToastProvider>
          <UploadStatusProvider>
            <Router>
              <GlobalUploadStatus />

              <AppLayout>
                <Routes>
                  {/* Default entry */}
                  <Route path="/" element={<Navigate to="/vehicle/list" replace />} />
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
  );
}


