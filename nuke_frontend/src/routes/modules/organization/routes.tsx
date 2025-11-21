// src/routes/modules/organization/routes.tsx
import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Organizations from '../../../pages/Organizations';
import OrganizationProfile from '../../../pages/OrganizationProfile';
import CreateOrganization from '../../../pages/CreateOrganization';
import Dashboard from '../../../pages/Dashboard';

const OrganizationModuleRoutes = () => {
  return (
    <Routes>
      <Route path="/" element={<Organizations />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/create" element={<CreateOrganization />} />
      <Route path="/:orgId" element={<OrganizationProfile />} />
    </Routes>
  );
};

export default OrganizationModuleRoutes;

