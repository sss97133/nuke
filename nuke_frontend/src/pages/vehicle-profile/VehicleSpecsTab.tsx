import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import type { Vehicle, VehiclePermissions } from './types';

interface VehicleSpecsTabProps {
  vehicle: Vehicle;
  session: any;
  permissions: VehiclePermissions;
  onDataPointClick: (e: React.MouseEvent, fieldName: string, fieldValue: string, fieldLabel: string) => void;
  onEditClick: () => void;
  canEdit: boolean;
}

interface SpecGroup {
  title: string;
  specs: Array<{ label: string; value: string | number | null; field?: string }>;
}

const VehicleSpecsTab: React.FC<VehicleSpecsTabProps> = ({
  vehicle,
  session,
  permissions,
  onDataPointClick,
  onEditClick,
  canEdit
}) => {
  const [spidData, setSpidData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSpidData();
  }, [vehicle.id]);

  const loadSpidData = async () => {
    try {
      const { data, error } = await supabase
        .from('vehicle_spid_data')
        .select('*')
        .eq('vehicle_id', vehicle.id)
        .single();

      if (!error && data) {
        setSpidData(data);
      }
    } catch (error) {
      console.error('Error loading SPID data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatValue = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined) return 'Not specified';
    if (typeof value === 'number') {
      if (value > 1000 && value < 1000000) {
        return value.toLocaleString();
      }
      return value.toString();
    }
    return String(value);
  };

  const buildSpecGroups = (): SpecGroup[] => {
    const groups: SpecGroup[] = [];

    // Basic Information
    const basicSpecs: Array<{ label: string; value: string | number | null; field?: string }> = [];
    if (vehicle.year) basicSpecs.push({ label: 'Year', value: vehicle.year, field: 'year' });
    if (vehicle.make) basicSpecs.push({ label: 'Make', value: vehicle.make, field: 'make' });
    if (vehicle.model) basicSpecs.push({ label: 'Model', value: vehicle.model, field: 'model' });
    if ((vehicle as any).series) basicSpecs.push({ label: 'Series', value: (vehicle as any).series, field: 'series' });
    if (vehicle.vin) basicSpecs.push({ label: 'VIN', value: vehicle.vin, field: 'vin' });
    if (vehicle.color) basicSpecs.push({ label: 'Color', value: vehicle.color, field: 'color' });
    if (vehicle.mileage) basicSpecs.push({ label: 'Mileage', value: `${vehicle.mileage.toLocaleString()} miles`, field: 'mileage' });
    if (basicSpecs.length > 0) {
      groups.push({ title: 'Basic Information', specs: basicSpecs });
    }

    // Powertrain
    const powertrainSpecs: Array<{ label: string; value: string | number | null; field?: string }> = [];
    if (vehicle.engine) powertrainSpecs.push({ label: 'Engine', value: vehicle.engine, field: 'engine' });
    if ((vehicle as any).engine_size) powertrainSpecs.push({ label: 'Engine Size', value: (vehicle as any).engine_size, field: 'engine_size' });
    if ((vehicle as any).displacement) powertrainSpecs.push({ label: 'Displacement', value: (vehicle as any).displacement, field: 'displacement' });
    if ((vehicle as any).horsepower) powertrainSpecs.push({ label: 'Horsepower', value: (vehicle as any).horsepower, field: 'horsepower' });
    if ((vehicle as any).torque) powertrainSpecs.push({ label: 'Torque', value: (vehicle as any).torque, field: 'torque' });
    if (vehicle.transmission) powertrainSpecs.push({ label: 'Transmission', value: vehicle.transmission, field: 'transmission' });
    if ((vehicle as any).transmission_model) powertrainSpecs.push({ label: 'Transmission Model', value: (vehicle as any).transmission_model, field: 'transmission_model' });
    if (vehicle.drivetrain) powertrainSpecs.push({ label: 'Drivetrain', value: vehicle.drivetrain, field: 'drivetrain' });
    if ((vehicle as any).fuel_type) powertrainSpecs.push({ label: 'Fuel Type', value: (vehicle as any).fuel_type, field: 'fuel_type' });
    if (powertrainSpecs.length > 0) {
      groups.push({ title: 'Powertrain', specs: powertrainSpecs });
    }

    // Dimensions & Weight
    const dimensionSpecs: Array<{ label: string; value: string | number | null; field?: string }> = [];
    if ((vehicle as any).body_style) dimensionSpecs.push({ label: 'Body Style', value: (vehicle as any).body_style, field: 'body_style' });
    if ((vehicle as any).wheelbase) dimensionSpecs.push({ label: 'Wheelbase', value: (vehicle as any).wheelbase, field: 'wheelbase' });
    if ((vehicle as any).length) dimensionSpecs.push({ label: 'Length', value: (vehicle as any).length, field: 'length' });
    if ((vehicle as any).width) dimensionSpecs.push({ label: 'Width', value: (vehicle as any).width, field: 'width' });
    if ((vehicle as any).height) dimensionSpecs.push({ label: 'Height', value: (vehicle as any).height, field: 'height' });
    if ((vehicle as any).curb_weight) dimensionSpecs.push({ label: 'Curb Weight', value: (vehicle as any).curb_weight, field: 'curb_weight' });
    if (dimensionSpecs.length > 0) {
      groups.push({ title: 'Dimensions & Weight', specs: dimensionSpecs });
    }

    // SPID Data (if available)
    if (spidData) {
      const spidSpecs: Array<{ label: string; value: string | number | null; field?: string }> = [];
      if (spidData.engine_rpo_code) spidSpecs.push({ label: 'Engine RPO Code', value: spidData.engine_rpo_code });
      if (spidData.engine_displacement_liters) spidSpecs.push({ label: 'Engine Displacement', value: `${spidData.engine_displacement_liters}L` });
      if (spidData.transmission_rpo_code) spidSpecs.push({ label: 'Transmission RPO Code', value: spidData.transmission_rpo_code });
      if (spidData.transmission_model) spidSpecs.push({ label: 'Transmission Model', value: spidData.transmission_model });
      if (spidData.axle_ratio) spidSpecs.push({ label: 'Axle Ratio', value: spidData.axle_ratio });
      if (spidData.differential_type) spidSpecs.push({ label: 'Differential', value: spidData.differential_type });
      if (spidSpecs.length > 0) {
        groups.push({ title: 'Factory Specifications (SPID)', specs: spidSpecs });
      }
    }

    return groups;
  };

  const specGroups = buildSpecGroups();

  if (loading) {
    return <div style={{ padding: '24px', textAlign: 'center' }}>Loading specifications...</div>;
  }

  return (
    <div style={{ maxWidth: '1200px' }}>
      {specGroups.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
          No specifications available. {canEdit && (
            <button
              onClick={onEditClick}
              style={{
                marginLeft: '8px',
                color: 'var(--primary)',
                textDecoration: 'underline',
                background: 'none',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              Add specifications
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          {specGroups.map((group, groupIndex) => (
            <div key={groupIndex} className="card">
              <div className="card-header">
                <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>{group.title}</h3>
              </div>
              <div className="card-body" style={{ padding: 0 }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                  gap: '1px',
                  backgroundColor: 'var(--border-light)'
                }}>
                  {group.specs.map((spec, specIndex) => (
                    <div
                      key={specIndex}
                      style={{
                        padding: '12px 16px',
                        backgroundColor: 'var(--surface)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px'
                      }}
                    >
                      <dt style={{
                        fontSize: '12px',
                        fontWeight: 500,
                        color: 'var(--text-muted)',
                        margin: 0
                      }}>
                        {spec.label}
                      </dt>
                      <dd
                        style={{
                          fontSize: '14px',
                          color: 'var(--text)',
                          margin: 0,
                          cursor: spec.field ? 'pointer' : 'default'
                        }}
                        onClick={spec.field ? (e) => {
                          e.preventDefault();
                          onDataPointClick(e, spec.field!, String(spec.value), spec.label);
                        } : undefined}
                      >
                        {formatValue(spec.value)}
                      </dd>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default VehicleSpecsTab;

