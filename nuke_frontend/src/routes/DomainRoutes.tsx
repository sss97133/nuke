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

// Auth / callbacks (still referenced by many pages/components)
const Login = React.lazy(() => import('../components/auth/Login'));
const OAuthCallback = React.lazy(() => import('../components/auth/OAuthCallback'));
const ResetPassword = React.lazy(() => import('../pages/ResetPassword'));
const DropboxCallback = React.lazy(() => import('../pages/DropboxCallback'));

// Legacy pages (still used by navigation components)
const Profile = React.lazy(() => import('../pages/Profile'));
const Capture = React.lazy(() => import('../pages/Capture'));
const Capsule = React.lazy(() => import('../pages/Capsule'));
const Library = React.lazy(() => import('../pages/Library'));
const AuctionMarketplace = React.lazy(() => import('../pages/AuctionMarketplace'));
const Notifications = React.lazy(() => import('../pages/Notifications'));
const ClaimExternalIdentity = React.lazy(() => import('../pages/ClaimExternalIdentity'));

export const DomainRoutes = () => {
  return (
    <Suspense fallback={<div className="p-4 text-center">Loading module...</div>}>
      <Routes>
        {/* Auth */}
        <Route path="/login" element={<Login />} />
        <Route path="/auth/callback" element={<OAuthCallback />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/dropbox-callback" element={<DropboxCallback />} />

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
        <Route path="/database-audit" element={<Navigate to="/admin/database-audit" replace />} />
        <Route path="/data-diagnostic" element={<Navigate to="/admin/data-diagnostic" replace />} />
        <Route path="/test-contributions" element={<Navigate to="/admin/test-contributions" replace />} />

        {/* Legacy user pages (used by header nav / profile capsule) */}
        <Route path="/capture" element={<Capture />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/profile/:userId" element={<Profile />} />
        <Route path="/capsule" element={<Capsule />} />
        <Route path="/library" element={<Library />} />
        <Route path="/auctions" element={<AuctionMarketplace />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/claim-identity" element={<ClaimExternalIdentity />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
};
