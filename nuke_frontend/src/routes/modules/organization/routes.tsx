// src/routes/modules/organization/routes.tsx
import React, { Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from '../../../components/auth/ProtectedRoute';

const Organizations = React.lazy(() => import('../../../pages/Organizations'));
const OrganizationProfile = React.lazy(() => import('../../../pages/OrganizationProfile'));
const CreateOrganization = React.lazy(() => import('../../../pages/CreateOrganization'));
const Dashboard = React.lazy(() => import('../../../pages/Dashboard'));

const LazyFallback = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh', color: 'var(--text-disabled)', fontSize: '12px' }}>
    loading...
  </div>
);

const OrganizationModuleRoutes = () => {
  return (
    <Suspense fallback={<LazyFallback />}>
      <Routes>
        {/* Public: browse orgs + view org profiles */}
        <Route path="/" element={<Organizations />} />
        <Route path="/:orgId" element={<OrganizationProfile />} />

        {/* Protected: user-specific org actions */}
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/create" element={<CreateOrganization />} />
        </Route>
      </Routes>
    </Suspense>
  );
};

export default OrganizationModuleRoutes;
