// src/routes/modules/organization/routes.tsx
import React, { Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';

const Organizations = React.lazy(() => import('../../../pages/Organizations'));
const OrganizationProfile = React.lazy(() => import('../../../pages/OrganizationProfile'));
const CreateOrganization = React.lazy(() => import('../../../pages/CreateOrganization'));
const Dashboard = React.lazy(() => import('../../../pages/Dashboard'));

const LazyFallback = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh', color: '#888', fontSize: '9pt' }}>
    loading...
  </div>
);

const OrganizationModuleRoutes = () => {
  return (
    <Suspense fallback={<LazyFallback />}>
      <Routes>
        <Route path="/" element={<Organizations />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/create" element={<CreateOrganization />} />
        <Route path="/:orgId" element={<OrganizationProfile />} />
      </Routes>
    </Suspense>
  );
};

export default OrganizationModuleRoutes;
