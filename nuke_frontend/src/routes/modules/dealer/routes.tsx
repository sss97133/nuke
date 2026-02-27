// src/routes/modules/dealer/routes.tsx
import React, { Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from '../../../components/auth/ProtectedRoute';

const DealerDropboxImport = React.lazy(() => import('../../../pages/DealerDropboxImport'));
const DealerBulkEditor = React.lazy(() => import('../../../pages/DealerBulkEditor'));
const DealerAIAssistant = React.lazy(() => import('../../../pages/DealerAIAssistant'));

const LazyFallback = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh', color: '#888', fontSize: '12px' }}>
    loading...
  </div>
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
