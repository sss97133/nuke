// src/routes/modules/dealer/routes.tsx
import React from 'react';
import { Routes, Route } from 'react-router-dom';
import DealerDropboxImport from '../../../pages/DealerDropboxImport';
import DealerBulkEditor from '../../../pages/DealerBulkEditor';
import DealerAIAssistant from '../../../pages/DealerAIAssistant';

const DealerModuleRoutes = () => {
  return (
    <Routes>
      <Route path="/:orgId/dropbox-import" element={<DealerDropboxImport />} />
      <Route path="/:orgId/bulk-editor" element={<DealerBulkEditor />} />
      <Route path="/:orgId/ai-assistant" element={<DealerAIAssistant />} />
    </Routes>
  );
};

export default DealerModuleRoutes;

