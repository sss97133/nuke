// src/routes/modules/dealer/routes.tsx
import React, { Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';

const DealerDropboxImport = React.lazy(() => import('../../../pages/DealerDropboxImport'));
const DealerBulkEditor = React.lazy(() => import('../../../pages/DealerBulkEditor'));
const DealerAIAssistant = React.lazy(() => import('../../../pages/DealerAIAssistant'));

const LazyFallback = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh', color: '#888', fontSize: '9pt' }}>
    loading...
  </div>
);

const DealerModuleRoutes = () => {
  return (
    <Suspense fallback={<LazyFallback />}>
      <Routes>
        <Route path="/:orgId/dropbox-import" element={<DealerDropboxImport />} />
        <Route path="/:orgId/bulk-editor" element={<DealerBulkEditor />} />
        <Route path="/:orgId/ai-assistant" element={<DealerAIAssistant />} />
      </Routes>
    </Suspense>
  );
};

export default DealerModuleRoutes;
