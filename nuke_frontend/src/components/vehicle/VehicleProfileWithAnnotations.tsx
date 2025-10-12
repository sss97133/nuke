import React from 'react';
import type { AnnotatedField } from './index';
import type { useVehicleAnnotations } from '../../hooks/useVehicleAnnotations';
import type { FieldAnnotation } from '../../types/dataSource';
import './VehicleProfileWithAnnotations.css';

interface Vehicle {
  id: string;
  year: number;
  make: string;
  model: string;
  vin: string | null;
  color: string | null;
  mileage: number | null;
  engine_size?: string | null;
  transmission?: string | null;
  body_style?: string | null;
  doors?: number | null;
  seats?: number | null;
  fuel_type?: string | null;
}

interface VehicleProfileWithAnnotationsProps {
  vehicle: Vehicle;
}

const VehicleProfileWithAnnotations: React.FC<VehicleProfileWithAnnotationsProps> = ({ vehicle }) => {
  const fieldNames = [
    'make', 'model', 'year', 'vin', 'color', 'mileage',
    'engine_size', 'transmission', 'body_style', 'doors', 'seats', 'fuel_type'
  ];

  const { annotations, loading, error } = useVehicleAnnotations(vehicle.id, fieldNames);

  if (loading) {
    return <div className="loading-annotations">Loading data sources...</div>;
  }

  if (error) {
    console.warn('Failed to load annotations:', error);
    // Fall back to regular display without annotations
  }

  const getAnnotation = (fieldName: string): FieldAnnotation | undefined => {
    return annotations[fieldName];
  };

  return (
    <div className="vehicle-profile-annotated">
      <div className="grid grid-cols-2">
        <div className="card">
          <div className="card-header">Basic Information</div>
          <div className="card-body">
            <div className="vehicle-details">
              <div className="vehicle-detail">
                <span>Year</span>
                <AnnotatedField
                  fieldName="year"
                  value={vehicle.year}
                  vehicleId={vehicle.id}
                  annotation={getAnnotation('year')}
                  displayFormat="number"
                />
              </div>
              <div className="vehicle-detail">
                <span>Make</span>
                <AnnotatedField
                  fieldName="make"
                  value={vehicle.make}
                  vehicleId={vehicle.id}
                  annotation={getAnnotation('make')}
                />
              </div>
              <div className="vehicle-detail">
                <span>Model</span>
                <AnnotatedField
                  fieldName="model"
                  value={vehicle.model}
                  vehicleId={vehicle.id}
                  annotation={getAnnotation('model')}
                />
              </div>
              <div className="vehicle-detail">
                <span>Color</span>
                <AnnotatedField
                  fieldName="color"
                  value={vehicle.color}
                  vehicleId={vehicle.id}
                  annotation={getAnnotation('color')}
                />
              </div>
              <div className="vehicle-detail">
                <span>Mileage</span>
                <AnnotatedField
                  fieldName="mileage"
                  value={vehicle.mileage}
                  vehicleId={vehicle.id}
                  annotation={getAnnotation('mileage')}
                  displayFormat="number"
                  unit="miles"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">Technical Details</div>
          <div className="card-body">
            <div className="vehicle-details">
              <div className="vehicle-detail">
                <span>Engine Size</span>
                <AnnotatedField
                  fieldName="engine_size"
                  value={vehicle.engine_size ?? null}
                  vehicleId={vehicle.id}
                  annotation={getAnnotation('engine_size')}
                />
              </div>
              <div className="vehicle-detail">
                <span>Transmission</span>
                <AnnotatedField
                  fieldName="transmission"
                  value={vehicle.transmission ?? null}
                  vehicleId={vehicle.id}
                  annotation={getAnnotation('transmission')}
                />
              </div>
              <div className="vehicle-detail">
                <span>Body Style</span>
                <AnnotatedField
                  fieldName="body_style"
                  value={vehicle.body_style ?? null}
                  vehicleId={vehicle.id}
                  annotation={getAnnotation('body_style')}
                />
              </div>
              <div className="vehicle-detail">
                <span>Fuel Type</span>
                <AnnotatedField
                  fieldName="fuel_type"
                  value={vehicle.fuel_type ?? null}
                  vehicleId={vehicle.id}
                  annotation={getAnnotation('fuel_type')}
                />
              </div>
              <div className="vehicle-detail">
                <span>Doors</span>
                <AnnotatedField
                  fieldName="doors"
                  value={vehicle.doors ?? null}
                  vehicleId={vehicle.id}
                  annotation={getAnnotation('doors')}
                  displayFormat="number"
                />
              </div>
              <div className="vehicle-detail">
                <span>Seats</span>
                <AnnotatedField
                  fieldName="seats"
                  value={vehicle.seats ?? null}
                  vehicleId={vehicle.id}
                  annotation={getAnnotation('seats')}
                  displayFormat="number"
                />
              </div>
              <div className="vehicle-detail">
                <span>VIN</span>
                <AnnotatedField
                  fieldName="vin"
                  value={vehicle.vin}
                  vehicleId={vehicle.id}
                  annotation={getAnnotation('vin')}
                  className="vin-field"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {!loading && Object.keys(annotations).length > 0 && (
        <div className="data-source-legend">
          <div className="legend-item">
            <span className="legend-indicator verified-multi">✓✓</span>
            <span>Multi-verified</span>
          </div>
          <div className="legend-item">
            <span className="legend-indicator verified-professional">✓</span>
            <span>Professional verified</span>
          </div>
          <div className="legend-item">
            <span className="legend-indicator verified-basic">○</span>
            <span>Basic verification</span>
          </div>
          <div className="legend-item">
            <span className="legend-indicator has-conflicts">⚠</span>
            <span>Conflicting data</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default VehicleProfileWithAnnotations;
