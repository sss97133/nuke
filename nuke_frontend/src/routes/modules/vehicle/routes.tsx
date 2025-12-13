// src/routes/modules/vehicle/routes.tsx
import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

// Lazy load VehicleProfile to defer module initialization and avoid TDZ
const VehicleProfile = React.lazy(() => import('../../../pages/VehicleProfile'));
const Vehicles = React.lazy(() => import('../../../pages/Vehicles'));
const AddVehicle = React.lazy(() => import('../../../pages/add-vehicle/AddVehicle'));
const EditVehicle = React.lazy(() => import('../../../pages/EditVehicle'));
const VehicleMailbox = React.lazy(() => import('../../../components/VehicleMailbox/VehicleMailbox'));
const VehicleJobs = React.lazy(() => import('../../../pages/VehicleJobs'));
const WiringPlan = React.lazy(() => import('../../../pages/WiringPlan'));

const VehicleModuleRoutes = () => {
  return (
    <Suspense fallback={<div style={{ padding: '20px' }}>Loading...</div>}>
      <Routes>
        <Route path="/" element={<Vehicles />} />
        <Route path="/list" element={<Vehicles />} />
        <Route path="/add" element={<AddVehicle />} />
        <Route path="/:vehicleId" element={<VehicleProfile />} />
        <Route path="/:vehicleId/edit" element={<EditVehicle />} />
        <Route path="/:vehicleId/mailbox" element={<VehicleMailbox />} />
        <Route path="/:vehicleId/wiring" element={<WiringPlan />} />
        {/* Legacy: keep /jobs as alias but steer users to mailbox-first workflow */}
        <Route path="/:vehicleId/jobs" element={<Navigate to="../mailbox" replace />} />
        {/* Work items page (legacy utility) */}
        <Route path="/:vehicleId/work" element={<VehicleJobs />} />
      </Routes>
    </Suspense>
  );
};

export default VehicleModuleRoutes;

