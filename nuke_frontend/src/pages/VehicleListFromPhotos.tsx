/**
 * Redirect to Legacy vehicle list with "From my photos" tab.
 * Uses existing Vehicles.tsx (Legacy) data and UI; no duplicate query or page.
 */
import React from 'react';
import { Navigate } from 'react-router-dom';

export default function VehicleListFromPhotos() {
  return <Navigate to="/vehicle/list/legacy?tab=from_photos" replace />;
}
