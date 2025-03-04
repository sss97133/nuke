import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import DiscoveredVehicles from './pages/DiscoveredVehicles';
import { AuthCallback } from './components/auth/AuthCallback';
import { AuthProvider } from './hooks/auth/use-auth-provider';
import { AuthRequiredLayout } from './components/layout/AuthRequiredLayout';
import { NavSidebar } from './components/layout/NavSidebar';
import { Import } from './components/import/Import';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallback />} />
          
          <Route element={<AuthRequiredLayout />}>
            <Route path="/dashboard" element={<NavSidebar />}>
              <Route path="discovered-vehicles" element={<DiscoveredVehicles />} />
              <Route path="import" element={<Import />} />
            </Route>
            <Route path="/discovered-vehicles" element={<Navigate to="/dashboard/discovered-vehicles" replace />} />
            <Route path="/import" element={<Navigate to="/dashboard/import" replace />} />
          </Route>
          
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
