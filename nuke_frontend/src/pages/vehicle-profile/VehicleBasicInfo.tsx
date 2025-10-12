import React from 'react';
import { useNavigate } from 'react-router-dom';
import VehicleDataQualityRating from '../../components/VehicleDataQualityRating';
import VehicleInteractionPanel from '../../components/vehicle/VehicleInteractionPanel';
import VehicleOwnershipPanel from '../../components/ownership/VehicleOwnershipPanel';
import VehicleBuildSystem from '../../components/vehicle/VehicleBuildSystem';
import type { VehicleBasicInfoProps } from './types';

const VehicleBasicInfo: React.FC<VehicleBasicInfoProps> = ({
  vehicle,
  session,
  permissions,
  onDataPointClick,
  onEditClick
}) => {
  const navigate = useNavigate();
  const { isVerifiedOwner, hasContributorAccess, contributorRole } = permissions;

  const renderVehicleDetails = () => {
    const v: any = vehicle;
    const extra: Array<{ label: string; key: string; formatter?: (val: any) => string }> = [
      { label: 'Fuel Type', key: 'fuel_type' },
      { label: 'Drivetrain', key: 'drivetrain' },
      { label: 'Body Style', key: 'body_style' },
      { label: 'Doors', key: 'doors' },
      { label: 'Seats', key: 'seats' },
      { label: 'Engine Size', key: 'engine_size' },
      { label: 'Horsepower', key: 'horsepower' },
      { label: 'Torque', key: 'torque' },
      { label: 'Weight', key: 'weight_lbs', formatter: (x) => `${Number(x).toLocaleString()} lbs` },
      { label: 'Wheelbase', key: 'wheelbase_inches', formatter: (x) => `${x}"` },
      { label: 'Length', key: 'length_inches', formatter: (x) => `${x}"` },
      { label: 'Width', key: 'width_inches', formatter: (x) => `${x}"` },
      { label: 'Height', key: 'height_inches', formatter: (x) => `${x}"` },
      { label: 'MPG (City)', key: 'mpg_city' },
      { label: 'MPG (Highway)', key: 'mpg_highway' },
      { label: 'MPG (Combined)', key: 'mpg_combined' },
    ];

    return extra
      .filter(({ key }) => v && typeof v[key] !== 'undefined' && v[key] !== null && v[key] !== '')
      .map(({ label, key, formatter }) => (
        <div key={key} className="vehicle-detail">
          <span>{label}</span>
          <span
            className="commentable"
            onClick={(e) => onDataPointClick(e, key, String(v[key]), label)}
          >
            {formatter ? formatter(v[key]) : String(v[key])}
          </span>
        </div>
      ));
  };

  return (
    <div style={{
      background: '#f5f5f5',
      border: '1px solid #bdbdbd',
      padding: '0px',
      margin: '16px',
      fontFamily: 'Arial, sans-serif'
    }}>
      <div style={{
        background: '#e0e0e0',
        padding: '8px 12px',
        borderBottom: '1px solid #bdbdbd',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <span style={{ fontSize: '8pt', fontWeight: 'bold' }}>Basic Information</span>
        {isVerifiedOwner && (
          <button
            onClick={() => navigate(`/vehicle/${vehicle.id}/edit`)}
            style={{
              background: '#424242',
              color: 'white',
              border: '1px solid #bdbdbd',
              borderRadius: '0px',
              padding: '4px 8px',
              fontSize: '8pt',
              cursor: 'pointer'
            }}
          >
            Edit
          </button>
        )}
      </div>

      {/* Data Quality Rating */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #bdbdbd' }}>
        <VehicleDataQualityRating vehicleId={vehicle.id} />
      </div>

      {/* Vehicle Details */}
      <div style={{ padding: '12px' }}>
        <div>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '4px 0',
            borderBottom: '1px solid #e0e0e0',
            fontSize: '8pt'
          }}>
            <span>Year</span>
            <span
              style={{ cursor: 'pointer', textDecoration: 'underline' }}
              onClick={(e) => onDataPointClick(e, 'year', vehicle.year?.toString() || '', 'Year')}
            >
              {vehicle.year}
            </span>
          </div>
          <div className="vehicle-detail">
            <span>Make</span>
            <span
              className="commentable"
              onClick={(e) => onDataPointClick(e, 'make', vehicle.make, 'Make')}
            >
              {vehicle.make}
            </span>
          </div>
          <div className="vehicle-detail">
            <span>Model</span>
            <span
              className="commentable"
              onClick={(e) => onDataPointClick(e, 'model', vehicle.model, 'Model')}
            >
              {vehicle.model}
            </span>
          </div>
          <div className="vehicle-detail">
            <span>VIN</span>
            <span
              className="commentable"
              onClick={(e) => onDataPointClick(e, 'vin', vehicle.vin || '', 'VIN')}
            >
              {vehicle.vin || 'Not provided'}
            </span>
          </div>
          <div className="vehicle-detail">
            <span>Color</span>
            <span
              className="commentable"
              onClick={(e) => onDataPointClick(e, 'color', vehicle.color || '', 'Color')}
            >
              {vehicle.color || 'Not specified'}
            </span>
          </div>
          <div className="vehicle-detail">
            <span>Mileage</span>
            <span
              className="commentable"
              onClick={(e) => onDataPointClick(e, 'mileage', vehicle.mileage?.toString() || '', 'Mileage')}
            >
              {vehicle.mileage ? `${vehicle.mileage.toLocaleString()} miles` : 'Not specified'}
            </span>
          </div>
          {vehicle.trim && (
            <div className="vehicle-detail">
              <span>Trim</span>
              <span
                className="commentable"
                onClick={(e) => onDataPointClick(e, 'trim', vehicle.trim || '', 'Trim')}
              >
                {vehicle.trim}
              </span>
            </div>
          )}
          {vehicle.engine && (
            <div className="vehicle-detail">
              <span>Engine</span>
              <span
                className="commentable"
                onClick={(e) => onDataPointClick(e, 'engine', vehicle.engine || '', 'Engine')}
              >
                {vehicle.engine}
              </span>
            </div>
          )}
          {vehicle.transmission && (
            <div className="vehicle-detail">
              <span>Transmission</span>
              <span
                className="commentable"
                onClick={(e) => onDataPointClick(e, 'transmission', vehicle.transmission || '', 'Transmission')}
              >
                {vehicle.transmission}
              </span>
            </div>
          )}
          {/* Additional details */}
          {renderVehicleDetails()}
        </div>
      </div>

      {/* Vehicle Interactions */}
      <div className="card-body" style={{ borderTop: '1px solid #e5e7eb' }}>
        <VehicleInteractionPanel
          vehicleId={vehicle.id}
          isOwner={isVerifiedOwner || contributorRole === 'owner' || contributorRole === 'restorer' || contributorRole === 'previous_owner'}
          currentUser={session?.user}
          vehicle={{
            id: vehicle.id,
            make: vehicle.make,
            model: vehicle.model,
            year: vehicle.year,
            user_id: vehicle.uploaded_by || ''
          }}
          onInteractionUpdate={onEditClick}
        />

        {/* Show contributor role if applicable */}
        {contributorRole && (
          <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded">
            <div className="text-sm font-medium text-blue-900">
              Your Role: {contributorRole.charAt(0).toUpperCase() + contributorRole.slice(1).replace('_', ' ')}
            </div>
            {contributorRole === 'restorer' && (
              <div className="text-xs text-blue-700 mt-1">
                You have contributed to the restoration of this vehicle
              </div>
            )}
          </div>
        )}
      </div>

      {/* Ownership Panel */}
      <div
        className="card-body"
        style={{
          borderTop: '1px solid #e5e7eb',
          padding: '12px',
          marginBottom: '0'
        }}
      >
        <VehicleOwnershipPanel
          vehicle={vehicle}
          session={session}
          isOwner={isVerifiedOwner}
          hasContributorAccess={hasContributorAccess}
          contributorRole={contributorRole}
          responsibleName={undefined}
        />
      </div>

      {/* Build System */}
      <div
        className="card-body"
        style={{
          borderTop: '1px solid #e5e7eb',
          padding: '12px',
          marginTop: '0'
        }}
      >
        <VehicleBuildSystem
          vehicleId={vehicle.id}
          isOwner={isVerifiedOwner || permissions.isDbUploader || hasContributorAccess}
        />
      </div>
    </div>
  );
};

export default VehicleBasicInfo;