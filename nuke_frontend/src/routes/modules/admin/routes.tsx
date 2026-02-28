// src/routes/modules/admin/routes.tsx
import React, { Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import AdminShell from '../../../components/admin/AdminShell';
import { RequireAdmin } from '../../../components/auth/RequireAdmin';

// Lazy-load every admin page — only the visited page gets downloaded
const AdminHome = React.lazy(() => import('../../../pages/admin/AdminHome'));
const AdminDashboard = React.lazy(() => import('../../../pages/AdminDashboard'));
const AdminVerifications = React.lazy(() => import('../../../pages/AdminVerifications'));
const AdminMissionControl = React.lazy(() => import('../../../pages/AdminMissionControl'));
const BusinessIntelligence = React.lazy(() => import('../../../pages/BusinessIntelligence'));
const OwnershipVerificationDashboard = React.lazy(() => import('../../../components/admin/OwnershipVerificationDashboard'));
const MergeProposalsDashboard = React.lazy(() => import('../../../pages/MergeProposalsDashboard'));
const BulkPriceEditor = React.lazy(() => import('../../../pages/admin/BulkPriceEditor'));
const PriceCsvImport = React.lazy(() => import('../../../pages/admin/PriceCsvImport'));
const ShippingSettings = React.lazy(() => import('../../../pages/admin/ShippingSettings'));
const X402Settings = React.lazy(() => import('../../../pages/admin/X402Settings'));
const KSLScraper = React.lazy(() => import('../../../pages/admin/KSLScraper'));
const ScraperDashboard = React.lazy(() => import('../../../pages/admin/ScraperDashboard'));
const MemeLibraryAdmin = React.lazy(() => import('../../../pages/admin/MemeLibraryAdmin'));
const ScriptControlCenter = React.lazy(() => import('../../../pages/ScriptControlCenter'));
const ImageProcessingDashboard = React.lazy(() => import('../../../pages/ImageProcessingDashboard'));
const LiveImageAnalysisMonitor = React.lazy(() => import('../../../components/admin/LiveImageAnalysisMonitor'));
const BatchImageAnalysis = React.lazy(() => import('../../../pages/admin/BatchImageAnalysis'));
const ExtractionMonitor = React.lazy(() => import('../../../pages/admin/ExtractionMonitor'));
const ExtractionReview = React.lazy(() => import('../../../pages/ExtractionReview'));
const SystemStatus = React.lazy(() => import('../../../pages/SystemStatus'));
const CatalogBrowser = React.lazy(() => import('../../../pages/CatalogBrowser'));
const DatabaseAudit = React.lazy(() => import('../../../pages/DatabaseAudit'));
const DataDiagnostic = React.lazy(() => import('../../../pages/DataDiagnostic'));
const TestContributions = React.lazy(() => import('../../../pages/TestContributions'));
const AdminPendingVehicles = React.lazy(() => import('../../../pages/AdminPendingVehicles'));
const HoverCardDemo = React.lazy(() => import('../../../pages/admin/HoverCardDemo'));
const VehicleMakeLogosCatalog = React.lazy(() => import('../../../pages/admin/VehicleMakeLogosCatalog'));
const MarketDataTools = React.lazy(() => import('../../../pages/MarketDataTools'));
const BotTestDashboard = React.lazy(() => import('../../../pages/admin/BotTestDashboard'));
const AdminRalphBrief = React.lazy(() => import('../../../pages/admin/AdminRalphBrief'));
const NLQueryConsole = React.lazy(() => import('../../../pages/admin/NLQueryConsole'));
const AdminIdentityClaims = React.lazy(() => import('../../../pages/admin/AdminIdentityClaims'));
const InventoryAnalytics = React.lazy(() => import('../../../pages/admin/InventoryAnalytics'));
const AdminInbox = React.lazy(() => import('../../../pages/admin/AdminInbox'));
const AdminAgentInbox = React.lazy(() => import('../../../pages/admin/AdminAgentInbox'));
const ProxyBidOperations = React.lazy(() => import('../../../pages/admin/ProxyBidOperations'));
const UnifiedScraperDashboard = React.lazy(() => import('../../../pages/admin/UnifiedScraperDashboard'));
const DataQualityDashboard = React.lazy(() => import('../../../pages/admin/DataQualityDashboard'));
const TransfersDashboard = React.lazy(() => import('../../../pages/admin/TransfersDashboard'));

const LazyFallback = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh', color: 'var(--text-disabled)', fontSize: '12px' }}>
    loading...
  </div>
);

