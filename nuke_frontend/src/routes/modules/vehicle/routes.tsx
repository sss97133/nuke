// src/routes/modules/vehicle/routes.tsx
import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from '../../../components/auth/ProtectedRoute';

const VehicleProfile = React.lazy(() => import('../../../pages/VehicleProfile'));
const VehiclesDashboard = React.lazy(() => import('../../../pages/VehiclesDashboard'));
const AddVehicle = React.lazy(() => import('../../../pages/add-vehicle/AddVehicle'));
const EditVehicle = React.lazy(() => import('../../../pages/EditVehicle'));
const VehicleMailbox = React.lazy(() => import('../../../components/VehicleMailbox/VehicleMailbox'));
const VehicleJobs = React.lazy(() => import('../../../pages/VehicleJobs'));
const WiringPlan = React.lazy(() => import('../../../pages/WiringPlan'));
const DayPage = React.lazy(() => import('../../../pages/vehicle-profile/DayPage'));
const ObservationPage = React.lazy(() => import('../../../pages/vehicle-profile/ObservationPage'));
const InventoryPage = React.lazy(() => import('../../../pages/vehicle-profile/InventoryPage'));
const VendorPage = React.lazy(() => import('../../../pages/vehicle-profile/VendorPage'));
const PartPage = React.lazy(() => import('../../../pages/vehicle-profile/PartPage'));
const ImagePage = React.lazy(() => import('../../../pages/vehicle-profile/ImagePage'));
const VendorsPage = React.lazy(() => import('../../../pages/vehicle-profile/VendorsPage'));
const LifecyclePage = React.lazy(() => import('../../../pages/vehicle-profile/LifecyclePage'));
const TablePage = React.lazy(() => import('../../../pages/vehicle-profile/TablePage'));
const AnalysisStreamPage = React.lazy(() => import('../../../pages/vehicle-profile/AnalysisStreamPage'));
const EyeDossierPage = React.lazy(() => import('../../../pages/vehicle-profile/EyeDossierPage'));

const VehiclePortfolio = React.lazy(() => import('../../../pages/VehiclePortfolio'));
const VehicleListFromPhotos = React.lazy(() => import('../../../pages/VehicleListFromPhotos'));

const VehicleModuleRoutes = () => {
  return (
    <Suspense fallback={<div style={{ height: '100vh', background: 'var(--bg)' }} />}>
      <Routes>
        {/* Public: browse vehicle list + individual profiles */}
        <Route path="/" element={<VehiclesDashboard />} />
        <Route path="/list" element={<VehiclesDashboard />} />
        <Route path="/list/from-photos" element={<VehicleListFromPhotos />} />
        <Route path="/:vehicleId" element={<VehicleProfile />} />
        <Route path="/:vehicleId/wiring" element={<WiringPlan />} />
        <Route path="/:vehicleId/day/:date" element={<DayPage />} />
        <Route path="/:vehicleId/observation/:obsId" element={<ObservationPage />} />
        <Route path="/:vehicleId/inventory" element={<InventoryPage />} />
        <Route path="/:vehicleId/vendor/:vendorSlug" element={<VendorPage />} />
        <Route path="/:vehicleId/part/:partNumber" element={<PartPage />} />
        <Route path="/:vehicleId/image/:imageId" element={<ImagePage />} />
        <Route path="/:vehicleId/vendors" element={<VendorsPage />} />
        <Route path="/:vehicleId/lifecycle" element={<LifecyclePage />} />
        <Route path="/:vehicleId/table" element={<TablePage />} />
        <Route path="/:vehicleId/analysis-stream" element={<AnalysisStreamPage />} />
        <Route path="/:vehicleId/dossier" element={<EyeDossierPage />} />

        {/* Protected: write / owner-only actions */}
        <Route element={<ProtectedRoute />}>
          <Route path="/add" element={<AddVehicle />} />
          <Route path="/:vehicleId/edit" element={<EditVehicle />} />
          <Route path="/:vehicleId/mailbox" element={<VehicleMailbox />} />
          {/* InvestorDealPortal removed — page deleted */}
          <Route path="/:vehicleId/portfolio" element={<VehiclePortfolio />} />
          <Route path="/:vehicleId/work" element={<VehicleJobs />} />
        </Route>

        {/* Legacy: keep /jobs as alias but steer users to mailbox-first workflow */}
        <Route path="/:vehicleId/jobs" element={<Navigate to="../mailbox" replace />} />
      </Routes>
    </Suspense>
  );
};

export default VehicleModuleRoutes;
