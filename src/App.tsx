import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthCallback } from './components/auth/AuthCallback';
import { AuthProvider } from './hooks/auth/use-auth-provider';
import { AuthRequiredLayout } from './components/layout/AuthRequiredLayout';
import { NavSidebar } from './components/layout/NavSidebar';
import { Toaster } from 'sonner';
import './App.css';

import DiscoveredVehicles from './pages/DiscoveredVehicles';
import Dashboard from './pages/Dashboard';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Toaster position="top-right" />
        <Routes>
          {/* Auth routes */}
          <Route path="/auth/callback" element={<AuthCallback />} />
          
          {/* Protected routes */}
          <Route element={<AuthRequiredLayout />}>
            <Route path="/dashboard" element={<NavSidebar />}>
              {/* Dashboard as the main page */}
              <Route index element={<Dashboard />} />
              
              {/* Other dashboard routes */}
              <Route path="discovered-vehicles" element={<DiscoveredVehicles />} />
            </Route>
            
            <Route path="/discovered-vehicles" element={<Navigate to="/dashboard/discovered-vehicles" replace />} />
          </Route>
          
          {/* Public routes */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          
          {/* Catch-all route */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
