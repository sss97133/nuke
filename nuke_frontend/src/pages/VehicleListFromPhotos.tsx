/**
 * Keep saved photo-entry links useful through the active photo library.
 * The retired legacy vehicle list is intentionally not reactivated here.
 */
import React from 'react';
import { Navigate } from 'react-router-dom';

export default function VehicleListFromPhotos() {
  return <Navigate to="/photo-library" replace />;
}
