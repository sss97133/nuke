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

// Legacy pages (still used by navigation components)
const Profile = React.lazy(() => import('../pages/Profile'));
const Capsule = React.lazy(() => import('../pages/Capsule'));
const Library = React.lazy(() => import('../pages/Library'));
const AuctionMarketplace = React.lazy(() => import('../pages/AuctionMarketplace'));
const Notifications = React.lazy(() => import('../pages/Notifications'));

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
        <Route path="/organizations" element={<Navigate to="/org" replace />} />
        <Route path="/shops" element={<Navigate to="/org" replace />} />
        <Route path="/shops/onboarding" element={<Navigate to="/org/create" replace />} />
        <Route path="/shops/new" element={<Navigate to="/org/create" replace />} />

        {/* Legacy user pages (used by header nav / profile capsule) */}
        <Route path="/profile" element={<Profile />} />
        <Route path="/profile/:userId" element={<Profile />} />
        <Route path="/capsule" element={<Capsule />} />
        <Route path="/library" element={<Library />} />
        <Route path="/auctions" element={<AuctionMarketplace />} />
        <Route path="/notifications" element={<Notifications />} />
      </Routes>
    </Suspense>
  );
};
