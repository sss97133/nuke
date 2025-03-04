import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import DiscoveredVehicles from './pages/DiscoveredVehicles';
import { AuthCallback } from './components/auth/AuthCallback';
import { AuthProvider } from './hooks/auth/use-auth-provider';
import { AuthRequiredLayout } from './components/layout/AuthRequiredLayout';
import { NavSidebar } from './components/layout/NavSidebar';
import './App.css';

// Import other components and providers as needed

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Auth routes */}
          <Route path="/auth/callback" element={<AuthCallback />} />
          
          {/* Protected routes */}
          <Route element={<AuthRequiredLayout />}>
            <Route path="/dashboard" element={<NavSidebar />}>
              {/* Dashboard child routes */}
              <Route path="discovered-vehicles" element={<DiscoveredVehicles />} />
              {/* Other dashboard routes */}
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
