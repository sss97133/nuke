// src/routes/DomainRoutes.tsx
import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

// Static pages (footer/legal)
import About from '../pages/About';
import PrivacyPolicy from '../pages/PrivacyPolicy';
import TermsOfService from '../pages/TermsOfService';
import DataDeletion from '../pages/DataDeletion';

// Lazy load domain modules
const VehicleRoutes = React.lazy(() => import('./modules/vehicle/routes'));
const OrganizationRoutes = React.lazy(() => import('./modules/organization/routes'));
const DealerRoutes = React.lazy(() => import('./modules/dealer/routes'));
const AdminRoutes = React.lazy(() => import('./modules/admin/routes'));
const MarketplaceRoutes = React.lazy(() => import('./modules/marketplace/routes'));

export const DomainRoutes = () => {
  return (
    <Suspense fallback={<div className="p-4 text-center">Loading module...</div>}>
      <Routes>
        {/* Static / legal pages */}
        <Route path="/about" element={<About />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/terms" element={<TermsOfService />} />
        <Route path="/data-deletion" element={<DataDeletion />} />

        {/* Domain Modules */}
        <Route path="/vehicle/*" element={<VehicleRoutes />} />
        <Route path="/org/*" element={<OrganizationRoutes />} />
        <Route path="/dealer/*" element={<DealerRoutes />} />
        <Route path="/admin/*" element={<AdminRoutes />} />
        <Route path="/market/*" element={<MarketplaceRoutes />} />

        {/* Legacy Route Compatibility Shims */}
        <Route path="/vehicles" element={<Navigate to="/vehicle/list" replace />} />
        <Route path="/add-vehicle" element={<Navigate to="/vehicle/add" replace />} />
        <Route path="/dashboard" element={<Navigate to="/org/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
};
