// src/routes/modules/admin/routes.tsx
import React from 'react';
import { Routes, Route } from 'react-router-dom';
import AdminDashboard from '../../../pages/AdminDashboard';
import AdminVerifications from '../../../pages/AdminVerifications';
import OwnershipVerificationDashboard from '../../../components/admin/OwnershipVerificationDashboard';
import MergeProposalsDashboard from '../../../pages/MergeProposalsDashboard';
import BulkPriceEditor from '../../../pages/admin/BulkPriceEditor';
import PriceCsvImport from '../../../pages/admin/PriceCsvImport';
import ShippingSettings from '../../../pages/admin/ShippingSettings';
import X402Settings from '../../../pages/admin/X402Settings';

const AdminModuleRoutes = () => {
  return (
    <Routes>
      <Route path="/" element={<AdminDashboard />} />
      <Route path="/verifications" element={<AdminVerifications />} />
      <Route path="/ownership-verifications" element={<OwnershipVerificationDashboard />} />
      <Route path="/merge-proposals" element={<MergeProposalsDashboard />} />
      <Route path="/price-editor" element={<BulkPriceEditor />} />
      <Route path="/price-import" element={<PriceCsvImport />} />
      <Route path="/shipping-settings" element={<ShippingSettings />} />
      <Route path="/x402-settings" element={<X402Settings />} />
    </Routes>
  );
};

export default AdminModuleRoutes;

