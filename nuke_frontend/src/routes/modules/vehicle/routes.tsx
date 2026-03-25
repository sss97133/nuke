// src/routes/modules/vehicle/routes.tsx
import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from '../../../components/auth/ProtectedRoute';

const VehicleProfile = React.lazy(() => import('../../../pages/VehicleProfile'));
const VehiclesDashboard = React.lazy(() => import('../../../pages/VehiclesDashboard'));
const VehiclesLegacy = React.lazy(() => import('../../../pages/Vehicles'));
const AddVehicle = React.lazy(() => import('../../../pages/add-vehicle/AddVehicle'));
const EditVehicle = React.lazy(() => import('../../../pages/EditVehicle'));
const VehicleMailbox = React.lazy(() => import('../../../components/VehicleMailbox/VehicleMailbox'));
const VehicleJobs = React.lazy(() => import('../../../pages/VehicleJobs'));
const WiringPlan = React.lazy(() => import('../../../pages/WiringPlan'));

const VehiclePortfolio = React.lazy(() => import('../../../pages/VehiclePortfolio'));
const VehicleListFromPhotos = React.lazy(() => import('../../../pages/VehicleListFromPhotos'));

const VehicleModuleRoutes = () => {
  return (
    <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh', color: 'var(--text-disabled)', fontSize: '12px' }}>loading...</div>}>
      <Routes>
        {/* Public: browse vehicle list + individual profiles */}
        <Route path="/" element={<VehiclesDashboard />} />
        <Route path="/list" element={<VehiclesDashboard />} />
        <Route path="/list/legacy" element={<VehiclesLegacy />} />
        <Route path="/list/from-photos" element={<VehicleListFromPhotos />} />
        <Route path="/:vehicleId" element={<VehicleProfile />} />

        {/* Protected: write / owner-only actions */}
        <Route element={<ProtectedRoute />}>
          <Route path="/add" element={<AddVehicle />} />
          <Route path="/:vehicleId/edit" element={<EditVehicle />} />
          <Route path="/:vehicleId/mailbox" element={<VehicleMailbox />} />
          {/* InvestorDealPortal removed — page deleted */}
          <Route path="/:vehicleId/portfolio" element={<VehiclePortfolio />} />
          <Route path="/:vehicleId/wiring" element={<WiringPlan />} />
          <Route path="/:vehicleId/work" element={<VehicleJobs />} />
        </Route>

        {/* Legacy: keep /jobs as alias but steer users to mailbox-first workflow */}
        <Route path="/:vehicleId/jobs" element={<Navigate to="../mailbox" replace />} />
      </Routes>
    </Suspense>
  );
};

export default VehicleModuleRoutes;