const AdminModuleRoutes = () => {
  return (
    <Suspense fallback={<LazyFallback />}>
      <Routes>
        {/* Route-level admin guard — stops chunk loading for non-admins.
            AdminShell also enforces this at the component level. */}
        <Route element={<RequireAdmin />}>
        <Route element={<AdminShell />}>
          <Route index element={<AdminHome />} />

          {/* Core */}
          <Route path="reviews" element={<AdminDashboard />} />
          <Route path="legacy-dashboard" element={<AdminDashboard />} />
          <Route path="verifications" element={<AdminVerifications />} />
          <Route path="ownership-verifications" element={<OwnershipVerificationDashboard />} />
          <Route path="merge-proposals" element={<MergeProposalsDashboard />} />
          <Route path="pending-vehicles" element={<AdminPendingVehicles />} />
          <Route path="identity-claims" element={<AdminIdentityClaims />} />

          {/* Inbox */}
          <Route path="inbox" element={<AdminInbox />} />
          <Route path="agent-inbox" element={<AdminAgentInbox />} />

          {/* Ops */}
          <Route path="ralph" element={<AdminRalphBrief />} />
          <Route path="mission-control" element={<AdminMissionControl />} />
          <Route path="scripts" element={<ScriptControlCenter />} />
          <Route path="image-processing" element={<ImageProcessingDashboard />} />
          <Route path="live-analysis" element={<LiveImageAnalysisMonitor />} />
          <Route path="batch-analysis" element={<BatchImageAnalysis />} />
          <Route path="extraction-monitor" element={<ExtractionMonitor />} />
          <Route path="extraction-review" element={<ExtractionReview />} />
          <Route path="status" element={<SystemStatus />} />

          {/* Tools */}
          <Route path="inventory-analytics" element={<InventoryAnalytics />} />
          <Route path="analytics" element={<InventoryAnalytics />} />
          <Route path="business-intelligence" element={<BusinessIntelligence />} />
          <Route path="bi" element={<BusinessIntelligence />} />
          <Route path="price-editor" element={<BulkPriceEditor />} />
          <Route path="price-import" element={<PriceCsvImport />} />
          <Route path="shipping-settings" element={<ShippingSettings />} />
          <Route path="x402-settings" element={<X402Settings />} />
          <Route path="ksl-scraper" element={<KSLScraper />} />
          <Route path="scrapers" element={<ScraperDashboard />} />
          <Route path="meme-library" element={<MemeLibraryAdmin />} />
          <Route path="catalog" element={<CatalogBrowser />} />
          <Route path="make-logos-catalog" element={<VehicleMakeLogosCatalog />} />
          <Route path="market-data-tools" element={<MarketDataTools />} />
          <Route path="database-audit" element={<DatabaseAudit />} />
          <Route path="data-diagnostic" element={<DataDiagnostic />} />
          <Route path="test-contributions" element={<TestContributions />} />
          <Route path="query-console" element={<NLQueryConsole />} />
          <Route path="hover-demo" element={<HoverCardDemo />} />
          <Route path="bot-testing" element={<BotTestDashboard />} />
          <Route path="proxy-bids" element={<ProxyBidOperations />} />
          <Route path="unified-scrapers" element={<UnifiedScraperDashboard />} />
          <Route path="data-quality" element={<DataQualityDashboard />} />
          <Route path="transfers" element={<TransfersDashboard />} />
        </Route>
        </Route> {/* RequireAdmin */}
      </Routes>
    </Suspense>
  );
};

export default AdminModuleRoutes;
