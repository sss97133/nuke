// src/routes/DomainRoutes.tsx
import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

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
