// src/routes/modules/dealer/routes.tsx
import React, { Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from '../../../components/auth/ProtectedRoute';

const DealerDropboxImport = React.lazy(() => import('../../../pages/DealerDropboxImport'));
const DealerBulkEditor = React.lazy(() => import('../../../pages/DealerBulkEditor'));
const DealerAIAssistant = React.lazy(() => import('../../../pages/DealerAIAssistant'));

const LazyFallback = () => (
  <div style={{ height: '100vh', background: 'var(--bg)' }} />
);

const DealerModuleRoutes = () => {
  return (
    <Suspense fallback={<LazyFallback />}>
      <Routes>
        {/* All dealer routes require authentication */}
        <Route element={<ProtectedRoute />}>
          <Route path="/:orgId/dropbox-import" element={<DealerDropboxImport />} />
          <Route path="/:orgId/bulk-editor" element={<DealerBulkEditor />} />
          <Route path="/:orgId/ai-assistant" element={<DealerAIAssistant />} />
        </Route>
      </Routes>
    </Suspense>
  );
};

export default DealerModuleRoutes;
