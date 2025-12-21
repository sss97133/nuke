// src/routes/modules/admin/routes.tsx
import React from 'react';
import { Routes, Route } from 'react-router-dom';
import AdminShell from '../../../components/admin/AdminShell';
import AdminHome from '../../../pages/admin/AdminHome';
import AdminDashboard from '../../../pages/AdminDashboard';
import AdminVerifications from '../../../pages/AdminVerifications';
import AdminMissionControl from '../../../pages/AdminMissionControl';
import BusinessIntelligence from '../../../pages/BusinessIntelligence';
import OwnershipVerificationDashboard from '../../../components/admin/OwnershipVerificationDashboard';
import MergeProposalsDashboard from '../../../pages/MergeProposalsDashboard';
import BulkPriceEditor from '../../../pages/admin/BulkPriceEditor';
import PriceCsvImport from '../../../pages/admin/PriceCsvImport';
import ShippingSettings from '../../../pages/admin/ShippingSettings';
import X402Settings from '../../../pages/admin/X402Settings';
import KSLScraper from '../../../pages/admin/KSLScraper';
import MemeLibraryAdmin from '../../../pages/admin/MemeLibraryAdmin';
import ScriptControlCenter from '../../../pages/ScriptControlCenter';
import ImageProcessingDashboard from '../../../pages/ImageProcessingDashboard';
import LiveImageAnalysisMonitor from '../../../components/admin/LiveImageAnalysisMonitor';
import BatchImageAnalysis from '../../../pages/admin/BatchImageAnalysis';
import ExtractionMonitor from '../../../pages/admin/ExtractionMonitor';
import ExtractionReview from '../../../pages/ExtractionReview';
import SystemStatus from '../../../pages/SystemStatus';
import CatalogBrowser from '../../../pages/CatalogBrowser';
import DatabaseAudit from '../../../pages/DatabaseAudit';
import DataDiagnostic from '../../../pages/DataDiagnostic';
import TestContributions from '../../../pages/TestContributions';
import AdminPendingVehicles from '../../../pages/AdminPendingVehicles';
import HoverCardDemo from '../../../pages/admin/HoverCardDemo';
import VehicleMakeLogosCatalog from '../../../pages/admin/VehicleMakeLogosCatalog';

const AdminModuleRoutes = () => {
  return (
    <Routes>
      <Route element={<AdminShell />}>
        <Route index element={<AdminHome />} />

        {/* Core */}
        <Route path="reviews" element={<AdminDashboard />} />
        <Route path="legacy-dashboard" element={<AdminDashboard />} />
        <Route path="verifications" element={<AdminVerifications />} />
        <Route path="ownership-verifications" element={<OwnershipVerificationDashboard />} />
        <Route path="merge-proposals" element={<MergeProposalsDashboard />} />
        <Route path="pending-vehicles" element={<AdminPendingVehicles />} />

        {/* Ops */}
        <Route path="mission-control" element={<AdminMissionControl />} />
        <Route path="scripts" element={<ScriptControlCenter />} />
        <Route path="image-processing" element={<ImageProcessingDashboard />} />
        <Route path="live-analysis" element={<LiveImageAnalysisMonitor />} />
        <Route path="batch-analysis" element={<BatchImageAnalysis />} />
        <Route path="extraction-monitor" element={<ExtractionMonitor />} />
        <Route path="extraction-review" element={<ExtractionReview />} />
        <Route path="status" element={<SystemStatus />} />

        {/* Tools */}
        <Route path="business-intelligence" element={<BusinessIntelligence />} />
        <Route path="bi" element={<BusinessIntelligence />} />
        <Route path="price-editor" element={<BulkPriceEditor />} />
        <Route path="price-import" element={<PriceCsvImport />} />
        <Route path="shipping-settings" element={<ShippingSettings />} />
        <Route path="x402-settings" element={<X402Settings />} />
        <Route path="ksl-scraper" element={<KSLScraper />} />
        <Route path="meme-library" element={<MemeLibraryAdmin />} />
        <Route path="catalog" element={<CatalogBrowser />} />
        <Route path="make-logos-catalog" element={<VehicleMakeLogosCatalog />} />
        <Route path="database-audit" element={<DatabaseAudit />} />
        <Route path="data-diagnostic" element={<DataDiagnostic />} />
        <Route path="test-contributions" element={<TestContributions />} />
        <Route path="hover-demo" element={<HoverCardDemo />} />
      </Route>
    </Routes>
  );
};

export default AdminModuleRoutes;

