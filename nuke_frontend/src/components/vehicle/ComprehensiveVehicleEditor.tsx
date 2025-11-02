/**
 * Comprehensive Vehicle Data Editor
 * All fields editable inline for collaborators
 * Includes sub-model nomenclature (C/K, weight class, etc.)
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import UniversalFieldEditor from './UniversalFieldEditor';
import EditHistoryViewer from './EditHistoryViewer';
import DealerTransactionInput from './DealerTransactionInput';

interface ComprehensiveVehicleEditorProps {
  vehicleId: string;
  vehicle: any;
  canEdit: boolean;
  onDataUpdated?: () => void;
}

export const ComprehensiveVehicleEditor: React.FC<ComprehensiveVehicleEditorProps> = ({
  vehicleId,
  vehicle,
  canEdit,
  onDataUpdated
}) => {
  const [nomenclature, setNomenclature] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadNomenclature();
  }, [vehicleId]);

  const loadNomenclature = async () => {
    try {
      const { data } = await supabase
        .from('vehicle_nomenclature')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .maybeSingle();

      setNomenclature(data || {});
    } catch (err) {
      console.error('Error loading nomenclature:', err);
    } finally {
      setLoading(false);
    }
  };

  const createNomenclatureIfNeeded = async () => {
    if (nomenclature?.id) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from('vehicle_nomenclature')
      .insert({
        vehicle_id: vehicleId,
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        created_by: user.id
      });

    loadNomenclature();
  };

  const handleFieldSaved = async (fieldName: string) => {
    await loadNomenclature();
    onDataUpdated?.();
  };

  if (loading) {
    return <div className="text text-small text-muted">Loading...</div>;
  }

  return (
    <div>
      {/* Dealer Transaction Input */}
      <DealerTransactionInput vehicleId={vehicleId} canEdit={canEdit} />

      {/* Edit History Viewer */}
      <EditHistoryViewer vehicleId={vehicleId} />

      {/* Core Identification */}
      <div className="card" style={{ marginBottom: 'var(--space-3)' }}>
        <div className="card-header">
          <h3 className="heading-3">Core Identification</h3>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          <UniversalFieldEditor
            vehicleId={vehicleId}
            fieldName="year"
            fieldLabel="Year"
            currentValue={vehicle.year}
            canEdit={canEdit}
            fieldType="number"
            validator={(v) => (v && (v < 1900 || v > 2030)) ? 'Invalid year' : null}
            onSaved={() => handleFieldSaved('year')}
          />
          <UniversalFieldEditor
            vehicleId={vehicleId}
            fieldName="make"
            fieldLabel="Make"
            currentValue={vehicle.make}
            canEdit={canEdit}
            placeholder="e.g., GMC, Chevrolet, Ford"
            onSaved={() => handleFieldSaved('make')}
          />
          <UniversalFieldEditor
            vehicleId={vehicleId}
            fieldName="model"
            fieldLabel="Model"
            currentValue={vehicle.model}
            canEdit={canEdit}
            placeholder="e.g., Sierra, Silverado, F-150"
            onSaved={() => handleFieldSaved('model')}
          />
          <UniversalFieldEditor
            vehicleId={vehicleId}
            fieldName="vin"
            fieldLabel="VIN"
            currentValue={vehicle.vin}
            canEdit={canEdit}
            placeholder="17-character VIN"
            validator={(v) => (v && v.length !== 17) ? 'VIN must be 17 characters' : null}
            onSaved={() => handleFieldSaved('vin')}
          />
        </div>
      </div>

      {/* Sub-Model Nomenclature */}
      <div className="card" style={{ marginBottom: 'var(--space-3)' }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 className="heading-3">Sub-Model Details</h3>
          {!nomenclature?.id && canEdit && (
            <button
              onClick={createNomenclatureIfNeeded}
              className="button button-small"
            >
              Enable Detailed Naming
            </button>
          )}
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          <UniversalFieldEditor
            vehicleId={vehicleId}
            fieldName="trim"
            fieldLabel="Trim Level"
            currentValue={nomenclature?.trim || vehicle.trim}
            canEdit={canEdit}
            placeholder="e.g., Classic, LT, Sport"
            tableName="vehicle_nomenclature"
            onSaved={() => handleFieldSaved('trim')}
          />
          <UniversalFieldEditor
            vehicleId={vehicleId}
            fieldName="series"
            fieldLabel="Series"
            currentValue={nomenclature?.series}
            canEdit={canEdit}
            placeholder="e.g., Sierra, C/K, GMT400"
            tableName="vehicle_nomenclature"
            onSaved={() => handleFieldSaved('series')}
          />
          <UniversalFieldEditor
            vehicleId={vehicleId}
            fieldName="drive_type"
            fieldLabel="Drive Type"
            currentValue={nomenclature?.drive_type}
            canEdit={canEdit}
            fieldType="select"
            options={['C (2WD)', 'K (4WD)', 'V (AWD)', 'R (RWD)']}
            tableName="vehicle_nomenclature"
            onSaved={() => handleFieldSaved('drive_type')}
          />
          <UniversalFieldEditor
            vehicleId={vehicleId}
            fieldName="weight_class"
            fieldLabel="Weight Class"
            currentValue={nomenclature?.weight_class}
            canEdit={canEdit}
            fieldType="select"
            options={['1500 (1/2 ton)', '2500 (3/4 ton)', '3500 (1 ton)']}
            tableName="vehicle_nomenclature"
            onSaved={() => handleFieldSaved('weight_class')}
          />
          <UniversalFieldEditor
            vehicleId={vehicleId}
            fieldName="wheelbase"
            fieldLabel="Wheelbase"
            currentValue={nomenclature?.wheelbase}
            canEdit={canEdit}
            fieldType="select"
            options={['SWB (Short)', 'LWB (Long)', 'EWB (Extended)']}
            tableName="vehicle_nomenclature"
            onSaved={() => handleFieldSaved('wheelbase')}
          />
          <UniversalFieldEditor
            vehicleId={vehicleId}
            fieldName="cab_style"
            fieldLabel="Cab Style"
            currentValue={nomenclature?.cab_style}
            canEdit={canEdit}
            fieldType="select"
            options={['Regular Cab', 'Extended Cab', 'Crew Cab']}
            tableName="vehicle_nomenclature"
            onSaved={() => handleFieldSaved('cab_style')}
          />
          <UniversalFieldEditor
            vehicleId={vehicleId}
            fieldName="is_dually"
            fieldLabel="Dually (Dual Rear Wheels)"
            currentValue={nomenclature?.is_dually}
            canEdit={canEdit}
            fieldType="checkbox"
            tableName="vehicle_nomenclature"
            onSaved={() => handleFieldSaved('is_dually')}
          />
        </div>
      </div>

      {/* Specs */}
      <div className="card">
        <div className="card-header">
          <h3 className="heading-3">Specifications</h3>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          <UniversalFieldEditor
            vehicleId={vehicleId}
            fieldName="color"
            fieldLabel="Color"
            currentValue={vehicle.color}
            canEdit={canEdit}
            placeholder="e.g., Red, Blue, Black"
            onSaved={() => handleFieldSaved('color')}
          />
          <UniversalFieldEditor
            vehicleId={vehicleId}
            fieldName="mileage"
            fieldLabel="Mileage"
            currentValue={vehicle.mileage}
            canEdit={canEdit}
            fieldType="number"
            placeholder="Current mileage"
            onSaved={() => handleFieldSaved('mileage')}
          />
          <UniversalFieldEditor
            vehicleId={vehicleId}
            fieldName="engine_size"
            fieldLabel="Engine"
            currentValue={vehicle.engine_size}
            canEdit={canEdit}
            placeholder="e.g., 5.7L V8, 6.2L Diesel"
            onSaved={() => handleFieldSaved('engine_size')}
          />
          <UniversalFieldEditor
            vehicleId={vehicleId}
            fieldName="transmission"
            fieldLabel="Transmission"
            currentValue={vehicle.transmission}
            canEdit={canEdit}
            placeholder="e.g., 4-speed automatic, 5-speed manual"
            onSaved={() => handleFieldSaved('transmission')}
          />
          <UniversalFieldEditor
            vehicleId={vehicleId}
            fieldName="fuel_type"
            fieldLabel="Fuel Type"
            currentValue={vehicle.fuel_type}
            canEdit={canEdit}
            fieldType="select"
            options={['Gasoline', 'Diesel', 'Electric', 'Hybrid', 'E85']}
            onSaved={() => handleFieldSaved('fuel_type')}
          />
        </div>
      </div>
    </div>
  );
};

export default ComprehensiveVehicleEditor;

