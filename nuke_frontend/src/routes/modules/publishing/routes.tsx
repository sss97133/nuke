// src/routes/modules/publishing/routes.tsx
import React, { Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from '../../../components/auth/ProtectedRoute';

const PublishingDashboard = React.lazy(() => import('../../../pages/publishing/PublishingDashboard'));
const PublicationProfile = React.lazy(() => import('../../../pages/publishing/PublicationProfile'));
const IssueProfile = React.lazy(() => import('../../../pages/publishing/IssueProfile'));
const PersonProfile = React.lazy(() => import('../../../pages/publishing/PersonProfile'));
const PeopleDirectory = React.lazy(() => import('../../../pages/publishing/PeopleDirectory'));

const PublishingModuleRoutes = () => {
  return (
    <Suspense fallback={<div style={{ height: '100vh', background: 'var(--bg)' }} />}>
      <Routes>
        <Route path="/" element={<PublishingDashboard />} />
        <Route path="/:slug" element={<PublicationProfile />} />
        <Route path="/:slug/issue/:issueNumber" element={<IssueProfile />} />
        <Route path="/people" element={<PeopleDirectory />} />
        <Route path="/people/:personId" element={<PersonProfile />} />
      </Routes>
    </Suspense>
  );
};

export default PublishingModuleRoutes;
