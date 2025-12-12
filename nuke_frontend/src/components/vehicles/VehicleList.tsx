import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import VehicleThumbnail from '../VehicleThumbnail';
import { useVehiclesWithImages } from '../../hooks/useVehicleImages';
import type { Vehicle } from '../../types';

const VehicleList = () => {
  const { vehicles, loading, error } = useVehiclesWithImages();

  if (loading) {
    return <div className="loading-container">Loading vehicles...</div>;
  }

  if (error) {
    return <div className="alert alert-error">{error}</div>;
  }

  if (vehicles.length === 0) {
    return (
      <div className="text-center p-8">
        <p className="mb-4">No vehicles found.</p>
        <Link
          to="/vehicle/add"
          className="button button-primary"
        >
          Add Your First Vehicle
        </Link>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="flex justify-between items-center section">
        <h1 className="page-title">Your Vehicles</h1>
        <Link
          to="/vehicle/add"
          className="button button-primary"
        >
          Add Vehicle
        </Link>
      </div>
      
      <div className="vehicle-grid">
        {vehicles.map((vehicle) => (
          <Link
            key={vehicle.id}
            to={`/vehicle/${vehicle.id}`}
            className="vehicle-thumbnail-link"
          >
            <div className="relative">
              {/* Vehicle thumbnail using new pipeline */}
              <div className="w-full h-48 flex items-center justify-center">
                <VehicleThumbnail 
                  vehicleId={vehicle.id}
                  vehicleName={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                  size="large"
                  showPlaceholder={true}
                />
              </div>
              
              {/* Status badge */}
              <div className={`absolute top-2 right-2 px-2 py-1 text-xs font-bold rounded ${
                vehicle.status === 'active' ? 'bg-green-500 text-white' : 
                vehicle.status === 'pending' ? 'bg-yellow-500 text-white' : 
                vehicle.status === 'archived' ? 'bg-gray-500 text-white' : 
                'bg-red-500 text-white'
              }`}>
                {vehicle.status.toUpperCase()}
              </div>
              
              {/* Verification badge if verified */}
              {vehicle.verified && (
                <div className="absolute top-2 left-2 bg-blue-500 text-white px-2 py-1 text-xs font-bold rounded">
                  VERIFIED
                </div>
              )}
            </div>
            
            <div className="p-4">
              <h2 className="text-xl font-bold mb-2">
                {vehicle.year} {vehicle.make} {vehicle.model}
              </h2>
              
              <div className="text-sm text-gray-600 mb-4">
                {vehicle.vin && (
                  <p className="mb-1">
                    <span className="font-semibold">VIN:</span> {vehicle.vin}
                  </p>
                )}
                
                {vehicle.mileage && (
                  <p className="mb-1">
                    <span className="font-semibold">Mileage:</span> {vehicle.mileage.toLocaleString()} miles
                  </p>
                )}
                
                {vehicle.color && (
                  <p className="mb-1">
                    <span className="font-semibold">Color:</span> {vehicle.color}
                  </p>
                )}
              </div>
              
              {/* Timeline events summary */}
              <div className="mt-4 flex items-center text-sm text-gray-500">
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {vehicle.timeline_events ? (
                  <span>{vehicle.timeline_events.length} History Events</span>
                ) : (
                  <span>No History</span>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
};

export default VehicleList;
